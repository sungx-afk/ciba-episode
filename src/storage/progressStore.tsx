import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useMemo,
  useCallback,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import rawWordsData from '../data/words.json';
import { Word, WordProgress, WordStatus, ProgressState, LearningStats } from '../types';
import { authService, RemoteUser } from '../services/auth';
import { packLibrary, RemotePack } from '../services/packLibrary';
import { addWordToBookmark, clearBookmarkPackCache } from '../services/bookmarkApi';
import { clearVipGateCache } from '../services/vipGate';
import { useAuth } from '../context/AuthContext';

const STORAGE_KEY = '@ciba_progress_v1';
const PACK_KEY = '@ciba_current_pack';
const TOP_PACK_KEY = '@ciba_selected_top_pack';

/**
 * 按账号隔离本地存储：登录后 key 带上用户 id，未登录用公共（游客）key。
 * 这样切换账号时，学习进度、打卡天数、发音设置、当前词库都跟着账号走。
 */
function scopedKey(base: string, accountId: string): string {
  return accountId ? `${base}#${accountId}` : base;
}

const localWords: Word[] =
  Array.isArray((rawWordsData as any)?.words)
    ? (rawWordsData as any).words
    : Array.isArray((rawWordsData as any)?.default?.words)
    ? (rawWordsData as any).default.words
    : Array.isArray(rawWordsData)
    ? (rawWordsData as any)
    : [];

export interface CategoryInfo {
  name: string;
  wordCount: number;
  subCategories: { name: string; wordCount: number }[];
}

function buildCategories(words: Word[]): CategoryInfo[] {
  const map: Record<string, { total: number; subs: Record<string, number> }> = {};
  const list = Array.isArray(words) ? words : [];

  for (const w of list) {
    if (!w) continue;
    const cat = w.cat || '其他';
    const sub = w.sub || '通用';
    if (!map[cat]) {
      map[cat] = { total: 0, subs: {} };
    }
    map[cat].total += 1;
    map[cat].subs[sub] = (map[cat].subs[sub] || 0) + 1;
  }

  return Object.keys(map).map((catName) => ({
    name: catName,
    wordCount: map[catName].total,
    subCategories: Object.keys(map[catName].subs).map((subName) => ({
      name: subName,
      wordCount: map[catName].subs[subName],
    })),
  }));
}

