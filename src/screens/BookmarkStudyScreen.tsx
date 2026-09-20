import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  ScrollView,
  StatusBar,
  ActivityIndicator,
  Modal,
  TextInput,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useProgress } from '../storage/progressStore';
import { useAuth } from '../context/AuthContext';
import { Word, WordSentenceItem } from '../types';
import { Colors } from '../theme/colors';
import { pronounceWord } from '../utils/speech';
import { showToast } from '../utils/toast';
import { Header } from '../components/Header';
import { ConfirmDialog, DialogPayload } from '../components/ConfirmDialog';
import { ActionSheet } from '../components/ActionSheet';
import {
  fetchBookmarkedWords,
  BOOKMARK_PAGE_SIZE,
  reportBookmarkReview,
  BOOKMARK_REVIEW_TYPE,
  BookmarkGrade,
  deleteBookmarkNote,
  fetchBookmarkPackDetail,
  saveBookmarkPackDetail,
  parsePackConf,
  parsePackBtnsSetting,
  daysToDelay,
  delayToDays,
  DEFAULT_PACK_BTNS_SETTING,
  PackBtnsSetting,
} from '../services/bookmarkApi';
import { AUTH_EXPIRED_RESULT } from '../services/api';
import { playRememberedSound } from '../utils/effectSound';
import { checkVipGate, clearVipGateCache } from '../services/vipGate';

/**
 * 生词本复习页（与「分类卡组背词页」相互独立）
 * - 从生词本列表点击第 N 个单词进入，队列从该词开始，可连续复习到列表末尾
 * - 列表每次只取 BOOKMARK_PAGE_SIZE(20) 个，剩余不足 PREFETCH_THRESHOLD 张时
 *   自动预取下一页，用户一直往后翻也不会断档
 * - 底部四个档位直接对应服务端 type：困难 0 / 一般 1 / 容易 3 / 已记住 4，
 *   只上报给生词本卡组，不走分类卡组的 SRS 记忆算法
 */

/** 队列剩余多少张卡片时开始预取下一页 */
const PREFETCH_THRESHOLD = 3;

/** 旧版「默认显示答案」的存储 key：只用于兼容迁移，新设置统一存 STUDY_SETTING_KEY */
const LEGACY_SHOW_ANSWER_KEY = 'ciba-bookmark-default-show-answer';

/** 学习过程自定义（key 与 web 端 localStorage 的 ciba-card-preview-setting 保持一致） */
const STUDY_SETTING_KEY = 'ciba-card-preview-setting';

/**
 * 学习过程自定义三项（对齐 web Setting.vue 的 setting 结构）：
 * 显示答案 / 自动播放问题语音 / 自动播放答案语音，后两者互斥。
 */
interface StudySetting {
  show_answer: number;
  play_problem_voice: number;
  play_answer_voice: number;
}

const DEFAULT_STUDY_SETTING: StudySetting = {
  show_answer: 0,
  play_problem_voice: 0,
  play_answer_voice: 0,
};

/** 底部四档操作栏高度：浮动「已记住」要按它 + 底部安全区往上让位，否则真机被挡住 */
const BOTTOM_BAR_HEIGHT = 66;

/** 浮动「已记住」与操作栏之间的间距 */
const FLOAT_REMEMBER_GAP = 12;

/** 底部档位按钮（id 1/2/3）与评分档位的对应关系，第四档「已记住」单独走浮动按钮 */
const OP_GRADE_BY_ID: Record<number, BookmarkGrade> = {
  1: 'hard',
  2: 'normal',
  3: 'easy',
};

/** 档位按钮底色 */
const OP_COLOR_BY_ID: Record<number, string> = {
  1: Colors.danger,
  2: Colors.warning,
  3: Colors.primary,
};

/** 评分 -> 卡片状态线颜色，与 web 背诵页 .card_status_line.status_N 一致 */
const GRADE_COLOR: Record<BookmarkGrade, string> = {
  hard: Colors.danger,
  normal: Colors.warning,
  easy: Colors.primary,
  remembered: Colors.success,
};

/** 卡片状态 0 未学 / 1、2、3 学习中 / 4 已记住 对应的状态线颜色 */
function typeColor(type?: number): string {
  if (type === 1) return Colors.danger;
  if (type === 2) return Colors.warning;
  if (type === 3) return Colors.primary;
  if (type === 4) return Colors.success;
  return Colors.border;
}