function getTodayString(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** 评分种类：与服务端学习结果 type 一一对应 */
type ReviewGrade = 'again' | 'hard' | 'good' | 'easy' | 'remembered';

/** 学习结果上报给服务端的 type */
const GRADE_TYPE: Record<ReviewGrade, number> = {
  again: 0,
  hard: 1,
  good: 2,
  easy: 3,
  remembered: 4,
};

function emptyProgress(wordId: number): WordProgress {
  return {
    wordId,
    status: 'unlearned',
    interval: 0,
    nextReviewTime: 0,
    lastReviewTime: 0,
    reviewCount: 0,
    lapseCount: 0,
    isBookmarked: false,
  };
}

/** 打卡天数：当天首次学习时，昨天有学习则 +1，否则重新计数 */
function nextStreakDays(state: ProgressState, today: string): number {
  if (state.lastActiveDate === today) return state.streakDays;
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;
  if (state.lastActiveDate === yesterdayStr || state.streakDays === 0) {
    return state.streakDays + 1;
  }
  return 1;
}

/**
 * 计算一次评分后的新进度，以及掌握状态的变化量：
 *  +1 新掌握、-1 从掌握退回其它状态、0 无变化。
 * 单条上报与批量上报共用同一套 SRS 规则。
 */
function applyGrade(
  prog: WordProgress,
  grade: ReviewGrade,
  now: number
): { updatedProg: WordProgress; masteredDelta: number } {
  let newInterval = 0;
  let nextReviewTime = 0;
  let newStatus: WordStatus = prog.status;
  let lapseInc = 0;

  switch (grade) {
    case 'again':
      newInterval = 0;
      nextReviewTime = now + 10 * 60 * 1000;
      newStatus = 'learning';
      lapseInc = 1;
      break;
    case 'hard':
      newInterval = 1;
      nextReviewTime = now + 24 * 60 * 60 * 1000;
      newStatus = 'learning';
      break;
    case 'good':
      newInterval = prog.interval > 0 ? Math.round(prog.interval * 1.8) : 3;
      nextReviewTime = now + newInterval * 24 * 60 * 60 * 1000;
      newStatus = newInterval >= 7 ? 'mastered' : 'learning';
      break;
    case 'easy':
      newInterval = prog.interval > 0 ? Math.round(prog.interval * 2.5) : 7;
      nextReviewTime = now + newInterval * 24 * 60 * 60 * 1000;
      newStatus = 'mastered';
      break;
    case 'remembered':
      // 手动标记为「已记住」(上报 type=4)，直接置为已掌握并给一个较长间隔
      newInterval = prog.interval > 0 ? Math.round(prog.interval * 3) : 14;
      nextReviewTime = now + newInterval * 24 * 60 * 60 * 1000;
      newStatus = 'mastered';
      break;
  }

  const wasMastered = prog.status === 'mastered';
  const isNowMastered = newStatus === 'mastered';
  const masteredDelta =
    isNowMastered && !wasMastered ? 1 : !isNowMastered && wasMastered ? -1 : 0;

  const updatedProg: WordProgress = {
    ...prog,
    interval: newInterval,
    nextReviewTime,
    lastReviewTime: now,
    reviewCount: prog.reviewCount + 1,
    lapseCount: prog.lapseCount + lapseInc,
    status: newStatus,
  };

  return { updatedProg, masteredDelta };
}

const defaultState: ProgressState = {
  progressMap: {},
  accent: 'en-US',
  autoPronounce: true,
  speechRate: 0.9,
  lastActiveDate: '',
  streakDays: 0,
  todayLearnedIds: [],
};

interface CurrentPack {
  id: number;
  name: string;
}

interface ProgressContextValue {
  // 学习进度
  state: ProgressState;
  stats: LearningStats;
  /**
   * 学习结果上报：options.packId 指定卡片所属卡组，
   * 生词本这类不在 words/todayWords/packWords 列表里的单词必须显式传入，
   * 否则会落到当前选中的卡组。
   */
  recordReview: (
    wordId: number,
    grade: ReviewGrade,
    options?: { packId?: number }
  ) => Promise<void>;
  /**
   * 批量记录学习结果（列表页「全部记住」）:
   * 一次批量上报 + 一次本地状态刷新，失败会抛出异常。
   * options.packId 同上，整批单词共用一个卡组。
   */
  recordReviews: (
    wordIds: number[],
    grade: ReviewGrade,
    options?: { packId?: number }
  ) => Promise<void>;
  /** 加入/取消生词本；加入会同步到服务端，wordName 传了就不必再去列表里找 */
  toggleBookmark: (wordId: number, wordName?: string) => Promise<void>;
  updateSettings: (
    newSettings: Partial<Pick<ProgressState, 'accent' | 'autoPronounce' | 'speechRate'>>
  ) => Promise<void>;
  resetProgress: () => Promise<void>;
  exportProgressData: () => string;
  isWordDue: (wordId: number) => boolean;
  getProgressForWord: (wordId: number) => WordProgress | undefined;

  // 词库数据
  words: Word[];
  categoryList: CategoryInfo[];
  isLoadingWords: boolean;
  wordSource: 'local' | 'remote';
  currentPack: CurrentPack | null;
  loadPackWords: (pack: RemotePack) => Promise<void>;
  revertToLocal: () => void;

  // 今日学习单词 (来自 /anki/pack/{id}/learn-by-menu.json)
  todayWords: Word[];
  todayWordsTotal: number;
  todayWordsPackId: number | null;
  isLoadingTodayWords: boolean;
  loadTodayWords: (
    packId: number,
    options?: { start?: number; limit?: number; types?: number[]; cat?: string; sub?: string }
  ) => Promise<Word[]>;
  clearTodayWords: () => void;

  // 子卡组单词列表 (来自 /anki/pack/{id}/learn-by-menu.json，不带 type 过滤)
  packWords: Word[];
  packWordsPackId: number | null;
  isLoadingPackWords: boolean;
  loadPackWordList: (
    packId: number,
    options?: { cat?: string; sub?: string }
  ) => Promise<Word[]>;

  // 从市场安装成功的卡组（供分类页刷新我的卡组并切换到该卡组）
  installedPack: RemotePack | null;
  setInstalledPack: (pack: RemotePack | null) => void;

  // 本地学习导致的卡组「已掌握数量」变化量: packId -> delta
  // 服务端 remembered_card_count 不会实时变化，用它做本地增量校正
  packMasteredDelta: Record<number, number>;
  resetPackMasteredDelta: () => void;
  /**
   * 只清掉指定卡组的增量（服务端数据已把这些变化算进去时使用），
   * 其余卡组的增量保留，避免服务端异步汇总滞后时数字回落。
   */
  dropPackMasteredDelta: (packIds: number[]) => void;

  // 当前显示的顶层卡组（分类页顶部切换的那个），其它页面可直接读取
  currentTopPack: RemotePack | null;
  setCurrentTopPack: (pack: RemotePack | null) => void;
  /** 仅清除内存中的选中卡组（不影响「上次记住的卡组」本地记录） */
  resetCurrentTopPack: () => void;
  /** 读取上次记住的卡组（供启动/重新登录时优先选中） */
  readRememberedTopPack: () => Promise<{ id: number; name: string } | null>;

  // 认证
  user: RemoteUser | null;
  isLoggedIn: boolean;
  login: (loginName: string, password: string) => Promise<RemoteUser>;
  logout: () => Promise<void>;
}

const ProgressContext = createContext<ProgressContextValue | null>(null);

export const ProgressProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // 与全局登录态(AuthProvider)保持同步：登录/退出后立即反映到各页面的 isLoggedIn
  const auth = useAuth();

  const [state, setState] = useState<ProgressState>(defaultState);
  const [isLoaded, setIsLoaded] = useState(false);

  // 词库数据
  const [words, setWords] = useState<Word[]>(localWords);
  const [isLoadingWords, setIsLoadingWords] = useState(false);
  const [wordSource, setWordSource] = useState<'local' | 'remote'>('local');
  const [currentPack, setCurrentPack] = useState<CurrentPack | null>(null);

  // 今日学习单词
  const [todayWords, setTodayWords] = useState<Word[]>([]);
  const [todayWordsTotal, setTodayWordsTotal] = useState(0);
  const [todayWordsPackId, setTodayWordsPackId] = useState<number | null>(null);
  const [isLoadingTodayWords, setIsLoadingTodayWords] = useState(false);
  // 今日单词请求代次：只让最后一次请求落地，避免旧卡组的结果盖掉新卡组的数据
  const todayWordsReqRef = useRef(0);

  // 子卡组单词列表
  const [packWords, setPackWords] = useState<Word[]>([]);
  const [packWordsPackId, setPackWordsPackId] = useState<number | null>(null);
  const [isLoadingPackWords, setIsLoadingPackWords] = useState(false);

  // 市场安装成功的卡组
  const [installedPack, setInstalledPack] = useState<RemotePack | null>(null);
  // 各卡组已掌握数量的本地增量
  const [packMasteredDelta, setPackMasteredDelta] = useState<Record<number, number>>({});

  // 当前显示的顶层卡组
  const [currentTopPack, setCurrentTopPackState] = useState<RemotePack | null>(null);

  // 认证
  const [user, setUser] = useState<RemoteUser | null>(null);

  // 登录态以 AuthProvider 为准：登录成功 / 退出登录 / 启动时恢复都会同步到这里
  useEffect(() => {
    setUser(auth.user ? (auth.user as unknown as RemoteUser) : null);
  }, [auth.user]);

  /** 当前账号 id，空串表示未登录（游客公共作用域） */
  const accountId = useMemo(() => {
    const u: any = (auth.user as any) || user || null;
    const id = u?.id ?? u?.userId ?? u?.uid;
    return id == null || id === '' ? '' : String(id);
  }, [auth.user, user]);

  // 本地存储按账号分区：切换账号后各自读各自的数据
  const progressKey = useMemo(() => scopedKey(STORAGE_KEY, accountId), [accountId]);
  const packKey = useMemo(() => scopedKey(PACK_KEY, accountId), [accountId]);
  const topPackKey = useMemo(() => scopedKey(TOP_PACK_KEY, accountId), [accountId]);

  // 初始化: 恢复登录态
  useEffect(() => {
    (async () => {
      try {
        // 恢复登录态 (优先读取统一用户信息)
        const storedUser = await AsyncStorage.getItem('@ciba_user_info');
        if (storedUser) {
          try {
            const parsed = JSON.parse(storedUser);
            if (parsed) setUser(parsed);
          } catch (_) {}
        }
        const restored = await authService.restore();
        if (restored && !auth.user) setUser(restored);
      } catch (e) {
        console.warn('[ProgressStore] authService.restore failed', e);
      }
      setIsLoaded(true);
    })().catch((e) => {
      console.error('[ProgressStore] init useEffect failed', e);
      setIsLoaded(true); // 即便出错也要解除 loading 状态
    });
  }, []);

  /**
   * 按当前账号恢复本地数据：进度 + 上次选择的词库。
   * 切换账号 / 登录 / 退出都会重新走一遍，保证「学习统计」跟着账号走。
   */
  useEffect(() => {
    // 登录态还在异步恢复中，先等它确定是哪个账号，避免用游客数据覆盖一遍再重来
    if (auth.isLoading) return;

    let cancelled = false;

    // ① 先把上一个账号的内存数据清掉，避免切换瞬间串数据
    setState(defaultState);
    setPackMasteredDelta({});
    setTodayWords([]);
    setTodayWordsTotal(0);
    setTodayWordsPackId(null);
    setPackWords([]);
    setPackWordsPackId(null);
    setInstalledPack(null);
    setWords(localWords);
    setWordSource('local');
    setCurrentPack(null);
    setCurrentTopPackState(null);
    // 会员额度、生词本默认卡组 id 也是按账号的
    clearVipGateCache();
    clearBookmarkPackCache();

    /** 老版本只有一份全局数据：首次读到时迁移到当前账号，之后按账号各自保存 */
    const readScoped = async (key: string, legacyKey: string) => {
      const scoped = await AsyncStorage.getItem(key);
      if (scoped || !accountId || key === legacyKey) return scoped;
      const legacy = await AsyncStorage.getItem(legacyKey);
      if (!legacy) return null;
      await AsyncStorage.setItem(key, legacy);
      await AsyncStorage.removeItem(legacyKey);
      return legacy;
    };

    (async () => {
      // ② 学习进度（含打卡天数、发音设置）
      try {
        const json = await readScoped(progressKey, STORAGE_KEY);
        if (cancelled) return;
        if (json) {
          const parsed: ProgressState = JSON.parse(json);
          const today = getTodayString();
          const todayLearned =
            parsed.lastActiveDate === today ? parsed.todayLearnedIds || [] : [];
          setState({
            ...defaultState,
            ...parsed,
            progressMap: parsed.progressMap || {},
            todayLearnedIds: Array.isArray(todayLearned) ? todayLearned : [],
          });
        }
      } catch (e) {
        console.error('[ProgressStore] Failed to load progress', e);
      }

      // ③ 上次选择的词库
      try {
        const saved = await readScoped(packKey, PACK_KEY);
        if (cancelled || !saved) return;
        const pack = JSON.parse(saved) as CurrentPack;
        setCurrentPack(pack);
        // 异步加载远程词库 (不阻塞本地数据展示)
        setIsLoadingWords(true);
        try {
          const remoteWords = await packLibrary.loadWordsFromPack(pack.id);
          if (cancelled) return;
          if (remoteWords.length > 0) {
            setWords(remoteWords);
            setWordSource('remote');
          }
        } catch (e) {
          console.warn('[ProgressStore] loadWordsFromPack failed', e);
        } finally {
          if (!cancelled) setIsLoadingWords(false);
        }
      } catch (e) {
        console.warn('[ProgressStore] restore pack failed', e);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.isLoading, accountId, progressKey, packKey]);

  // 持久化进度（写到当前账号的分区）
  const saveState = async (newState: ProgressState) => {
    setState(newState);
    try {
      await AsyncStorage.setItem(progressKey, JSON.stringify(newState));
    } catch (e) {
      console.error('Failed to save progress', e);
    }
  };

  const getProgressForWord = (wordId: number): WordProgress | undefined => {
    return state.progressMap[wordId];
  };

  const isWordDue = (wordId: number): boolean => {
    const p = state.progressMap[wordId];
    if (!p) return false;
    return p.nextReviewTime > 0 && p.nextReviewTime <= Date.now();
  };

  /**
   * 单词所属卡组 id：优先取单词自带的 packageId（服务端 learn-by-menu 返回），
   * 找不到时退回当前卡组。
   */
  const resolvePackId = useCallback(
    (wordId: number): number | undefined => {
      const target =
        words.find((w) => w.id === wordId) ||
        todayWords.find((w) => w.id === wordId) ||
        packWords.find((w) => w.id === wordId);
      const packId = target?.packageId || currentPack?.id;
      return packId ? Number(packId) : undefined;
    },
    [words, todayWords, packWords, currentPack?.id]
  );

  /**
   * 把服务端卡片的最新 type 写回内存里的单词列表缓存。
   * 列表页「未记住 / 已记住」分组直接读 word.type，
   * 不同步的话：在背词页给一个已记住(type=4)的单词点「明天复习」(type=1) 后，
   * 返回列表它仍带着旧的 type=4，还留在「已记住」区，要重新拉取才会纠正。
   */
  const syncWordTypes = useCallback((updates: Map<number, number>) => {
    if (!updates.size) return;
    const merge = (list: Word[]): Word[] => {
      let changed = false;
      const next = list.map((w) => {
        const type = updates.get(w.id);
        if (type === undefined || w.type === type) return w;
        changed = true;
        return { ...w, type };
      });
      return changed ? next : list; // 没有变化时保持原引用，避免多余重渲染
    };
    setWords(merge);
    setTodayWords(merge);
    setPackWords(merge);
  }, []);

  const recordReview = async (
    wordId: number,
    grade: ReviewGrade,
    options?: { packId?: number }
  ) => {
    const now = Date.now();
    const today = getTodayString();
    const currentProg = state.progressMap[wordId] || emptyProgress(wordId);
    const { updatedProg, masteredDelta } = applyGrade(currentProg, grade, now);

    const todaySet = new Set(state.todayLearnedIds);
    todaySet.add(wordId);

    const newState: ProgressState = {
      ...state,
      lastActiveDate: today,
      streakDays: Math.max(1, nextStreakDays(state, today)),
      todayLearnedIds: Array.from(todaySet),
      progressMap: {
        ...state.progressMap,
        [wordId]: updatedProg,
      },
    };

    await saveState(newState);

    // 异步上报学习结果到服务端 (type: 0=重来 1=困难 2=一般 3=容易)
    // 优先使用单词所属卡组 id (learn-by-menu 返回的 package_id)
    const packId = options?.packId ?? resolvePackId(wordId);

    // 本地累计该卡组「已掌握数量」的变化量，供分类卡组列表等处实时刷新
    if (packId && masteredDelta !== 0) {
      setPackMasteredDelta((prev) => ({
        ...prev,
        [packId]: (prev[packId] || 0) + masteredDelta,
      }));
    }

    if (packId) {
      const type = GRADE_TYPE[grade];
      // 与上面的本地进度一致地乐观更新：卡片状态按服务端口径同步一次，
      // 「明天复习」把已记住的单词退回学习中也立刻生效
      syncWordTypes(new Map([[wordId, type]]));
      packLibrary.markNoteRead(packId, wordId, type);
    }
  };

  /**
   * 批量记录学习结果（如列表页「全部记住」）:
   *  - 一次请求完成上报：POST /anki/pack/{packageId}/learn/batch-log
   *    body: [{ cardId, type }, ...]
   *  - 先上报再落本地状态，上报失败界面不做变化，避免「本地已记住、服务端还没记住」
   *  - 所有单词共用一份新进度，只做一次 AsyncStorage 写入，界面一次性刷新
   */
  const recordReviews = async (
    wordIds: number[],
    grade: ReviewGrade,
    options?: { packId?: number }
  ) => {
    const ids = Array.from(new Set(wordIds));
    if (!ids.length) return;

    const now = Date.now();
    const today = getTodayString();

    // ① 先算出每个单词的新进度与「卡组掌握数」变化量
    const progressMap: Record<number, WordProgress> = { ...state.progressMap };
    const todaySet = new Set(state.todayLearnedIds);
    /** 卡组 id -> 需要上报的卡片 id */
    const groups = new Map<number, number[]>();
    /** 卡组 id -> 掌握数量的变化量 */
    const deltas = new Map<number, number>();

    for (const wordId of ids) {
      const currentProg = progressMap[wordId] || emptyProgress(wordId);
      const { updatedProg, masteredDelta } = applyGrade(currentProg, grade, now);
      progressMap[wordId] = updatedProg;
      todaySet.add(wordId);

      const packId = options?.packId ?? resolvePackId(wordId);
      if (!packId) continue; // 本地词库没有卡组 id，只更新本地进度
      const cardIds = groups.get(packId);
      if (cardIds) cardIds.push(wordId);
      else groups.set(packId, [wordId]);
      if (masteredDelta !== 0) deltas.set(packId, (deltas.get(packId) || 0) + masteredDelta);
    }

    // ② 批量上报；失败直接抛出，由调用方提示用户
    const batchType = GRADE_TYPE[grade];
    for (const [packId, cardIds] of groups) {
      await packLibrary.markNotesRead(
        packId,
        cardIds.map((cardId) => ({ cardId, type: batchType }))
      );
    }
    // 同步每条卡片的 type，「全部记住」这一类批量操作也要立即反映到列表分组上
    syncWordTypes(new Map(ids.map((id) => [id, batchType])));

    // ③ 上报成功后才落地本地状态
    const newState: ProgressState = {
      ...state,
      lastActiveDate: today,
      streakDays: Math.max(1, nextStreakDays(state, today)),
      todayLearnedIds: Array.from(todaySet),
      progressMap,
    };
    await saveState(newState);

    if (deltas.size) {
      setPackMasteredDelta((prev) => {
        const next = { ...prev };
        for (const [packId, delta] of deltas) {
          next[packId] = (next[packId] || 0) + delta;
        }
        return next;
      });
    }
  };

  const toggleBookmark = async (wordId: number, wordName?: string) => {
    const currentProg = state.progressMap[wordId] || {
      wordId,
      status: 'unlearned' as const,
      interval: 0,
      nextReviewTime: 0,
      lastReviewTime: 0,
      reviewCount: 0,
      lapseCount: 0,
      isBookmarked: false,
    };
    const nextBookmarked = !currentProg.isBookmarked;

    // 加入生词本：先同步服务端，成功后才落本地，避免本地显示与服务端不一致
    if (nextBookmarked) {
      const target =
        words.find((w) => w.id === wordId) ||
        todayWords.find((w) => w.id === wordId) ||
        packWords.find((w) => w.id === wordId);
      const name = (wordName || target?.word || '').trim();
      if (!name) {
        throw new Error('未取到单词，无法加入生词本');
      }
      await addWordToBookmark(name);
    }
    // 取消收藏：后端没有删除接口，只改本地状态

    const newState: ProgressState = {
      ...state,
      progressMap: {
        ...state.progressMap,
        [wordId]: {
          ...currentProg,
          isBookmarked: nextBookmarked,
        },
      },
    };

    await saveState(newState);
  };

  const updateSettings = async (
    newSettings: Partial<Pick<ProgressState, 'accent' | 'autoPronounce' | 'speechRate'>>
  ) => {
    const newState: ProgressState = { ...state, ...newSettings };
    await saveState(newState);
  };

  const resetProgress = async () => {
    const cleared: ProgressState = {
      ...defaultState,
      accent: state.accent,
    };
    setPackMasteredDelta({});
    await saveState(cleared);
  };

  /** 重新从服务端拉取卡组后调用：服务端数据即最新，清空本地增量避免重复累计 */
  const resetPackMasteredDelta = useCallback(() => {
    setPackMasteredDelta({});
  }, []);

  /** 只丢弃指定卡组的「已掌握」增量：这些卡组的服务端数字已经包含本地学习结果 */
  const dropPackMasteredDelta = useCallback((packIds: number[]) => {
    if (!packIds.length) return;
    setPackMasteredDelta((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const id of packIds) {
        if (next[id] !== undefined) {
          delete next[id];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, []);

  /** 切换当前显示的顶层卡组，并记住它（下次进入优先显示） */
  const setCurrentTopPack = useCallback(
    async (pack: RemotePack | null) => {
      setCurrentTopPackState(pack);
      try {
        if (pack) {
          await AsyncStorage.setItem(topPackKey, JSON.stringify(pack));
        } else {
          await AsyncStorage.removeItem(topPackKey);
        }
      } catch (e) {
        console.warn('[ProgressStore] save current top pack failed', e);
      }
    },
    [topPackKey]
  );

  /**
   * 仅清除内存中的选中状态，保留「上次记住的卡组」本地记录。
   * 用于退出登录 / 回到本地词库等场景，避免把记住的卡组一并删掉。
   */
  const resetCurrentTopPack = useCallback(() => {
    setCurrentTopPackState(null);
  }, []);

  /** 读取当前账号上次记住的卡组 id + name */
  const readRememberedTopPack = useCallback(async (): Promise<{ id: number; name: string } | null> => {
    try {
      let raw = await AsyncStorage.getItem(topPackKey);
      // 老版本只有一份全局记录：迁移到当前账号
      if (!raw && accountId) {
        const legacy = await AsyncStorage.getItem(TOP_PACK_KEY);
        if (legacy) {
          raw = legacy;
          await AsyncStorage.setItem(topPackKey, legacy);
          await AsyncStorage.removeItem(TOP_PACK_KEY);
        }
      }
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed?.id ? { id: Number(parsed.id), name: parsed.name } : null;
    } catch {
      return null;
    }
  }, [topPackKey, accountId]);

  const exportProgressData = (): string => JSON.stringify(state, null, 2);

  // 加载远程词库（同时切换当前卡组，保持与首页「我的卡组」一致）
  const loadPackWords = useCallback(async (pack: RemotePack) => {
    setIsLoadingWords(true);
    try {
      const remoteWords = await packLibrary.loadWordsFromPack(pack.id);
      if (remoteWords.length > 0) {
        setWords(remoteWords);
        setWordSource('remote');
      }
      // 词库为空也要切换卡组，否则用户在界面看不到任何反馈
      const cp = { id: pack.id, name: pack.name };
      setCurrentPack(cp);
      // 复用首页顶部「我的卡组」的当前卡组状态（内存 + 本地记忆一起更新）
      setCurrentTopPack(pack);
      await AsyncStorage.setItem(packKey, JSON.stringify(cp));
    } finally {
      setIsLoadingWords(false);
    }
  }, [setCurrentTopPack, packKey]);

  const revertToLocal = useCallback(() => {
    setWords(localWords);
    setWordSource('local');
    setCurrentPack(null);
    // 只清内存，保留「上次记住的卡组」，退出后重新登录仍能恢复
    resetCurrentTopPack();
    setTodayWords([]);
    setTodayWordsTotal(0);
    setTodayWordsPackId(null);
    AsyncStorage.removeItem(packKey);
  }, [resetCurrentTopPack, packKey]);

  /**
   * 拉取某个卡组的今日学习单词列表
   * GET /anki/pack/{packId}/learn-by-menu.json?start=0&limit=50&type=0&type=1&type=2&type=3
   */
  const loadTodayWords = useCallback(
    async (
      packId: number,
      options: {
        start?: number;
        limit?: number;
        types?: number[];
        cat?: string;
        sub?: string;
      } = {}
    ): Promise<Word[]> => {
      const req = ++todayWordsReqRef.current;
      setIsLoadingTodayWords(true);
      try {
        const { words: list, total } = await packLibrary.fetchTodayWords(packId, options);
        // 等待期间可能已经为另一个卡组发了新请求（例如焦点换到了别的分类卡组），
        // 这时要丢弃旧结果，否则旧卡组的单词会盖回来，今日学习区一直停在旧卡组上
        if (req === todayWordsReqRef.current) {
          setTodayWords(list);
          setTodayWordsTotal(total);
          setTodayWordsPackId(packId);
        }
        return list;
      } finally {
        if (req === todayWordsReqRef.current) setIsLoadingTodayWords(false);
      }
    },
    []
  );

  const clearTodayWords = useCallback(() => {
    setTodayWords([]);
    setTodayWordsTotal(0);
    setTodayWordsPackId(null);
  }, []);

  /**
   * 拉取某个子卡组的全部单词列表（分页合并，最多 5 页 / 500 词）
   * GET /anki/pack/{packId}/learn-by-menu.json?start=0&limit=100
   */
  const loadPackWordList = useCallback(
    async (packId: number, options: { cat?: string; sub?: string } = {}): Promise<Word[]> => {
      setIsLoadingPackWords(true);
      try {
        const collected: Word[] = [];
        const seen = new Set<number>();
        const pageSize = 100;
        let start = 0;

        for (let page = 0; page < 5; page++) {
          const { words: list, total } = await packLibrary.fetchPackWords(packId, {
            ...options,
            start,
            limit: pageSize,
          });
          for (const w of list) {
            if (!seen.has(w.id)) {
              seen.add(w.id);
              collected.push(w);
            }
          }
          if (list.length === 0 || start + list.length >= total) break;
          start += list.length;
        }

        setPackWords(collected);
        setPackWordsPackId(packId);
        return collected;
      } finally {
        setIsLoadingPackWords(false);
      }
    },
    []
  );

  // 认证
  const login = useCallback(async (loginName: string, password: string) => {
    const u = await authService.login(loginName, password);
    setUser(u);
    return u;
  }, []);

  const logout = useCallback(async () => {
    await authService.logout();
    setUser(null);
    revertToLocal();
  }, [revertToLocal]);

  const categoryList = useMemo(() => buildCategories(words), [words]);

  const stats: LearningStats = useMemo(() => {
    let masteredCount = 0;
    let learningCount = 0;
    let dueTodayCount = 0;
    const now = Date.now();

    const progressMap = state?.progressMap || {};
    for (const id in progressMap) {
      const p = progressMap[id];
      if (!p) continue;
      if (p.status === 'mastered') masteredCount++;
      else if (p.status === 'learning') learningCount++;
      if (p.nextReviewTime > 0 && p.nextReviewTime <= now) {
        dueTodayCount++;
      }
    }

    const totalWords = (words || []).length;
    const unlearnedCount = Math.max(0, totalWords - masteredCount - learningCount);

    return {
      totalWords,
      masteredCount,
      learningCount,
      unlearnedCount,
      dueTodayCount,
      todayLearnedCount: (state?.todayLearnedIds || []).length,
      streakDays: state?.streakDays || 0,
    };
  }, [state, words]);

  const value: ProgressContextValue = {
    state,
    stats,
    recordReview,
    recordReviews,
    toggleBookmark,
    updateSettings,
    resetProgress,
    exportProgressData,
    isWordDue,
    getProgressForWord,
    words,
    categoryList,
    isLoadingWords,
    wordSource,
    currentPack,
    loadPackWords,
    revertToLocal,
    todayWords,
    todayWordsTotal,
    todayWordsPackId,
    isLoadingTodayWords,
    loadTodayWords,
    clearTodayWords,
    packWords,
    packWordsPackId,
    isLoadingPackWords,
    loadPackWordList,
    installedPack,
    setInstalledPack,
    packMasteredDelta,
    resetPackMasteredDelta,
    dropPackMasteredDelta,
    currentTopPack,
    setCurrentTopPack,
    resetCurrentTopPack,
    readRememberedTopPack,
    user,
    isLoggedIn: !!user,
    login,
    logout,
  };

  return <ProgressContext.Provider value={value}>{children}</ProgressContext.Provider>;
};

export const useProgress = () => {
  const context = useContext(ProgressContext);
  if (!context) {
    throw new Error('useProgress must be used within a ProgressProvider');
  }
  return context;
};