/** 千分位显示：2519 -> 2,519 */
function formatNumber(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

interface BookmarkStudyScreenProps {
  route: any;
  navigation: any;
}

/** 按 id 去重合并，保留先出现的顺序（同 id 用新数据覆盖） */
function mergeWords(prev: Word[], next: Word[]): Word[] {
  if (!next.length) return prev;
  const map = new Map<number, Word>();
  prev.forEach((w) => map.set(w.id, w));
  next.forEach((w) => map.set(w.id, w));
  return Array.from(map.values());
}

export const BookmarkStudyScreen: React.FC<BookmarkStudyScreenProps> = ({ route, navigation }) => {
  const params = route.params || {};
  const { state, stats, updateSettings } = useProgress();
  // 会员状态与注册时间都来自用户信息
  const { user, refreshUserInfo } = useAuth();
  /** 底部安全区（iPhone home indicator）：浮动按钮要抬高到操作栏之上 */
  const insets = useSafeAreaInsets();

  /** 列表页带过来的已加载生词（服务端第一页起） */
  const initialWords: Word[] = Array.isArray(params.words) ? params.words : [];
  const initialTotal: number = Number(params.total) || initialWords.length;
  /** 列表页当前 tab 的卡片状态过滤，翻页时要沿用，否则会从别的分组里接着取 */
  const initialTypes: number[] | undefined = Array.isArray(params.types)
    ? (params.types as number[])
    : undefined;
  const startIndex: number = Math.max(
    0,
    Math.min(Number(params.startIndex) || 0, Math.max(0, initialWords.length - 1))
  );

  // 会话队列：从点击的那张开始
  const [queue, setQueue] = useState<Word[]>(() =>
    initialWords.length ? initialWords.slice(startIndex) : []
  );
  const [total, setTotal] = useState(Math.max(initialTotal, initialWords.length));
  const [hasMore, setHasMore] = useState(
    initialWords.length === 0 || initialWords.length < Math.max(initialTotal, initialWords.length)
  );
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [grading, setGrading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState('');
  // 已经复习到最后一张、且下一页拉取失败：停在当前卡片等用户重试
  const [boundaryFailed, setBoundaryFailed] = useState(false);
  const [sessionCompleted, setSessionCompleted] = useState(false);
  const [learnedInSessionCount, setLearnedInSessionCount] = useState(0);
  /** 被会员限制拦截下来的评分，开通会员后自动继续 */
  const pendingGradeRef = useRef<BookmarkGrade | null>(null);
  /** 需要升级会员时的提示文案（非空即弹窗） */
  const [vipGateMessage, setVipGateMessage] = useState<string | null>(null);
  /** 统一弹窗状态：确认/提示一律走 ConfirmDialog，不再使用系统 Alert */
  const [dialog, setDialog] = useState<DialogPayload | null>(null);
  /** 右上角动作菜单（删除卡片 / 设置） */
  const [sheetVisible, setSheetVisible] = useState(false);
  /** 卡片设置面板 */
  const [settingsVisible, setSettingsVisible] = useState(false);
  /**
   * 设置面板里的保存失败提示。
   * 不弹 ConfirmDialog：那样会变成「设置面板 Modal 还开着又要 present 一个 Modal」，
   * iOS 上两个 Modal 叠着 present 会把层级搞乱，表现为弹不出来甚至整页点不动。
   */
  const [settingError, setSettingError] = useState('');
  /** 学习过程自定义（本地设置）：显示答案 / 自动播放问题语音 / 自动播放答案语音 */
  const [studySetting, setStudySetting] = useState<StudySetting>(DEFAULT_STUDY_SETTING);
  /** 换到下一张时是否直接展开答案（由 studySetting.show_answer 派生） */
  const [defaultShowAnswer, setDefaultShowAnswer] = useState(false);
  const defaultShowAnswerRef = useRef(false);
  /** 卡组档位设置：每日上限与困难/一般/容易的天数，来自 pack.conf */
  const [packBtns, setPackBtns] = useState<PackBtnsSetting>(DEFAULT_PACK_BTNS_SETTING);
  /** 卡组详情整份数据：PATCH 保存设置时服务端要求整包回传 */
  const packDetailRef = useRef<Record<string, any>>({});
  /** pack.conf 解析后的对象：保存时只改 pack_btns_setting，其它字段原样带回 */
  const packConfRef = useRef<Record<string, any>>({});
  /** 设置面板草稿：点「确定」才写回服务端与本地 */
  const [draftDayLimit, setDraftDayLimit] = useState('60');
  const [draftDays, setDraftDays] = useState<Record<number, string>>({ 1: '1', 2: '3', 3: '7' });
  const [draftSetting, setDraftSetting] = useState<StudySetting>(DEFAULT_STUDY_SETTING);
  const [savingSetting, setSavingSetting] = useState(false);
  /** 删除卡片请求中，避免重复点击 */
  const [deleting, setDeleting] = useState(false);
  /** 本次评分：评分后立刻改掉卡片状态线颜色，不等服务端回写 type */
  const [lastGrade, setLastGrade] = useState<BookmarkGrade | null>(null);

  // 逻辑用的可变引用：避免闭包里拿到过期的 state
  const queueRef = useRef<Word[]>(queue);
  const loadingRef = useRef(false);
  const hasMoreRef = useRef(hasMore);
  const loadFailedRef = useRef(false);
  /** 下一次要从服务端拉取的偏移量（当前已加载的条数） */
  const nextStartRef = useRef(initialWords.length);

  /** 取下一页生词；返回是否真的往队列里追加了新卡片 */
  const loadMore = useCallback(async (): Promise<boolean> => {
    if (loadingRef.current || !hasMoreRef.current) return false;

    loadingRef.current = true;
    loadFailedRef.current = false;
    setLoadingMore(true);
    setMoreError('');

    try {
      let added = false;

      // 极端情况（本地取消收藏导致偏移漂移）下整页可能都是重复卡片，
      // 顺延 start 再取，避免「明明还有更多却提前结束会话」
      for (let attempt = 0; attempt < 3 && !added; attempt += 1) {
        const start = nextStartRef.current;
        const page = await fetchBookmarkedWords({
          start,
          limit: BOOKMARK_PAGE_SIZE,
          types: initialTypes,
        });

        const before = queueRef.current;
        const merged = mergeWords(before, page.words);
        added = merged.length > before.length;

        queueRef.current = merged;
        setQueue(merged);
        setTotal(page.total);
        nextStartRef.current = start + page.words.length;

        if (page.words.length === 0) {
          hasMoreRef.current = false;
          setHasMore(false);
          break;
        }
        hasMoreRef.current = page.hasMore;
        setHasMore(page.hasMore);
        if (!page.hasMore) break;
      }

      return added;
    } catch (err: any) {
      loadFailedRef.current = true;
      setMoreError(
        err?.result === AUTH_EXPIRED_RESULT
          ? '登录后即可继续复习生词'
          : err?.message || '加载更多生词失败'
      );
      return false;
    } finally {
      loadingRef.current = false;
      setLoadingMore(false);
    }
  }, []);

  /**
   * 预取：当前卡片接近已加载末尾时提前拉下一页。
   * 队列为空（如深链进入）时从第一页开始加载。
   */
  useEffect(() => {
    if (sessionCompleted) return;

    if (!queue.length) {
      nextStartRef.current = 0;
      hasMoreRef.current = true;
      setHasMore(true);
      loadMore();
      return;
    }

    if (!hasMoreRef.current || loadingRef.current) return;
    if (currentIndex >= queue.length - PREFETCH_THRESHOLD) {
      loadMore();
    }
  }, [currentIndex, queue.length, sessionCompleted, loadMore]);

  const currentWord = queue[currentIndex];
  /** 在生词本中的绝对序号（用于「问题 N / 总数」展示） */
  const absoluteIndex = startIndex + currentIndex;
  const displayTotal = Math.max(total, queue.length);

  /** 英 / 美音标，各自可点击发音 */
  const phoneticEntries = useMemo(() => {
    const word = currentWord;
    if (!word) return [] as { key: string; label: string; phonetic: string; accent: 'en-GB' | 'en-US' }[];
    const result: { key: string; label: string; phonetic: string; accent: 'en-GB' | 'en-US' }[] = [];
    if (word.phoneticEn) {
      result.push({ key: 'en', label: '英', phonetic: word.phoneticEn, accent: 'en-GB' });
    }
    if (word.phoneticAm) {
      result.push({ key: 'am', label: '美', phonetic: word.phoneticAm, accent: 'en-US' });
    }
    return result;
  }, [currentWord]);

  /** 中文释义：note.data 里用 <br> 换行、用 \t 分隔同词性的多个义项 */
  const meaningLines = useMemo(() => {
    const raw = (currentWord?.meaning || '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/\t+/g, '；')
      .split('\n')
      .map((line) => line.replace(/\s+/g, ' ').replace(/；+$/, '').trim())
      .filter(Boolean);
    return raw;
  }, [currentWord]);

  const sentences: WordSentenceItem[] = useMemo(
    () =>
      (currentWord?.sentences || []).filter((s) => s && (s.english || s.chinese)) as WordSentenceItem[],
    [currentWord]
  );

  /**
   * 首次进入：读取本地学习设置（显示答案 / 问题语音 / 答案语音）。
   * 老版本只存过「默认显示答案」，这里做一次兜底迁移。
   */
  useEffect(() => {
    (async () => {
      let setting: StudySetting = { ...DEFAULT_STUDY_SETTING };
      try {
        const raw = await AsyncStorage.getItem(STUDY_SETTING_KEY);
        if (raw) {
          setting = { ...setting, ...JSON.parse(raw) };
        } else {
          const legacy = await AsyncStorage.getItem(LEGACY_SHOW_ANSWER_KEY);
          setting = {
            show_answer: legacy === '1' ? 1 : 0,
            play_problem_voice: state.autoPronounce ? 1 : 0,
            play_answer_voice: 0,
          };
        }
      } catch {
        // 读不到就用默认值：手动点开答案
      }
      setStudySetting(setting);
      const on = setting.show_answer === 1;
      setDefaultShowAnswer(on);
      defaultShowAnswerRef.current = on;
      setShowAnswer(on);
    })();
  }, []);

  /** 拉取卡组详情（含 conf 里的档位设置）：失败时保持默认档位，不阻断背词 */
  useEffect(() => {
    (async () => {
      try {
        const pack = await fetchBookmarkPackDetail();
        packDetailRef.current = pack;
        const confObj = parsePackConf(pack.conf);
        packConfRef.current = confObj;
        setPackBtns(parsePackBtnsSetting(confObj));
      } catch {
        packDetailRef.current = {};
        packConfRef.current = {};
      }
    })();
  }, []);

  /** 换卡片后清掉上一次评分，状态线回到服务端给出的卡片状态 */
  useEffect(() => {
    setLastGrade(null);
  }, [currentIndex]);

  // 切换到新词时自动播放问题语音（对应 web 的「自动播放问题里面的语音」）
  useEffect(() => {
    if (currentWord && studySetting.play_problem_voice === 1 && !sessionCompleted) {
      pronounceWord(currentWord.word, {
        accent: state.accent,
        rate: state.speechRate,
      });
    }
  }, [currentIndex, sessionCompleted, studySetting.play_problem_voice]);

  // 展开答案时自动朗读例句（对应 web 的「自动播放答案里面的语音」）
  useEffect(() => {
    if (!showAnswer || studySetting.play_answer_voice !== 1 || sessionCompleted) return;
    const first = (currentWord?.sentences || []).find((s) => s.english);
    if (!first?.english) return;
    pronounceWord(first.english, { accent: state.accent, rate: state.speechRate });
    // 只在「展开答案」这一刻播一次，切换口音/语速时不必重播
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showAnswer, currentIndex, studySetting.play_answer_voice]);

  const goNext = () => {
    setShowAnswer(defaultShowAnswerRef.current);
    setCurrentIndex((prev) => prev + 1);
  };

  /** 点音标前的小喇叭：按对应口音朗读单词 */
  const handlePronounce = (accent: 'en-GB' | 'en-US') => {
    if (!currentWord) return;
    pronounceWord(currentWord.word, { accent, rate: state.speechRate });
  };

  /** 写入本地学习设置（显示答案 / 问题语音 / 答案语音） */
  const persistStudySetting = useCallback(async (setting: StudySetting) => {
    setStudySetting(setting);
    const on = setting.show_answer === 1;
    setDefaultShowAnswer(on);
    defaultShowAnswerRef.current = on;
    try {
      await AsyncStorage.setItem(STUDY_SETTING_KEY, JSON.stringify(setting));
    } catch {
      // 存不下不影响本次会话使用
    }
  }, []);

  /** 打开设置面板：把当前配置灌进草稿，点「确定」才生效 */
  const handleOpenSetting = () => {
    setDraftDayLimit(String(packBtns.day_limit || DEFAULT_PACK_BTNS_SETTING.day_limit));
    const days: Record<number, string> = {};
    packBtns.btns.forEach((btn) => {
      days[btn.id] = String(btn.id === 4 ? 0 : delayToDays(btn.delay));
    });
    setDraftDays(days);
    setDraftSetting({ ...studySetting });
    setSettingError('');
    setSettingsVisible(true);
  };

  /**
   * 右上角动作菜单：删除卡片 / 设置。
   * 菜单本身是页面内的浮层（不是 Modal），所以这里可以关掉菜单后直接开新弹层，
   * 不存在 iOS 上「关一个 Modal 再 present 另一个」被吞掉、点了没反应的问题。
   */
  const handleSheetSelect = (key: string) => {
    setSheetVisible(false);
    if (key === 'setting') {
      handleOpenSetting();
      return;
    }
    if (key === 'delete') {
      setDialog({
        title: '删除卡片',
        message: '确定要删除该卡片吗?',
        confirmText: '删除',
        onConfirm: () => {
          void handleDeleteCard();
        },
      });
    }
  };

  /**
   * 删除当前卡片：DELETE /anki/note/{noteId}.json，
   * 成功后把卡片从队列里摘掉并切到下一张（删的是最后一张就退回新的末尾）。
   */
  const handleDeleteCard = async () => {
    const word = queueRef.current[currentIndex];
    if (!word || deleting) return;
    if (!word.noteId) {
      showToast('该卡片缺少必要信息，暂时无法删除');
      return;
    }

    setDeleting(true);
    try {
      await deleteBookmarkNote(word.noteId);
      const next = queueRef.current.filter((_, index) => index !== currentIndex);
      queueRef.current = next;
      setQueue(next);
      setTotal((prev) => Math.max(0, prev - 1));
      setShowAnswer(defaultShowAnswerRef.current);
      showToast('已删除卡片');

      if (!next.length) {
        // 队列空了：再取一次，确实没有内容就进完成态
        nextStartRef.current = 0;
        hasMoreRef.current = true;
        const grew = await loadMore();
        if (!grew) setSessionCompleted(true);
        return;
      }
      if (currentIndex >= next.length) {
        setCurrentIndex(next.length - 1);
      }
    } catch (e: any) {
      setDialog({
        title: '删除失败',
        message: e?.message || '删除卡片失败，请稍后重试',
        showCancel: false,
      });
    } finally {
      setDeleting(false);
    }
  };

  /** 设置面板开关：问题语音与答案语音互斥，和 web Setting.vue 一致 */
  const handleDraftToggle = (key: keyof StudySetting) => {
    setDraftSetting((prev) => {
      const next = { ...prev, [key]: prev[key] === 1 ? 0 : 1 };
      if (key === 'play_problem_voice' && next.play_problem_voice === 1) {
        next.play_answer_voice = 0;
      }
      if (key === 'play_answer_voice' && next.play_answer_voice === 1) {
        next.play_problem_voice = 0;
      }
      return next;
    });
  };

  /** 确定：档位设置写回卡组 conf（整包 PATCH），学习过程设置写本地 */
  const handleSaveSetting = async () => {
    const dayLimit = Number(draftDayLimit);
    if (!Number.isFinite(dayLimit) || dayLimit < 1) {
      showToast('每日添加新学习卡片至少 1 个');
      return;
    }
    // 卡组详情没拉到就没法整包回传，避免把服务端字段清掉
    if (!Number(packDetailRef.current?.id)) {
      showToast('卡组信息还在加载，请稍后重试');
      return;
    }

    setSavingSetting(true);
    setSettingError('');
    try {
      const prevBtnSetting = packConfRef.current.pack_btns_setting || {};
      const btns = packBtns.btns.map((btn) => {
        if (btn.id === 4) return { ...btn, delay: 0, day: 0 };
        const days = Number(draftDays[btn.id]);
        const day = Number.isFinite(days) && days > 0 ? Math.floor(days) : 0;
        // delay 与 day 要同时写，web 端 conf 里两字段都存在
        return { ...btn, delay: daysToDelay(day), day };
      });
      const nextBtnSetting = {
        ...prevBtnSetting,
        day_limit: Math.floor(dayLimit),
        alert_time: prevBtnSetting.alert_time || '',
        btns,
      };
      const conf = { ...packConfRef.current, pack_btns_setting: nextBtnSetting };
      // 服务端要求回传整个卡组对象，只改 conf（与 web 的 modifyPackage(this.pack) 一致）
      const nextPack = { ...packDetailRef.current, conf: JSON.stringify(conf) };

      await saveBookmarkPackDetail(nextPack);
      packDetailRef.current = nextPack;
      packConfRef.current = conf;
      setPackBtns(parsePackBtnsSetting(conf));
      await persistStudySetting(draftSetting);
      setSettingsVisible(false);
      showToast('修改成功');
    } catch (e: any) {
      // 面板保持打开，错误就地显示，方便直接改完再试
      setSettingError(e?.message || '设置保存失败，请稍后重试');
    } finally {
      setSavingSetting(false);
    }
  };

  /**
   * 稍后重来：不上报评分，把当前卡片排到队尾稍后再见到它。
   * 还能往下翻就先翻，到最后一张时才把它重新塞回队列。
   */
  const handleLater = async () => {
    if (!currentWord || grading) return;
    setBoundaryFailed(false);

    if (currentIndex + 1 < queueRef.current.length) {
      goNext();
      return;
    }

    if (hasMoreRef.current) {
      const grew = await loadMore();
      if (grew) {
        goNext();
        return;
      }
      if (loadFailedRef.current) {
        setBoundaryFailed(true);
        return;
      }
    }

    // 已经学完一轮：把当前卡片再排一次，立刻切到它
    const target = queueRef.current[currentIndex];
    if (!target) return;
    setQueue((prev) => {
      const next = [...prev, target];
      queueRef.current = next;
      return next;
    });
    setShowAnswer(defaultShowAnswerRef.current);
    setCurrentIndex((prev) => prev + 1);
  };

  const handleGrade = async (grade: BookmarkGrade) => {
    if (!currentWord || grading) return;

    setGrading(true);
    setBoundaryFailed(false);
    try {
      // 只有「已记住」受免费额度限制，困难/一般/容易只是复习档位，不做拦截
      if (grade === 'remembered') {
        const gate = await checkVipGate({
          userVip: (user as any)?.vip,
          masteredCount: stats.masteredCount,
          createDate: (user as any)?.createDate,
        });
        if (gate.blocked) {
          pendingGradeRef.current = grade;
          setVipGateMessage(gate.message || '升级 VIP 会员后可继续使用');
          return;
        }
      }

      // 生词本复习独立上报：把档位对应的 type 报给生词本卡组
      await reportBookmarkReview(currentWord.id, BOOKMARK_REVIEW_TYPE[grade]);
      if (grade === 'remembered') playRememberedSound();
      setLearnedInSessionCount((prev) => prev + 1);
      // 立刻反映到卡片状态线，不等列表刷新
      setLastGrade(grade);

      // 队列里还有下一张
      if (currentIndex + 1 < queueRef.current.length) {
        goNext();
        return;
      }

      // 已到最后一张：还有更多就先拉一页再继续
      if (hasMoreRef.current) {
        const grew = await loadMore();
        if (grew) {
          goNext();
          return;
        }
        if (loadFailedRef.current) {
          setBoundaryFailed(true);
          return;
        }
      }

      setSessionCompleted(true);
    } catch (e: any) {
      setDialog({
        title: '保存失败',
        message: e?.message || '学习结果上报失败，请重试',
        showCancel: false,
      });
    } finally {
      setGrading(false);
    }
  };

  // 供「从会员页返回」时调用最新的 handleGrade
  const handleGradeRef = useRef(handleGrade);
  useEffect(() => {
    handleGradeRef.current = handleGrade;
  }, [handleGrade]);

  /**
   * 从会员页返回：先刷新用户信息与会员状态，
   * 已开通会员就自动继续刚才被拦截的「已记住」。
   */
  useFocusEffect(
    useCallback(() => {
      const pending = pendingGradeRef.current;
      if (!pending) return;
      (async () => {
        clearVipGateCache();
        try {
          await refreshUserInfo?.();
        } catch {
          // 刷新失败不阻断，下面仍会按最新接口结果判断
        }
        const gate = await checkVipGate({
          userVip: (user as any)?.vip,
          masteredCount: stats.masteredCount,
          createDate: (user as any)?.createDate,
        });
        if (gate.blocked) {
          // 没开通就丢弃待办：否则每次回到页面都会重复刷新并一直挂着这次操作
          pendingGradeRef.current = null;
          return;
        }
        pendingGradeRef.current = null;
        showToast('会员已开通，继续复习');
        handleGradeRef.current(pending);
      })();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user, stats.masteredCount])
  );

  /** 拉取失败后重试：如果是因为卡在末尾失败，成功后自动翻到下一页 */
  const handleRetryMore = async () => {
    const wasBoundary = boundaryFailed;
    setBoundaryFailed(false);
    const grew = await loadMore();
    if (grew && wasBoundary && currentIndex + 1 < queueRef.current.length) {
      goNext();
    }
  };

  // 队列为空：要么还在拉第一页，要么生词本确实没有内容
  if (!queue.length) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <Header title="生词复习" onBack={() => navigation.goBack()} />
        <View style={styles.emptyContainer}>
          {loadingMore ? (
            <>
              <ActivityIndicator size="large" color={Colors.primary} />
              <Text style={styles.emptySubtitle}>正在加载生词本...</Text>
            </>
          ) : (
            <>
              <Ionicons name="bookmark-outline" size={64} color={Colors.border} />
              <Text style={styles.emptyTitle}>暂无生词</Text>
              <Text style={styles.emptySubtitle}>
                {moreError || '生词本里还没有单词，先去收藏几个吧'}
              </Text>
              {moreError ? (
                <TouchableOpacity
                  style={styles.returnBtn}
                  onPress={handleRetryMore}
                  activeOpacity={0.8}
                >
                  <Text style={styles.returnBtnText}>重新加载</Text>
                </TouchableOpacity>
              ) : null}
            </>
          )}
        </View>
      </SafeAreaView>
    );
  }

  // 复习完成
  if (sessionCompleted) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <Header title="复习成果" onBack={() => navigation.goBack()} />
        <View style={styles.completeWrap}>
          <View style={styles.trophyCircle}>
            <Ionicons name="trophy" size={56} color={Colors.gold} />
          </View>
          <Text style={styles.completeTitle}>生词复习完成！</Text>
          <Text style={styles.completeSubtitle}>
            本次复习了 <Text style={styles.highlightText}>{learnedInSessionCount}</Text> 个生词
          </Text>

          <View style={styles.statsSummaryCard}>
            <View style={styles.statCol}>
              <Text style={styles.statVal}>{state.streakDays}</Text>
              <Text style={styles.statLbl}>连续天数</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statCol}>
              <Text style={styles.statVal}>{state.todayLearnedIds.length}</Text>
              <Text style={styles.statLbl}>今日已学</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statCol}>
              <Text style={styles.statVal}>{stats.masteredCount}</Text>
              <Text style={styles.statLbl}>总掌握词</Text>
            </View>
          </View>

          <TouchableOpacity
            style={styles.doneBtn}
            onPress={() => navigation.goBack()}
            activeOpacity={0.8}
          >
            <Text style={styles.doneBtnText}>完成并返回</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  /** 卡片状态线颜色：本次评分优先，其次用服务端卡片状态 */
  const statusColor = lastGrade ? GRADE_COLOR[lastGrade] : typeColor(currentWord.type);

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" backgroundColor={Colors.background} />

      <Header
        title={`单词 ${absoluteIndex + 1} / ${displayTotal}`}
        onBack={() => navigation.goBack()}
        rightAction={{ icon: 'ellipsis-horizontal', onPress: () => setSheetVisible(true) }}
      />

      {/* 词头（固定）：单词 / 英&美音标（各自可点读）/ 词频与复习次数 */}
      <View style={styles.wordHead}>
        <Text style={styles.mainWordText} numberOfLines={2}>
          {currentWord.word}
        </Text>

        {phoneticEntries.length ? (
          <View style={styles.phoneticRow}>
            {phoneticEntries.map((item) => (
              <TouchableOpacity
                key={item.key}
                style={styles.phoneticItem}
                onPress={() => handlePronounce(item.accent)}
                activeOpacity={0.7}
              >
                <Ionicons name="volume-medium-outline" size={16} color={Colors.primary} />
                <Text style={styles.phoneticLabel}>{item.label}</Text>
                <Text style={styles.phoneticText}>/{item.phonetic}/</Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : null}

        <View style={styles.metaRow}>
          {currentWord.frequence ? (
            <View style={styles.freqBadge}>
              <Text style={styles.freqText}>词频: {formatNumber(currentWord.frequence)}</Text>
            </View>
          ) : (
            <View />
          )}
          {currentWord.times ? <Text style={styles.timesText}>{currentWord.times}次</Text> : null}
        </View>
      </View>

      {/* 卡片状态线（web 的 .card_status_line） */}
      <View style={[styles.statusLine, { backgroundColor: statusColor }]} />

      {/* 答案区：未展开时是「点击查看答案」，展开后可滚动 */}
      <View style={styles.answerArea}>
        <Text style={styles.answerTitle}>答案</Text>

        {!showAnswer ? (
          <TouchableOpacity
            style={styles.revealWrap}
            onPress={() => setShowAnswer(true)}
            activeOpacity={0.9}
          >
            <View style={styles.revealBtn}>
              <Text style={styles.revealText}>点击查看答案</Text>
            </View>
          </TouchableOpacity>
        ) : (
          <ScrollView
            style={styles.answerScroll}
            contentContainerStyle={styles.answerInner}
            showsVerticalScrollIndicator={false}
          >
            {meaningLines.length ? (
              <View style={styles.meaningBlock}>
                {meaningLines.map((line, idx) => (
                  <Text key={idx} style={styles.meaningLine}>
                    {line}
                  </Text>
                ))}
              </View>
            ) : null}

            {sentences.length ? (
              <View style={styles.sentenceBlock}>
                {sentences.map((item, idx) => (
                  <View key={idx} style={styles.sentenceItem}>
                    {item.english ? (
                      <TouchableOpacity
                        style={styles.sentenceSound}
                        onPress={() =>
                          pronounceWord(item.english, {
                            accent: state.accent,
                            rate: state.speechRate,
                          })
                        }
                        activeOpacity={0.7}
                        hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                      >
                        <Ionicons name="volume-medium-outline" size={16} color={Colors.primary} />
                      </TouchableOpacity>
                    ) : null}
                    <View style={styles.sentenceTextWrap}>
                      {item.english ? <Text style={styles.enSentence}>{item.english}</Text> : null}
                      {item.chinese ? <Text style={styles.cnSentence}>{item.chinese}</Text> : null}
                    </View>
                  </View>
                ))}
              </View>
            ) : null}

            {!meaningLines.length && !sentences.length ? (
              <Text style={styles.answerEmpty}>该卡片暂无释义内容</Text>
            ) : null}
          </ScrollView>
        )}
      </View>

      {/* 分页状态提示：拉取中 / 拉取失败可重试 */}
      {loadingMore ? (
        <View style={styles.moreHintWrap}>
          <ActivityIndicator size="small" color={Colors.primary} />
          <Text style={styles.moreHintText}>正在加载更多生词...</Text>
        </View>
      ) : moreError ? (
        <TouchableOpacity style={styles.moreHintWrap} onPress={handleRetryMore} activeOpacity={0.7}>
          <Ionicons name="refresh" size={16} color={Colors.primary} />
          <Text style={styles.moreErrorText}>加载更多失败，点击重试</Text>
        </TouchableOpacity>
      ) : null}

      {/* 右下角浮动「已记住」，对应 web 的 .slide_mark_finish；bottom 按操作栏 + 安全区动态计算 */}
      <TouchableOpacity
        style={[
          styles.floatRemember,
          { bottom: BOTTOM_BAR_HEIGHT + insets.bottom + FLOAT_REMEMBER_GAP },
          grading && styles.actionBtnDisabled,
        ]}
        onPress={() => handleGrade('remembered')}
        activeOpacity={0.9}
        disabled={grading}
      >
        {grading ? (
          <ActivityIndicator size="small" color="#FFFFFF" />
        ) : (
          <Ionicons name="checkmark" size={26} color="#FFFFFF" />
        )}
      </TouchableOpacity>

      {/* 底部四档：稍后重来 + 困难/一般/容易（名称与天数取自卡组设置，web 的 .card_operate） */}
      <View style={styles.bottomBar}>
        <TouchableOpacity
          style={[styles.opItem, styles.opDefault]}
          onPress={handleLater}
          activeOpacity={0.9}
        >
          <Text style={[styles.opDelay, styles.opDefaultText]}>稍后</Text>
          <Text style={[styles.opName, styles.opDefaultText]}>重来</Text>
        </TouchableOpacity>

        {packBtns.btns
          .filter((btn) => btn.id !== 4)
          .slice(0, 3)
          .map((btn) => {
            const grade = OP_GRADE_BY_ID[btn.id];
            if (!grade) return null;
            const days = delayToDays(btn.delay);
            return (
              <TouchableOpacity
                key={btn.id}
                style={[
                  styles.opItem,
                  { backgroundColor: OP_COLOR_BY_ID[btn.id] || Colors.primary },
                  grading && styles.actionBtnDisabled,
                ]}
                onPress={() => handleGrade(grade)}
                activeOpacity={0.9}
                disabled={grading}
              >
                {days > 0 ? <Text style={styles.opDelay}>{days}天</Text> : null}
                <Text style={styles.opName}>{btn.name}</Text>
              </TouchableOpacity>
            );
          })}
      </View>

      {/* 卡片设置：档位设置回写卡组 conf，学习过程设置存本地（对齐 web Setting.vue） */}
      <Modal
        visible={settingsVisible}
        transparent
        animationType="slide"
        statusBarTranslucent
        onRequestClose={() => setSettingsVisible(false)}
      >
        <View style={styles.modalMask}>
          <TouchableOpacity
            style={styles.modalMaskFlex}
            activeOpacity={1}
            onPress={() => setSettingsVisible(false)}
          />
          <SafeAreaView style={styles.settingSheet}>
            <View style={styles.settingHeader}>
              <Text style={styles.settingHeaderTitle}>设置</Text>
            </View>

            <ScrollView
              style={styles.settingBody}
              contentContainerStyle={styles.settingBodyInner}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {/* 卡组设置：每日上限 + 三个档位的间隔天数 */}
              <View style={styles.settingItem}>
                <Text style={styles.settingItemText}>每日添加新学习卡片</Text>
                <TextInput
                  style={styles.settingInput}
                  value={draftDayLimit}
                  onChangeText={(text) => setDraftDayLimit(text.replace(/[^\d]/g, ''))}
                  keyboardType="number-pad"
                  maxLength={4}
                  placeholder="60"
                  placeholderTextColor={Colors.textMuted}
                />
                <Text style={styles.settingItemText}>个</Text>
              </View>

              <Text style={styles.settingGroupTitle}>复习模式自定义</Text>
              {packBtns.btns
                .filter((btn) => btn.id !== 4)
                .map((btn) => (
                  <View key={btn.id} style={styles.settingItem}>
                    <Text style={styles.settingItemText}>{btn.name}</Text>
                    <TextInput
                      style={styles.settingInput}
                      value={draftDays[btn.id] ?? ''}
                      onChangeText={(text) =>
                        setDraftDays((prev) => ({ ...prev, [btn.id]: text.replace(/[^\d]/g, '') }))
                      }
                      keyboardType="number-pad"
                      maxLength={4}
                      placeholder="0"
                      placeholderTextColor={Colors.textMuted}
                    />
                    <Text style={styles.settingItemText}>天后出现进行学习</Text>
                  </View>
                ))}

              {/* 学习过程自定义：三项本地设置，问题语音与答案语音互斥 */}
              <Text style={styles.settingGroupTitle}>学习过程自定义</Text>
              {(
                [
                  ['show_answer', '显示问题的同时显示答案'],
                  ['play_problem_voice', '自动播放问题里面的语音'],
                  ['play_answer_voice', '自动播放答案里面的语音'],
                ] as [keyof StudySetting, string][]
              ).map(([key, label]) => (
                <TouchableOpacity
                  key={key}
                  style={styles.settingCheckRow}
                  activeOpacity={0.8}
                  onPress={() => handleDraftToggle(key)}
                >
                  <Ionicons
                    name={draftSetting[key] === 1 ? 'checkbox' : 'square-outline'}
                    size={20}
                    color={draftSetting[key] === 1 ? Colors.primary : Colors.textMuted}
                  />
                  <Text style={styles.settingCheckText}>{label}</Text>
                </TouchableOpacity>
              ))}
              <Text style={styles.settingTip}>问题语音与答案语音只能二选一</Text>

              {/* 发音口音：本地专有设置，音标与例句朗读共用 */}
              <Text style={styles.settingGroupTitle}>发音口音</Text>
              <View style={styles.accentGroup}>
                <TouchableOpacity
                  style={[styles.accentBtn, state.accent === 'en-GB' && styles.accentBtnActive]}
                  onPress={() => updateSettings({ accent: 'en-GB' })}
                  activeOpacity={0.85}
                >
                  <Text style={[styles.accentBtnText, state.accent === 'en-GB' && styles.accentBtnTextActive]}>
                    英式
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.accentBtn, state.accent === 'en-US' && styles.accentBtnActive]}
                  onPress={() => updateSettings({ accent: 'en-US' })}
                  activeOpacity={0.85}
                >
                  <Text style={[styles.accentBtnText, state.accent === 'en-US' && styles.accentBtnTextActive]}>
                    美式
                  </Text>
                </TouchableOpacity>
              </View>
            </ScrollView>

            {/* 保存失败提示就地显示，不叠第二层弹窗 */}
            {settingError ? <Text style={styles.settingErrorText}>{settingError}</Text> : null}

            {/* 底部：取消 / 确定，「确定」才写回卡组与本地 */}
            <View style={styles.settingFooter}>
              <TouchableOpacity
                style={[styles.settingFooterBtn, styles.settingFooterCancel]}
                onPress={() => setSettingsVisible(false)}
                activeOpacity={0.85}
              >
                <Text style={styles.settingFooterCancelText}>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.settingFooterBtn,
                  styles.settingFooterConfirm,
                  savingSetting && styles.actionBtnDisabled,
                ]}
                onPress={handleSaveSetting}
                activeOpacity={0.85}
                disabled={savingSetting}
              >
                {savingSetting ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.settingFooterConfirmText}>确定</Text>
                )}
              </TouchableOpacity>
            </View>
          </SafeAreaView>
        </View>
      </Modal>

      {/* 右上角动作菜单：删除卡片 / 设置 / 取消 */}
      <ActionSheet
        visible={sheetVisible}
        items={[
          { key: 'delete', name: '删除卡片' },
          { key: 'setting', name: '设置' },
        ]}
        onSelect={handleSheetSelect}
        onClose={() => setSheetVisible(false)}
      />

      <ConfirmDialog
        visible={vipGateMessage !== null}
        title="需要升级 VIP 会员"
        message={vipGateMessage || ''}
        onConfirm={() => {
          setVipGateMessage(null);
          // pendingGradeRef 保留，支付成功后返回会自动继续这次操作
          navigation.navigate('Purchase');
        }}
        onCancel={() => {
          setVipGateMessage(null);
          pendingGradeRef.current = null;
        }}
        onClose={() => setVipGateMessage(null)}
      />

      <ConfirmDialog
        visible={dialog !== null}
        title={dialog?.title || ''}
        message={dialog?.message || ''}
        confirmText={dialog?.confirmText}
        cancelText={dialog?.cancelText}
        showCancel={dialog?.showCancel}
        onConfirm={dialog?.onConfirm}
        onCancel={dialog?.onCancel}
        onClose={() => setDialog(null)}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Colors.card,
  },
  // 词头：单词 + 英/美音标 + 词频次数，滚动不受影响
  wordHead: {
    alignItems: 'center',
    flexShrink: 0,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 12,
  },
  mainWordText: {
    fontSize: 34,
    fontWeight: '700',
    color: Colors.primary,
    textAlign: 'center',
  },
  phoneticRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
    gap: 20,
  },
  phoneticItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  phoneticLabel: {
    fontSize: 13,
    color: Colors.textSecondary,
  },
  phoneticText: {
    fontSize: 14,
    color: Colors.textSecondary,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
    width: '100%',
  },
  freqBadge: {
    borderWidth: 1,
    borderColor: Colors.primary + '55',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  freqText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.primary,
  },
  timesText: {
    fontSize: 12,
    color: Colors.textMuted,
  },
  // 卡片状态线：颜色随本次评分 / 卡片学习状态变化
  statusLine: {
    height: 3,
    width: '100%',
  },
  answerArea: {
    flex: 1,
    paddingTop: 12,
  },
  answerTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.textPrimary,
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  revealWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  revealBtn: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: Colors.primary,
    borderRadius: 999,
    paddingHorizontal: 32,
    paddingVertical: 10,
    backgroundColor: Colors.primary + '0F',
  },
  revealText: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.primary,
  },
  answerScroll: {
    flex: 1,
  },
  answerInner: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 24,
  },
  meaningBlock: {
    marginBottom: 14,
  },
  meaningLine: {
    fontSize: 15,
    color: Colors.textPrimary,
    lineHeight: 24,
  },
  sentenceBlock: {
    gap: 14,
  },
  sentenceItem: {
    flexDirection: 'row',
    gap: 8,
  },
  sentenceSound: {
    paddingTop: 2,
  },
  sentenceTextWrap: {
    flex: 1,
  },
  enSentence: {
    fontSize: 14,
    color: Colors.textPrimary,
    lineHeight: 22,
  },
  cnSentence: {
    fontSize: 13,
    color: Colors.textSecondary,
    lineHeight: 20,
    marginTop: 2,
  },
  answerEmpty: {
    fontSize: 14,
    color: Colors.textMuted,
  },
  moreHintWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    backgroundColor: Colors.card,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border,
  },
  moreHintText: {
    fontSize: 12,
    color: Colors.textMuted,
  },
  moreErrorText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.primary,
  },
  // 底部四档：稍后重来 / 1天困难 / 3天一般 / 7天容易，与 web .card_operate 一致
  bottomBar: {
    flexDirection: 'row',
    height: BOTTOM_BAR_HEIGHT,
    backgroundColor: Colors.card,
  },
  opItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  opDefault: {
    backgroundColor: '#EAE8DF',
  },
  opDelay: {
    fontSize: 12,
    color: '#FFFFFF',
    opacity: 0.9,
  },
  opName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
    marginTop: 2,
  },
  opDefaultText: {
    color: '#63736B',
  },
  // 右下角浮动「已记住」（bottom 由组件按操作栏高度 + 安全区动态给）
  floatRemember: {
    position: 'absolute',
    right: 14,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: Colors.success,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
    shadowColor: Colors.success,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  actionBtnDisabled: {
    opacity: 0.6,
  },
  // 卡片设置面板
  modalMask: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalMaskFlex: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
  },
  // 设置面板：从底部滑出的近全屏面板（对齐 web Setting.vue）
  settingSheet: {
    maxHeight: '86%',
    backgroundColor: Colors.card,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
  },
  settingHeader: {
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.divider,
  },
  settingHeaderTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  settingBody: {
    flexShrink: 1,
  },
  settingBodyInner: {
    paddingHorizontal: 20,
    paddingTop: 6,
    paddingBottom: 16,
  },
  settingItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
  },
  settingItemText: {
    fontSize: 15,
    color: Colors.textPrimary,
  },
  settingInput: {
    minWidth: 56,
    marginHorizontal: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    fontSize: 15,
    textAlign: 'center',
    color: Colors.textPrimary,
    backgroundColor: Colors.background,
  },
  settingGroupTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.textSecondary,
    marginTop: 14,
    marginBottom: 2,
  },
  settingCheckRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
  },
  settingCheckText: {
    fontSize: 14,
    color: Colors.textPrimary,
  },
  settingTip: {
    fontSize: 12,
    color: Colors.textMuted,
    marginTop: 2,
    marginLeft: 28,
  },
  settingFooter: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.divider,
  },
  settingFooterBtn: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  settingFooterCancel: {
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.card,
  },
  settingFooterCancelText: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  // 保存失败就地提示：面板底部一行红字，避免为了提示再叠一个 Modal
  settingErrorText: {
    paddingHorizontal: 16,
    paddingBottom: 10,
    fontSize: 13,
    color: Colors.danger,
  },
  settingFooterConfirm: {
    backgroundColor: Colors.primary,
  },
  settingFooterConfirmText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  accentGroup: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 6,
  },
  accentBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.background,
  },
  accentBtnActive: {
    backgroundColor: Colors.primary + '12',
    borderColor: Colors.primary,
  },
  accentBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  accentBtnTextActive: {
    color: Colors.primary,
  },
  settingsDone: {
    marginTop: 18,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    backgroundColor: Colors.primary,
  },
  settingsDoneText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 30,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: Colors.textPrimary,
    marginTop: 16,
  },
  emptySubtitle: {
    fontSize: 14,
    color: Colors.textSecondary,
    marginTop: 12,
    textAlign: 'center',
    lineHeight: 20,
  },
  returnBtn: {
    marginTop: 24,
    backgroundColor: Colors.primary,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
  },
  returnBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  completeWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  trophyCircle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: Colors.gold + '20',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  completeTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: Colors.textPrimary,
  },
  completeSubtitle: {
    fontSize: 15,
    color: Colors.textSecondary,
    marginTop: 8,
  },
  highlightText: {
    fontSize: 18,
    fontWeight: '800',
    color: Colors.primary,
  },
  statsSummaryCard: {
    flexDirection: 'row',
    backgroundColor: Colors.card,
    borderRadius: 16,
    padding: 20,
    marginVertical: 24,
    width: '100%',
    justifyContent: 'space-around',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  statCol: {
    alignItems: 'center',
  },
  statVal: {
    fontSize: 22,
    fontWeight: '800',
    color: Colors.textPrimary,
  },
  statLbl: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 4,
  },
  statDivider: {
    width: 1,
    height: 30,
    backgroundColor: Colors.divider,
  },
  doneBtn: {
    backgroundColor: Colors.primary,
    width: '100%',
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
  },
  doneBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
});
