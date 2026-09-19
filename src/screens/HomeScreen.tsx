import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Modal,
  TouchableOpacity,
  TouchableWithoutFeedback,
  SafeAreaView,
  StatusBar,
  Image,
  ActivityIndicator,
  RefreshControl,
  Linking,
  NativeScrollEvent,
  NativeSyntheticEvent,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ConfirmDialog, DialogPayload } from '../components/ConfirmDialog';
import { useFocusEffect } from '@react-navigation/native';
import { useProgress } from '../storage/progressStore';
import { useAuth } from '../context/AuthContext';
import { packLibrary, RemotePack } from '../services/packLibrary';
import {
  fetchBookmarkedWords,
  fetchNotebookStats,
  fetchNotebookStudyWords,
  NotebookStats,
  BOOKMARK_REVIEW_TODO_TYPES,
  NOTEBOOK_STUDY_LIMIT,
} from '../services/bookmarkApi';
import { Word } from '../types';
import { Colors, getCategoryColor } from '../theme/colors';
import { ProgressBar } from '../components/ProgressBar';

/** 分类卡组分页大小 */
const SUB_PAGE_SIZE = 30;
/** 生词本「复习待办」一次拉取的数量 */
const NOTEBOOK_REVIEW_LIMIT = 50;
/** 分类卡组默认展示的记住状态: 0 未记住 + 1 进行中 */
const LEARNING_REMEMBER_TYPES = [0, 1];
/** 「已记住」tab: remember_type = 2（已记住数量 = 词数） */
const REMEMBERED_REMEMBER_TYPES = [2];
/** 新安装卡组同步分类卡组时的数量上限，达到即视为同步完成，不再继续轮询 */
const SUB_PACK_SYNC_LIMIT = 20;
/**
 * 已确认没有更多数据时，再次触底的探测间隔。
 * 服务端 total 可能滞后，留一个间隔让用户可以触底重试，同时避免连续发请求。
 */
const SUB_PROBE_INTERVAL = 3000;

interface HomeScreenProps {
  navigation: any;
}

/** 合并分页数据并按 id 去重 */
function mergePacks(prev: RemotePack[], next: RemotePack[]): RemotePack[] {
  const seen = new Set(prev.map((p) => p.id));
  return [...prev, ...next.filter((p) => !seen.has(p.id))];
}

/**
 * 分类卡组是否已「全部记住」
 * 服务端 remembered_card_count 不实时更新，叠加本地学习增量后再比较
 */
function isPackFullyRemembered(pack: RemotePack, delta = 0): boolean {
  const total = pack.card_count || 0;
  if (total <= 0) return false; // 空卡组不算已记住
  const remembered = Math.max(0, Math.min(total, (pack.remembered_card_count || 0) + delta));
  return remembered >= total;
}

export const HomeScreen: React.FC<HomeScreenProps> = ({ navigation }) => {
  const {
    stats,
    isLoggedIn,
    user,
    currentPack,
    todayWordsPackId,
    isLoadingPackWords,
    packWordsPackId,
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
  } = useProgress();

  // 登录态恢复中（避免未登录提示闪一下）
  const { user: authUser, isLoading: authLoading } = useAuth();

  /** 用户资料里的 vip 字段为 1 表示付费会员 */
  const isVip = Number(authUser?.vip) === 1;
  /** 手机号脱敏 */
  const maskMobile = (m?: string) => (m ? m.replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2') : '');
  /** 顶部用户卡片显示的名字 */
  const displayName = isLoggedIn
    ? authUser?.nickname || authUser?.loginName || maskMobile(authUser?.mobile) || '糍粑学员'
    : '未登录';

  // 顶部切换: 我的卡组 (/anki/pack.json, parentId = 0)
  const [topPacks, setTopPacks] = useState<RemotePack[]>([]);
  const [loadingPacks, setLoadingPacks] = useState(true);
  // currentTopPack 由全局 store 持有，其它页面也能读到当前显示的是哪个卡组
  const selectedTop = currentTopPack;
  const setSelectedTop = setCurrentTopPack;

  // 分类卡组列表 (/anki/pack.json?parentId = 父卡组 id)
  const [subPacks, setSubPacks] = useState<RemotePack[]>([]);
  const [subTotal, setSubTotal] = useState(0);
  /**
   * 未记住的卡组（remember_type = 0,1）单独留一份：
   * 今日学习看板、默认选中的分类、背词队列都只认它，
   * 切到「已记住」tab 或点击已记住的卡组都不会影响今日学习的数据。
   */
  const [learningPacks, setLearningPacks] = useState<RemotePack[]>([]);
  /** 分类卡组列表筛选: learning 未记住+进行中 / remembered 已记住 */
  const [subTab, setSubTab] = useState<'learning' | 'remembered'>('learning');
  /** 「已记住」分类卡组的数量，显示在 tab 上 */
  const [rememberedTotal, setRememberedTotal] = useState<number | null>(null);
  /** 「未记住」分类卡组的数量，显示在左侧 tab 上 */
  const [learningTotal, setLearningTotal] = useState<number | null>(null);
  // 当前 subPacks 属于哪个父卡组（避免切换顶部卡组时用旧列表做默认选中）
  const [subPacksParentId, setSubPacksParentId] = useState<number | null>(null);
  const [loadingSubs, setLoadingSubs] = useState(false);

  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [activeSub, setActiveSub] = useState<RemotePack | null>(null);
  /** 「今日学习-生词本」卡片数据：学习目标 / 已学习 / 总数量 */
  const [notebook, setNotebook] = useState<NotebookStats | null>(null);
  const [loadingNotebook, setLoadingNotebook] = useState(false);
  /** 生词本复习待办: 学过但还没记住的单词（type = 1/2/3） */
  const [notebookReviewWords, setNotebookReviewWords] = useState<Word[]>([]);
  const [notebookReviewTotal, setNotebookReviewTotal] = useState(0);
  const [loadingNotebookReview, setLoadingNotebookReview] = useState(false);
  /** 「开始背词」正在拉取生词队列 */
  const [startingNotebookStudy, setStartingNotebookStudy] = useState(false);
  // 新安装卡组的子卡组同步中
  const [preparingPack, setPreparingPack] = useState(false);
  const [preparedCount, setPreparedCount] = useState(0);

  // 已提示过前往卡组市场（避免重复跳转）
  const marketPromptedRef = useRef(false);
  // 刚安装的卡组 id（服务端在后台线程复制子卡组，需要轮询等待）
  const justInstalledRef = useRef<number | null>(null);
  // 已按该账号拉取过卡组（登录/切换账号时重新拉取）
  const loadedUserIdRef = useRef<string | null>(null);
  // 上次记住的卡组名（列表加载完成前先占位显示）
  const [lastPackName, setLastPackName] = useState<string | null>(null);
  // 当前卡组的镜像，供异步回调里读取最新值
  const currentTopPackRef = useRef<RemotePack | null>(null);
  useEffect(() => {
    currentTopPackRef.current = currentTopPack;
  }, [currentTopPack]);

  /**
   * 顶层卡组为空时（例如在「切换词库」里把当前卡组删掉了），
   * 回退到当前在线词库，避免首页没有焦点导致子卡组、今日任务与今日单词都是空的。
   */
  useEffect(() => {
    if (currentTopPack || !currentPack) return;
    const matched = topPacks.find((p) => Number(p.id) === Number((currentPack as any).id));
    if (matched) setSelectedTop(matched);
  }, [currentTopPack, currentPack, topPacks, setSelectedTop]);
  // 子卡组加载代次，避免旧请求覆盖新结果
  const subLoadGenRef = useRef(0);
  // 已自动选过默认分类卡组的父卡组 id（用户手动切换后不再覆盖）
  const autoPickedPackRef = useRef<number | null>(null);
  // 生词本统计请求代次，避免旧结果覆盖新结果
  const notebookReqRef = useRef(0);
  // 生词本复习待办请求代次
  const notebookReviewReqRef = useRef(0);
  // 最近一次的状态快照，供「重新聚焦时刷新」在回调里读取最新值
  const homeRefreshRef = useRef<{
    selectedTop: RemotePack | null;
    activeSub: RemotePack | null;
    subPackCount: number;
  }>({ selectedTop: null, activeSub: null, subPackCount: 0 });
  useEffect(() => {
    homeRefreshRef.current = {
      selectedTop,
      activeSub,
      subPackCount: subPacks.length,
    };
  }, [selectedTop, activeSub, subPacks.length]);

  // 当前子卡组列表的镜像：请求下一页时要拿它去重，也是判断是否还有新增的依据
  const subPacksRef = useRef<RemotePack[]>([]);
  useEffect(() => {
    subPacksRef.current = subPacks;
  }, [subPacks]);
  /**
   * 上一次翻页是否已经确认「没有更多」。
   * 服务端的 total 可能滞后于真实数据（新安装的卡组还在后台复制子卡组，
   * 同步轮询到 SUB_PACK_SYNC_LIMIT 就结束了），所以不能只拿 total 当终点，
   * 到底部时还会再翻一次验证；只有真的翻出 0 条新增才把它置 true。
   * 置 true 后仍允许按 PROBE_INTERVAL 节流地重试，服务端补上数据能自动接上。
   */
  const noMoreSubsRef = useRef(false);
  /** 上一次「到底部探测」的时间戳，防止用户反复触底时疯狂发请求 */
  const lastProbeAtRef = useRef(0);

  // 「未记住」分类卡组的镜像：刷新后要拿它和服务端新数据比对，判断本地增量是否被消化
  const learningPacksRef = useRef<RemotePack[]>([]);
  useEffect(() => {
    learningPacksRef.current = learningPacks;
  }, [learningPacks]);

  // 「已掌握数量」本地增量的镜像：loadSubPacks 要读到最新值，又不想让它成为 useCallback 的依赖
  const masteredDeltaRef = useRef(packMasteredDelta);
  useEffect(() => {
    masteredDeltaRef.current = packMasteredDelta;
  }, [packMasteredDelta]);

  /** 还没被服务端数据消化的本地增量: packId -> { delta, base: 学习前服务端已掌握数 } */
  const pendingDeltaRef = useRef<Record<number, { delta: number; base: number }>>({});

  // 当前 tab 的镜像：刷新 tab 数字时避免在闭包里读到旧值
  const subTabRef = useRef(subTab);
  useEffect(() => {
    subTabRef.current = subTab;
  }, [subTab]);

  /** 顶部卡组: 我的卡组 */
  const loadTopPacks = useCallback(async () => {
    setLoadingPacks(true);
    setErrorMsg(null);
    try {
      const { packs } = await packLibrary.fetchMyPacks({ start: 0, limit: 50 });
      setTopPacks(packs);

      // 我的卡组为空: 引导前往卡组市场添加卡组
      if (!packs.length) {
        // 仅清内存，避免服务端偶发返回空列表时误删「上次记住的卡组」
        resetCurrentTopPack();
        setSubPacks([]);
        setSubTotal(0);
        setSubPacksParentId(null);
        if (!marketPromptedRef.current && isLoggedIn) {
          marketPromptedRef.current = true;
          navigation.navigate('Market', { firstSetup: true });
        }
        return;
      }
      marketPromptedRef.current = false;

      // 读取上次记住的卡组 id
      const rememberedInfo = await readRememberedTopPack();
      const rememberedId = rememberedInfo?.id ?? null;

      // ① 本次已选过且仍存在 -> 保持
      const prev = currentTopPackRef.current;
      if (prev && packs.some((p) => Number(p.id) === Number(prev.id))) return;
      // ② 上次记住的卡组；不存在则 ③ currentPack；再退回 ④ 第一个
      // 注意: 服务端 id 可能返回字符串，统一转成数字再比较
      const remembered =
        rememberedId !== null ? packs.find((p) => Number(p.id) === rememberedId) : undefined;
      const saved = currentPack
        ? packs.find((p) => Number(p.id) === Number(currentPack.id))
        : undefined;
      setSelectedTop(remembered || saved || packs[0] || null);
    } catch (e: any) {
      setErrorMsg(e?.message || '加载我的卡组失败');
    } finally {
      setLoadingPacks(false);
    }
  }, [
    currentPack?.id,
    isLoggedIn,
    navigation,
    readRememberedTopPack,
    resetCurrentTopPack,
    setCurrentTopPack,
  ]);

  /**
   * 用服务端最新数据对齐本地「已掌握数量」增量。
   * 服务端 remembered_card_count 是异步汇总的，刚学完拉到的数据常常还是旧值，
   * 所以只有「服务端数字已经把本地学习结果算进去」时才丢掉对应卡组的增量，
   * 否则继续保留本地增量，避免学完之后「已记住 x/y」反而回落。
   * 每个增量在产生时记下当时的服务端数字做基准，多次刷新也不会把判据算偏。
   */
  const reconcileMasteredDelta = useCallback(
    (fresh: RemotePack[]) => {
      const deltas = masteredDeltaRef.current;
      const pending = pendingDeltaRef.current;
      if (!deltas || !Object.keys(deltas).length) {
        if (Object.keys(pending).length) pendingDeltaRef.current = {};
        return;
      }
      // 本次刷新前已知的服务端数字（上一次加载的快照）
      const snapshot = new Map(
        learningPacksRef.current.map((p) => [Number(p.id), p.remembered_card_count || 0])
      );
      const absorbed: number[] = [];
      for (const pack of fresh) {
        const id = Number(pack.id);
        const delta = deltas[id] || 0;
        if (!delta) {
          delete pending[id];
          continue;
        }
        const now = pack.remembered_card_count || 0;
        let entry = pending[id];
        // 第一次看到该增量（或增量又变了）时才更新基准，保证基准始终是「学习前的值」
        if (!entry || entry.delta !== delta) {
          entry = { delta, base: snapshot.get(id) ?? now };
          pending[id] = entry;
        }
        // 服务端已追上本地增量，或该卡组已经全部记住 -> 增量作废，避免叠加重复计算
        if (now >= entry.base + entry.delta || now >= (pack.card_count || 0)) {
          absorbed.push(id);
        }
      }
      for (const id of absorbed) delete pending[id];
      if (absorbed.length) dropPackMasteredDelta(absorbed);
    },
    [dropPackMasteredDelta]
  );

  /**
   * 某个父卡组下的分类卡组
   * silent = true 时不显示 loading（用于从闪卡页返回后的静默刷新）
   */
  const loadSubPacks = useCallback(
    async (
      parentId: number,
      start: number,
      limit = SUB_PAGE_SIZE,
      silent = false,
      rememberTypes: number[] = LEARNING_REMEMBER_TYPES
    ) => {
      const gen = ++subLoadGenRef.current;
      if (!silent) setLoadingSubs(true);
      try {
        const { packs, total } = await packLibrary.fetchSubPacks(parentId, {
          start,
          limit,
          rememberTypes,
        });
        if (gen !== subLoadGenRef.current) return;
        // 重新拉取「未记住」第一页后对齐本地「已掌握」增量；
        // 切到「已记住」tab 不能清，否则今日学习里的已掌握数字会回落
        if (start === 0 && rememberTypes.includes(0)) reconcileMasteredDelta(packs);
        if (start === 0) {
          // 重取第一页 = 重新开始的这份列表，推翻上一次「没有更多」的结论
          noMoreSubsRef.current = false;
          setSubPacks(packs);
        } else {
          // 这一页有没有带来新增才是真正的终点：服务端返回的 total 可能偏小，
          // 也可能返回已在列表里的重复数据，两者都不能当作「没有了」
          const seen = new Set(subPacksRef.current.map((p) => Number(p.id)));
          noMoreSubsRef.current = packs.every((p) => seen.has(Number(p.id)));
          setSubPacks((prev) => mergePacks(prev, packs));
        }
        setSubTotal(total);
        setSubPacksParentId(parentId);
        // 未记住的数据另外留一份给今日学习看板，切换 tab 时它保持不变
        if (rememberTypes.includes(0)) {
          setLearningPacks((prev) => (start === 0 ? packs : mergePacks(prev, packs)));
        }
      } catch (e: any) {
        if (gen !== subLoadGenRef.current) return;
        if (!silent) setErrorMsg(e?.message || '加载分类卡组失败');
      } finally {
        // 只要不是静默刷新就一定要复位 loading：
        // 若本请求已被更新的请求取代，那个请求会自己接管 loading 状态，
        // 这里再判断代次会让 loadingSubs 永久卡在 true。
        if (!silent) setLoadingSubs(false);
      }
    },
    [reconcileMasteredDelta]
  );

  /**
   * 只刷新当前父级卡组自身的统计（总词数 / 已掌握）。
   * 顶部「今日学习」卡片的这两个数字取父级卡组的全量口径
   * （子卡组列表是分页拉取的，逐条累加会偏少），所以学完返回后要重新取一次。
   * 走「我的卡组」列表接口，避免详情接口的浏览数自增副作用。
   */
  const refreshSelectedTopStats = useCallback(
    async (topId: number) => {
      try {
        const { packs } = await packLibrary.fetchMyPacks({ start: 0, limit: 50 });
        const fresh = packs.find((p) => Number(p.id) === Number(topId));
        const prev = currentTopPackRef.current;
        // 期间用户可能已切换卡组，不匹配则放弃
        if (!fresh || !prev || Number(prev.id) !== Number(fresh.id)) return;
        setSelectedTop({
          ...prev,
          card_count: fresh.card_count ?? prev.card_count,
          remembered_card_count: fresh.remembered_card_count ?? prev.remembered_card_count,
        });
      } catch {
        // 静默失败: 保留原有统计数据
      }
    },
    [setSelectedTop]
  );

  /** 取某个记住状态下的分类卡组数量（只取 total，用于 tab 上的数字） */
  const loadSubPackCount = useCallback(async (parentId: number, rememberTypes: number[]) => {
    try {
      const { total } = await packLibrary.fetchSubPacks(parentId, {
        start: 0,
        limit: 1,
        rememberTypes,
      });
      return total;
    } catch {
      return null;
    }
  }, []);

  /**
   * 重新取两个 tab 的数量（「分类卡组」/「已记住」）。
   * 列表自身的结果只会更新当前 tab 的数字，另一个 tab 必须单独取一次，
   * 否则学完返回后有卡组整组变成「已记住」时，另一个 tab 的数字会停在旧值。
   */
  const refreshTabCounts = useCallback(
    async (parentId: number) => {
      const isLearning = subTabRef.current === 'learning';
      const currentTypes = isLearning ? LEARNING_REMEMBER_TYPES : REMEMBERED_REMEMBER_TYPES;
      const otherTypes = isLearning ? REMEMBERED_REMEMBER_TYPES : LEARNING_REMEMBER_TYPES;
      const [currentTotal, otherTotal] = await Promise.all([
        loadSubPackCount(parentId, currentTypes),
        loadSubPackCount(parentId, otherTypes),
      ]);
      if (currentTotal != null) {
        if (isLearning) setLearningTotal(currentTotal);
        else setRememberedTotal(currentTotal);
      }
      if (otherTotal != null) {
        if (isLearning) setRememberedTotal(otherTotal);
        else setLearningTotal(otherTotal);
      }
    },
    [loadSubPackCount]
  );

  /**
   * 刚安装的卡组: 服务端在后台线程逐个复制子卡组，
   * 这里轮询 /anki/pack.json?parentId=xxx 直到数量连续两次一致（视为复制完成）。
   */
  const loadSubPacksUntilReady = useCallback(async (parentId: number) => {
    const gen = ++subLoadGenRef.current;
    const intervalMs = 3000;
    const maxAttempts = 60; // 最多约 3 分钟
    const emptyGiveUp = 10; // 一直为 0 则 30 秒后放弃
    let lastTotal = -1;
    let stableTimes = 0;

    setLoadingSubs(true);
    setPreparingPack(true);
    setPreparedCount(0);
    resetPackMasteredDelta();
    try {
      for (let i = 0; i < maxAttempts; i++) {
        const { packs, total } = await packLibrary.fetchSubPacks(parentId, {
          start: 0,
          limit: SUB_PAGE_SIZE,
        });
        if (gen !== subLoadGenRef.current) return false;

        setSubPacks(packs);
        setSubTotal(total);
        setSubPacksParentId(parentId);
        setPreparedCount(total);
        // 这里拿到的可能只是服务端同步到一半的快照，
        // 剩下的交给触底加载继续补，所以不能标记成「没有更多」
        noMoreSubsRef.current = false;

        // 数量已达上限：服务端已基本复制完成，直接结束同步，不再继续触发
        if (total >= SUB_PACK_SYNC_LIMIT) return true;

        // 首个分类卡组也要已经有词，避免只建了卡组还没复制卡片
        const firstPackReady = packs.length === 0 || (packs[0]?.card_count || 0) > 0;
        if (total > 0 && total === lastTotal && firstPackReady) {
          stableTimes += 1;
          if (stableTimes >= 2) return true; // 数量与内容都已稳定，视为复制完成
        } else {
          stableTimes = 0;
        }

        if (total === 0 && i + 1 >= emptyGiveUp) break; // 迟迟没有数据，放弃
        lastTotal = total;

        if (i < maxAttempts - 1) {
          await new Promise((resolve) => setTimeout(resolve, intervalMs));
        }
      }
      return false;
    } catch (e: any) {
      if (gen === subLoadGenRef.current) setErrorMsg(e?.message || '加载分类卡组失败');
      return false;
    } finally {
      // 与 loadSubPacks 同理：被更新的请求取代时也要复位，避免同步条一直转
      setPreparingPack(false);
      setLoadingSubs(false);
    }
  }, [resetPackMasteredDelta]);

  // 启动时先读取上次记住的卡组名，用于占位显示
  useEffect(() => {
    (async () => {
      const remembered = await readRememberedTopPack();
      if (remembered?.name) setLastPackName(remembered.name);
    })();
  }, [readRememberedTopPack]);

  /**
   * 清空上一个账号残留的界面数据：卡组列表、今日学习、复习待办等，
   * 避免切换账号的瞬间把 A 账号的数据显示在 B 账号上。
   */
  const resetAccountScopedUi = () => {
    setLearningPacks([]);
    setSubPacksParentId(null);
    setRememberedTotal(null);
    setLearningTotal(null);
    setNotebook(null);
    setNotebookReviewWords([]);
    setNotebookReviewTotal(0);
    setLoadingNotebook(false);
    setLoadingNotebookReview(false);
    setSubTab('learning');
    setErrorMsg(null);
    setLastPackName(null);
    autoPickedPackRef.current = null;
    justInstalledRef.current = null;
    marketPromptedRef.current = false;
  };

  // 登录成功后（或切换账号后）用最新登录信息重新拉取我的卡组
  useEffect(() => {
    // 登录态仍在异步读取中，先不要做任何清空，避免误删「上次记住的卡组」
    if (authLoading) return;

    if (!isLoggedIn) {
      loadedUserIdRef.current = null; // 退出登录后允许再次登录时重新拉取
      // 清空上一账号残留的卡组数据（仅内存，保留本地记住的卡组）
      setTopPacks([]);
      resetCurrentTopPack();
      setSubPacks([]);
      setSubTotal(0);
      setActiveSub(null);
      setLoadingPacks(false); // 未登录时不发请求，需手动结束 loading
      resetAccountScopedUi();
      return;
    }
    const uid = String((user as any)?.id ?? '');
    if (loadedUserIdRef.current === uid) return; // 同一账号避免重复请求
    // 切换到另一个账号：先清掉上一个账号的列表与今日学习数据，再重新拉取
    if (loadedUserIdRef.current !== null) resetAccountScopedUi();
    loadedUserIdRef.current = uid;
    loadTopPacks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, isLoggedIn, (user as any)?.id]);

  /** 当前 tab 对应的记住状态过滤 */
  const currentRememberTypes =
    subTab === 'remembered' ? REMEMBERED_REMEMBER_TYPES : LEARNING_REMEMBER_TYPES;

  /** 切换父卡组或 tab 后，当前 tab 的数字跟着更新 */
  useEffect(() => {
    if (subTab === 'remembered') setRememberedTotal(subTotal);
    else setLearningTotal(subTotal);
  }, [subTab, subTotal]);

  // 记录上一次加载的父卡组，用于区分「切父卡组」和「切 tab」
  const lastParentIdRef = useRef<number | null>(null);

  /**
   * 重新拉取分类卡组：切换父卡组或切换「未记住 / 已记住」tab 时触发。
   * 只有父卡组变化才清空当前选中的分类卡组，切 tab 时保留，避免今日学习区被清空。
   */
  useEffect(() => {
    if (!selectedTop) return;
    const parentChanged = lastParentIdRef.current !== selectedTop.id;
    lastParentIdRef.current = selectedTop.id;

    setSubPacks([]);
    setSubTotal(0);
    // 换了父卡组 / tab 就是一份全新列表，之前的「没有更多」结论作废
    noMoreSubsRef.current = false;
    if (parentChanged) {
      setSubPacksParentId(null);
      setActiveSub(null);
      // 刚安装的卡组走轮询，等服务端把子卡组复制完
      if (justInstalledRef.current === selectedTop.id) {
        justInstalledRef.current = null;
        loadSubPacksUntilReady(selectedTop.id);
        return;
      }
    }

    loadSubPacks(selectedTop.id, 0, SUB_PAGE_SIZE, false, currentRememberTypes);
    // 顺带取另一个 tab 的数量，保证两个 tab 上都有数字
    const otherTypes = subTab === 'learning' ? REMEMBERED_REMEMBER_TYPES : LEARNING_REMEMBER_TYPES;
    loadSubPackCount(selectedTop.id, otherTypes).then((total) => {
      if (total == null) return;
      if (subTab === 'learning') setRememberedTotal(total);
      else setLearningTotal(total);
    });
  }, [
    selectedTop?.id,
    subTab,
    currentRememberTypes,
    loadSubPacks,
    loadSubPacksUntilReady,
    loadSubPackCount,
  ]);

  /**
   * 闪卡页点「继续学习下一个卡组」后，store 里的今日单词卡组会变成下一个子卡组，
   * 这里跟着同步高亮，避免返回首页后显示成上一个卡组的加载态。
   * 注意: 每次都用列表里的最新卡组对象，保证「今日已学」等数字刷新后能同步。
   */
  useEffect(() => {
    if (todayWordsPackId == null) return;
    // 只在未记住的卡组里匹配，切到「已记住」tab 时今日学习区不会被顶掉
    const matched = learningPacks.find((p) => Number(p.id) === Number(todayWordsPackId));
    if (!matched) return;
    setActiveSub((prev) => (Number(prev?.id) === Number(matched.id) ? prev : matched));
  }, [todayWordsPackId, learningPacks]);

  /**
   * 列表刷新后把当前选中的分类卡组换成列表里的新对象，
   * 否则「今日任务 / 今日已学」等数字会一直停留在进入单词列表页之前的旧数据上。
   */
  useEffect(() => {
    if (!activeSub) return;
    const fresh = learningPacks.find((p) => Number(p.id) === Number(activeSub.id));
    if (fresh && fresh !== activeSub) setActiveSub(fresh);
  }, [activeSub, learningPacks]);

  const reloadAll = useCallback(async () => {
    await loadTopPacks();
    if (selectedTop) {
      await loadSubPacks(selectedTop.id, 0, SUB_PAGE_SIZE, false, currentRememberTypes);
      refreshTabCounts(selectedTop.id);
    }
  }, [loadTopPacks, loadSubPacks, refreshTabCounts, selectedTop, currentRememberTypes]);

  /**
   * 触底加载：只在「确实翻不到新数据」时才停。
   * 服务端给的 total 可能小于真实数量（新安装的卡组后台还在复制子卡组，
   * 轮询到 SUB_PACK_SYNC_LIMIT 就结束了），所以只要还没被这一页结果否掉，
   * 触底就会再按当前长度往后翻一页验证，翻出数据就继续接上。
   */
  const handleLoadMore = () => {
    if (loadingSubs || loadingPacks || !selectedTop) return;
    if (subPacks.length === 0) return; // 首屏第一页由列表自己拉，这里不重复请求

    const now = Date.now();
    // 上一次确实没翻到数据时节流重试，避免用户反复触底时连续发请求
    if (noMoreSubsRef.current && now - lastProbeAtRef.current < SUB_PROBE_INTERVAL) return;
    lastProbeAtRef.current = now;

    loadSubPacks(selectedTop.id, subPacks.length, SUB_PAGE_SIZE, false, currentRememberTypes);
  };

  /** 打开卡组市场 */
  const handleOpenMarket = () => {
    if (!isLoggedIn) {
      promptLogin();
      return;
    }
    navigation.navigate('Market');
  };

  /** 市场安装完成: 刷新我的卡组并切换到新安装的卡组 */
  const handleMarketInstalled = useCallback(async () => {
    if (!installedPack) return;
    // 标记为新安装，后续会轮询等待其子卡组复制完成
    justInstalledRef.current = installedPack.id;
    await loadTopPacks();
    setSelectedTop(installedPack);
    setInstalledPack(null);
  }, [installedPack, loadTopPacks, setInstalledPack]);

  useEffect(() => {
    handleMarketInstalled();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [installedPack]);

  /** 统一弹窗状态：确认/提示一律走 ConfirmDialog，不再使用系统 Alert */
  const [dialog, setDialog] = useState<DialogPayload | null>(null);

  /** 只有一个「确定」的纯提示弹窗 */
  const showNotice = useCallback((title: string, message: string) => {
    setDialog({ title, message, showCancel: false });
  }, []);

  const promptLogin = () => {
    setDialog({
      title: '需要登录',
      message: '请先登录后再使用在线卡组',
      confirmText: '去登录',
      onConfirm: () => {
        setDialog(null);
        navigation.navigate('Login');
      },
    });
  };

  /** 打开生词本列表 */
  const handleOpenBookmarks = () => {
    if (!isLoggedIn) {
      promptLogin();
      return;
    }
    navigation.navigate('Bookmarks');
  };

  /** 打开「我的」页面 */
  const handleOpenProfile = () => {
    if (!isLoggedIn) {
      navigation.navigate('Login');
      return;
    }
    navigation.navigate('Profile');
  };

  /** 打开电脑端插件站点（边看剧边添加生词） */
  const handleOpenSite = () => {
    Linking.openURL('https://www.cibaen.com').catch(() => {
      showNotice('打不开链接', '请手动在浏览器访问 www.cibaen.com');
    });
  };

  /**
   * 分类卡组列表加载完成后自动选中默认卡组（用户没手动点过时）:
   *   ① 闪卡页「继续学习下一个卡组」后 store 里的卡组仍在该列表 -> 保持它
   *   ② 第一个「未全部记住」的分类卡组
   *   ③ 都已记住时，退而取第一个今日还有单词的分类卡组
   * 同一父卡组只自动选一次，避免覆盖用户手动切换的结果。
   * 例外：焦点卡组从「未记住」列表里消失时（比如刚把它的单词全部记住，刷新后整组移到了「已记住」）
   * 必须重新挑一个，否则会一直停在那个已经学完的卡组上。
   */
  useEffect(() => {
    // 只在「分类卡组」tab 下自动挑默认分类，切到已记住时不重复拉取今日单词
    if (subTab !== 'learning') return;
    if (!selectedTop || subPacksParentId !== selectedTop.id) return;
    if (!learningPacks.length) return;
    if (preparingPack) return; // 新安装卡组还在同步子卡组，等同步完再选

    // 当前焦点是否还在列表里
    const activeInList =
      activeSub != null && learningPacks.some((p) => Number(p.id) === Number(activeSub.id));
    if (autoPickedPackRef.current === selectedTop.id && activeInList) return;

    const fromStudy =
      todayWordsPackId != null
        ? learningPacks.find((p) => Number(p.id) === Number(todayWordsPackId))
        : undefined;
    const target =
      fromStudy ||
      learningPacks.find((p) => !isPackFullyRemembered(p, packMasteredDelta[p.id] || 0)) ||
      learningPacks.find((p) => (p.today_card_count || 0) > 0);

    autoPickedPackRef.current = selectedTop.id;
    if (target) {
      setActiveSub(target);
    } else if (!activeInList) {
      // 列表里已经没有可学的分类卡组，清掉失效焦点
      setActiveSub(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    selectedTop?.id,
    subPacksParentId,
    learningPacks,
    preparingPack,
    todayWordsPackId,
    activeSub,
  ]);

  /**
   * 生词本统计（今日学习-生词本卡片）：
   * 学习 = conf.day_limit、已学习 = today_learned_card_count、总数量 = card_count。
   */
  const loadNotebook = useCallback(async () => {
    const req = ++notebookReqRef.current;
    setLoadingNotebook(true);
    try {
      const stats = await fetchNotebookStats();
      if (req !== notebookReqRef.current) return;
      setNotebook(stats);
    } catch {
      if (req !== notebookReqRef.current) return;
      setNotebook(null);
    } finally {
      // 无条件复位：若本请求已被更新的请求取代，代次判断会让 loading 永久卡住
      setLoadingNotebook(false);
    }
  }, []);

  /** 生词本复习待办：学过但还没记住的单词（type = 1/2/3），数量与队列都用它 */
  const loadNotebookReview = useCallback(async () => {
    const req = ++notebookReviewReqRef.current;
    setLoadingNotebookReview(true);
    try {
      const page = await fetchBookmarkedWords({
        start: 0,
        limit: NOTEBOOK_REVIEW_LIMIT,
        types: BOOKMARK_REVIEW_TODO_TYPES,
      });
      if (req !== notebookReviewReqRef.current) return;
      setNotebookReviewWords(page.words);
      setNotebookReviewTotal(page.total || page.words.length);
    } catch {
      if (req !== notebookReviewReqRef.current) return;
      setNotebookReviewWords([]);
      setNotebookReviewTotal(0);
    } finally {
      setLoadingNotebookReview(false);
    }
  }, []);

  /** 登录态/账号变化后刷新生词本数据；未登录时清空，避免串账号 */
  useEffect(() => {
    if (authLoading) return;
    if (!isLoggedIn) {
      notebookReqRef.current += 1;
      notebookReviewReqRef.current += 1;
      setNotebook(null);
      setNotebookReviewWords([]);
      setNotebookReviewTotal(0);
      setLoadingNotebook(false);
      setLoadingNotebookReview(false);
      return;
    }
    loadNotebook();
    loadNotebookReview();
  }, [authLoading, isLoggedIn, (user as any)?.id, loadNotebook, loadNotebookReview]);

  /**
   * 从背词页学完返回时静默刷新：父级卡组统计 + 分类卡组统计 + 生词本统计与复习待办，
   * 保证卡片上的数字是学完之后的最新数据（首次聚焦跳过，避免重复请求）。
   */
  const focusedOnceRef = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (!focusedOnceRef.current) {
        focusedOnceRef.current = true;
        return;
      }
      if (!isLoggedIn) return;
      // 生词本统计与分类卡组无关，先刷新，再刷分类卡组
      loadNotebook();
      loadNotebookReview();
      const { selectedTop: top, subPackCount } = homeRefreshRef.current;
      if (!top) return;
      // 保持已加载的分页长度，只静默替换最新数据
      loadSubPacks(top.id, 0, Math.max(SUB_PAGE_SIZE, subPackCount), true, currentRememberTypes);
      refreshSelectedTopStats(top.id);
      // 学完之后有分类卡组会整组移到另一个 tab，两边 tab 的数字都要重新取
      refreshTabCounts(top.id);
    }, [
      isLoggedIn,
      loadSubPacks,
      refreshSelectedTopStats,
      refreshTabCounts,
      loadNotebook,
      loadNotebookReview,
      currentRememberTypes,
    ])
  );

  /** 打开某个子卡组的单词列表 */
  const handleOpenPackWordList = useCallback(
    async (pack: RemotePack) => {
      if (!isLoggedIn) {
        promptLogin();
        return;
      }
      try {
        const list = await loadPackWordList(pack.id, {
          cat: selectedTop?.name || '',
          sub: pack.name || '',
        });
        if (!list.length) {
          showNotice('提示', '该分类暂无单词');
          return;
        }
        navigation.navigate('WordList', { source: 'pack', title: pack.name });
      } catch (e: any) {
        showNotice('加载失败', e?.message || '获取单词列表失败');
      }
    },
    [loadPackWordList, selectedTop?.name, isLoggedIn, navigation, showNotice]
  );

  /**
   * 「今日学习-生词本」开始背词:
   * GET /anki/pack/{生词本}/learn.json 取今日待学生词，直接进入生词本复习页。
   */
  const handleStartNotebookStudy = useCallback(async () => {
    if (!isLoggedIn) {
      promptLogin();
      return;
    }
    setStartingNotebookStudy(true);
    try {
      const { words } = await fetchNotebookStudyWords({
        start: 0,
        limit: NOTEBOOK_STUDY_LIMIT,
      });
      if (!words.length) {
        showNotice('太棒了', '生词本今日没有待学习的单词');
        return;
      }
      navigation.navigate('BookmarkStudy', {
        words,
        startIndex: 0,
        total: words.length,
      });
    } catch (e: any) {
      showNotice('加载失败', e?.message || '获取生词本学习单词失败');
    } finally {
      setStartingNotebookStudy(false);
    }
  }, [isLoggedIn, navigation, showNotice]);

  /** 生词本复习待办: 用「学过但还没记住」的生词直接进入生词本复习页 */
  const handleStartNotebookReview = useCallback(() => {
    if (!notebookReviewWords.length) {
      showNotice('太棒了', '生词本暂时没有需要复习的单词');
      return;
    }
    navigation.navigate('BookmarkStudy', {
      words: notebookReviewWords,
      startIndex: 0,
      total: notebookReviewTotal,
      types: BOOKMARK_REVIEW_TODO_TYPES,
    });
  }, [notebookReviewWords, notebookReviewTotal, navigation, showNotice]);

  /**
   * 分类卡组整体进度: 已记住卡组数 / (已记住 + 未记住) 卡组数。
   * 两个数字都来自 tab 上各自记住状态的卡组总数，不随当前 tab 变化。
   */
  const packProgress = useMemo(() => {
    const remembered = rememberedTotal ?? 0;
    const learning = learningTotal ?? 0;
    const total = remembered + learning;
    return {
      remembered,
      learning,
      total,
      progress: total > 0 ? Math.min(1, remembered / total) : 0,
    };
  }, [rememberedTotal, learningTotal]);

  /**
   * 父卡组单词进度: 已记住单词数 / 总单词数。
   * 数据取父卡组自身的 remembered_card_count 与 card_count，与「今日学习」同一口径；
   * 学完返回时 refreshSelectedTopStats 会刷新这两个字段。
   */
  const packWordProgress = useMemo(() => {
    const total = Number(selectedTop?.card_count) || 0;
    // 已记住不会超过总词数，避免服务端缓存出现「已记住 > 总数」
    const remembered = Math.max(0, Math.min(total, Number(selectedTop?.remembered_card_count) || 0));
    return {
      total,
      remembered,
      notRemembered: Math.max(0, total - remembered),
      progress: total > 0 ? Math.min(1, remembered / total) : 0,
    };
  }, [selectedTop]);

  const renderSubPack = ({ item }: { item: RemotePack }) => {
    const isActive = activeSub?.id === item.id;
    const total = item.card_count || 0;
    // 服务端 remembered_card_count 不实时更新，叠加本地学习产生的增量
    const delta = packMasteredDelta[item.id] || 0;
    const remembered = Math.max(0, Math.min(total, (item.remembered_card_count || 0) + delta));
    const todayCount = item.today_card_count || 0;
    // 今日已学不会超过今日总数，避免服务端缓存导致「已学 > 待学」
    const todayLearnedCount = Math.min(item.today_learned_card_count || 0, todayCount);
    const progress = total > 0 ? Math.min(1, remembered / total) : 0;
    const color = getCategoryColor(item.name);
    const isLoadingList = isLoadingPackWords && packWordsPackId === item.id;

    // 行底色取该分类识别色的极淡 tint（选中时加深），比统一灰底更有辨识度
    const rowTint = isActive ? `${color}2E` : `${color}12`;

    return (
      <TouchableOpacity
        style={[
          styles.subCard,
          { backgroundColor: rowTint, borderColor: isActive ? color : 'transparent' },
        ]}
        onPress={() => handleOpenPackWordList(item)}
        activeOpacity={0.8}
      >
        <View style={[styles.subColorBar, { backgroundColor: color }]} />

        <View style={styles.subCardBody}>
          <View style={styles.subCardTop}>
            <Text style={styles.subCardName} numberOfLines={1}>
              {item.name}
            </Text>
            {isLoadingList ? (
              <ActivityIndicator size="small" color={Colors.primary} />
            ) : null}
            <View style={styles.subCountPill}>
              <Text style={styles.subCountPillText}>{total} 词</Text>
            </View>
          </View>

          <View style={styles.subMetaRow}>
            <Text style={styles.subMetaText}>
              已记住 {remembered}/{total}
            </Text>
            {subTab === 'learning' && todayCount > 0 ? (
              <Text style={styles.subTodayText}>
                今日 {todayLearnedCount}/{todayCount}
              </Text>
            ) : null}
          </View>

          <View style={styles.subProgressWrap}>
            <ProgressBar progress={progress} height={4} color={color} backgroundColor="#FFFFFF" />
          </View>
        </View>

        <Ionicons
          name="chevron-forward"
          size={16}
          color={isActive ? color : Colors.textMuted}
        />
      </TouchableOpacity>
    );
  };

  /** 固定顶部标题栏：不随列表滚动 */
  const renderTopBar = () => (
    <View style={styles.header}>
      <View style={styles.brandBlock}>
        <View style={styles.logoCircle}>
          <Image
            source={require('../assets/pinwheel.png')}
            style={styles.logoImage}
            resizeMode="contain"
          />
        </View>
        <View style={styles.brandTextWrap}>
          <Text style={styles.brandTitle} numberOfLines={1}>
            糍粑看美剧学英语
          </Text>
        </View>
      </View>

      <View style={styles.headerActions}>
        <View style={styles.streakBadge}>
          <Ionicons name="flame" size={15} color={Colors.pinwheelRed} />
          <Text style={styles.streakText}>{stats.streakDays} 天</Text>
        </View>
        <TouchableOpacity style={styles.addButton} onPress={handleOpenMarket} activeOpacity={0.8}>
          <Ionicons name="add" size={20} color="#FFFFFF" />
        </TouchableOpacity>
      </View>
    </View>
  );

  /** 用户信息卡：头像 + 昵称 + 会员/登录入口，点击进入「我的」 */
  const renderUserCard = () => (
    <View style={styles.userCard}>
      {authLoading ? (
        <View style={styles.userCardLoading}>
          <ActivityIndicator size="small" color={Colors.primary} />
          <Text style={styles.userCardLoadingText}>正在读取登录状态…</Text>
        </View>
      ) : (
        <>
          <TouchableOpacity
            style={styles.userCardMain}
            activeOpacity={0.8}
            onPress={handleOpenProfile}
          >
            <View style={styles.avatarWrap}>
              <View style={[styles.avatarCircle, isVip && styles.avatarCircleVip]}>
                <Ionicons
                  name={isLoggedIn ? 'person' : 'log-in-outline'}
                  size={26}
                  color={isVip ? Colors.gold : Colors.primary}
                />
              </View>
              {isVip ? (
                <View style={styles.avatarVipBadge}>
                  <Ionicons name="diamond" size={9} color="#FFFFFF" />
                </View>
              ) : null}
            </View>

            <View style={styles.userInfo}>
              <View style={styles.userNameRow}>
                <Text style={styles.userName} numberOfLines={1}>
                  {displayName}
                </Text>
                {isLoggedIn ? (
                  <TouchableOpacity
                    style={[styles.vipTag, isVip ? styles.vipTagActive : styles.vipTagUpgrade]}
                    onPress={() => navigation.navigate('Purchase')}
                    activeOpacity={0.8}
                  >
                    <Ionicons
                      name={isVip ? 'diamond' : 'diamond-outline'}
                      size={11}
                      color={isVip ? '#FFFFFF' : Colors.gold}
                    />
                    <Text style={[styles.vipTagText, isVip && styles.vipTagTextActive]}>
                      {isVip ? 'VIP 会员' : '升级会员'}
                    </Text>
                  </TouchableOpacity>
                ) : null}
              </View>
              <Text style={styles.userSub} numberOfLines={1}>
                {isLoggedIn
                  ? authUser?.mobile
                    ? maskMobile(authUser.mobile)
                    : authUser?.email || '已登录'
                  : '登录后可同步词书与多端学习进度'}
              </Text>
            </View>
          </TouchableOpacity>

          {isLoggedIn ? (
            <TouchableOpacity
              style={styles.profileEntry}
              onPress={() => navigation.navigate('Profile')}
              activeOpacity={0.7}
              accessibilityLabel="我的"
            >
              <Ionicons name="settings-outline" size={19} color={Colors.textTertiary} />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={styles.loginBtnSmall}
              onPress={() => navigation.navigate('Login')}
              activeOpacity={0.8}
            >
              <Text style={styles.loginBtnSmallText}>登录</Text>
            </TouchableOpacity>
          )}
        </>
      )}
    </View>
  );

  /** 底部说明：电脑端 Chrome 插件用法（边看剧边加生词） */
  const renderTipCard = () => (
    <TouchableOpacity style={styles.tipCard} onPress={handleOpenSite} activeOpacity={0.85}>
      <View style={styles.tipHeader}>
        <Ionicons name="bulb-outline" size={16} color={Colors.accent} />
        <Text style={styles.tipTitle}>边看美剧，边攒生词</Text>
      </View>
      <Text style={styles.tipText}>
        电脑访问 www.cibaen.com 安装 Chrome 浏览器插件后，即可在爱奇艺、B 站观看带字幕的视频时，边看视频边添加英文生词。然后在手机上碎片时间记忆单词。
      </Text>
    </TouchableOpacity>
  );

  /** 生词本统计格子: 学习 / 已学习 / 总数量 */
  const renderNotebookStat = (
    label: string,
    value: number | string,
    icon: keyof typeof Ionicons.glyphMap,
    accent: string
  ) => (
    <View style={styles.notebookStatCell}>
      <View style={[styles.notebookStatIcon, { backgroundColor: `${accent}1F` }]}>
        <Ionicons name={icon} size={14} color={accent} />
      </View>
      <Text style={styles.notebookStatValue} numberOfLines={1}>
        {value}
      </Text>
      <Text style={styles.notebookStatLabel}>{label}</Text>
    </View>
  );

  /** 今日学习看板卡片（数据全部来自生词本） */
  const renderDashboardCard = () => (
    <View style={styles.dashboardCard}>
      {authLoading ? (
        /* 登录状态读取中 */
        <View style={styles.loginStateWrap}>
          <ActivityIndicator size="small" color={Colors.primary} />
          <Text style={styles.loginStateDesc}>正在读取登录状态…</Text>
        </View>
      ) : !isLoggedIn ? (
        /* 未登录状态：只保留一行说明 + 登录入口，账号信息统一由顶部用户卡承载 */
        <>
          <View style={styles.dashHeader}>
            <View style={styles.dashTitleIcon}>
              <Ionicons name="book-outline" size={16} color="#FFFFFF" />
            </View>
            <View style={styles.dashTitleWrap}>
              <Text style={styles.dashTitle}>生词本</Text>
              <Text style={styles.dashSubtitle}>登录后开始今日学习</Text>
            </View>
            <View style={styles.unloginTag}>
              <Ionicons name="person-outline" size={13} color={Colors.textMuted} />
              <Text style={styles.unloginTagText}>未登录</Text>
            </View>
          </View>

          <TouchableOpacity
            style={styles.loginMainBtn}
            onPress={() => navigation.navigate('Login')}
            activeOpacity={0.8}
          >
            <Ionicons name="log-in-outline" size={17} color="#FFFFFF" />
            <Text style={styles.loginMainBtnText}>立即登录，开始背词</Text>
          </TouchableOpacity>
        </>
      ) : (
        /* 已登录状态: 数据全部取自生词本 */
        <>
          {/* 第一行: 标题 + 今日目标完成度（点标题进入生词本列表） */}
          <View style={styles.dashHeader}>
            <TouchableOpacity
              style={styles.dashHeaderLeft}
              activeOpacity={0.8}
              onPress={handleOpenBookmarks}
            >
              <View style={styles.dashTitleIcon}>
                <Ionicons name="book-outline" size={16} color="#FFFFFF" />
              </View>
              <View style={styles.dashTitleWrap}>
                <Text style={styles.dashTitle}>生词本</Text>
                <Text style={styles.dashSubtitle} numberOfLines={1}>
                  {loadingNotebook
                    ? '正在获取生词本数据…'
                    : notebook
                    ? `今日目标 ${notebook.dayLimit} 个生词 · 共 ${notebook.totalWords} 词`
                    : '生词本数据获取失败'}
                </Text>
              </View>
            </TouchableOpacity>
            {!loadingNotebook && notebook?.dayLimit ? (
              <View style={styles.dashPercentBadge}>
                <Text style={styles.dashPercentText}>
                  {Math.round(
                    Math.min(1, (notebook?.learnedToday || 0) / notebook.dayLimit) * 100
                  )}
                  %
                </Text>
              </View>
            ) : null}
          </View>

          {/* 第二行: 学习 / 已学习 / 总数量 */}
          <View style={styles.notebookStatsRow}>
            {renderNotebookStat(
              '学习目标',
              notebook?.dayLimit ?? '-',
              'flag-outline',
              Colors.primary
            )}
            {renderNotebookStat(
              '已学习',
              notebook?.learnedToday ?? '-',
              'checkmark-circle-outline',
              Colors.success
            )}
            {renderNotebookStat(
              '总数量',
              notebook ? `${notebook.notRemembered}/${notebook.totalWords}` : '-',
              'library-outline',
              Colors.accent
            )}
          </View>

          {/* 今日目标完成进度: 已学习 / 学习目标 */}
          <View style={styles.dashProgressTrack}>
            <ProgressBar
              progress={
                notebook?.dayLimit
                  ? Math.min(1, (notebook?.learnedToday || 0) / notebook.dayLimit)
                  : 0
              }
              height={8}
              color={Colors.primary}
            />
          </View>
          <View style={styles.dashProgressMeta}>
            <Text style={styles.dashProgressMetaText}>
              今日已学 {notebook?.learnedToday ?? 0}
              {notebook?.dayLimit ? ` / ${notebook.dayLimit}` : ''} 词
            </Text>
            <Text style={styles.dashProgressMetaText}>
              生词本共 {notebook?.totalWords ?? 0} 词
            </Text>
          </View>

          {/* 第三行: 复习待办 + 开始背词 */}
          <View style={styles.todayTaskBox}>
            <TouchableOpacity
              style={[
                styles.actionBtn,
                styles.reviewBtn,
                (!notebookReviewTotal || loadingNotebookReview) && styles.actionBtnDisabled,
              ]}
              onPress={handleStartNotebookReview}
              activeOpacity={0.8}
              disabled={!notebookReviewTotal || loadingNotebookReview}
            >
              {loadingNotebookReview ? (
                <ActivityIndicator size="small" color={Colors.primary} />
              ) : (
                <Ionicons name="repeat" size={18} color={Colors.primary} />
              )}
              <Text style={styles.reviewBtnText}>
                复习待办{notebookReviewTotal ? ` ${notebookReviewTotal}` : ''}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.actionBtn,
                styles.primaryBtn,
                startingNotebookStudy && styles.actionBtnDisabled,
              ]}
              onPress={handleStartNotebookStudy}
              activeOpacity={0.8}
              disabled={startingNotebookStudy}
            >
              {startingNotebookStudy ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Ionicons name="flash" size={18} color="#FFFFFF" />
              )}
              <Text style={styles.primaryBtnText}>开始学习</Text>
            </TouchableOpacity>
          </View>
        </>
      )}
    </View>
  );

  /**
   * 分类卡组卡片：标题（父卡组名）+ 整体进度条 + 未记住/已记住 tab + 卡组列表，
   * 与上方「今日学习」同款卡片外观。
   */
  const renderPacksCard = () => (
    <View style={styles.packsCard}>
      {/* 第一行: 父卡组名称 + 整体完成度 */}
      <View style={styles.packsHeader}>
        <View style={styles.packsTitleIcon}>
          <Ionicons name="albums-outline" size={16} color="#FFFFFF" />
        </View>
        <View style={styles.packsTitleWrap}>
          <Text style={styles.packsTitle} numberOfLines={1}>
            {selectedTop?.name || '我的卡组'}
          </Text>
          <Text style={styles.packsSubtitle} numberOfLines={1}>
            {packProgress.total > 0
              ? `共 ${packProgress.total} 个分类卡组 · 已记住 ${packProgress.remembered} 个`
              : '暂无分类卡组'}
          </Text>
        </View>
        <View style={styles.packsPercentBadge}>
          <Text style={styles.packsPercentText}>{Math.round(packProgress.progress * 100)}%</Text>
        </View>
      </View>

      {/* 已记住单词数 / 总单词数（父卡组 remembered_card_count 与 card_count） */}
      <View style={styles.packsProgressTrack}>
        <ProgressBar progress={packWordProgress.progress} height={8} color={Colors.success} />
      </View>
      <View style={styles.packsProgressMeta}>
        <Text style={styles.packsProgressText}>
          已记住 <Text style={styles.packsProgressStrong}>{packWordProgress.remembered}</Text> 词
        </Text>
        <Text style={styles.packsProgressText}>
          未记住 <Text style={styles.packsProgressStrong}>{packWordProgress.notRemembered}</Text> 词
        </Text>
      </View>

      {/* 未记住 / 已记住 切换 */}
      <View style={styles.packsTabs}>
        <TouchableOpacity
          style={[styles.packsTab, subTab === 'learning' && styles.packsTabActive]}
          onPress={() => setSubTab('learning')}
          activeOpacity={0.8}
        >
          <Ionicons
            name={subTab === 'learning' ? 'albums' : 'albums-outline'}
            size={14}
            color={subTab === 'learning' ? Colors.primary : Colors.textTertiary}
          />
          <Text style={[styles.packsTabText, subTab === 'learning' && styles.packsTabTextActive]}>
            {`未记住${learningTotal != null ? ` ${learningTotal}` : ''}`}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.packsTab, subTab === 'remembered' && styles.packsTabActive]}
          onPress={() => setSubTab('remembered')}
          activeOpacity={0.8}
        >
          <Ionicons
            name={subTab === 'remembered' ? 'checkmark-circle' : 'checkmark-circle-outline'}
            size={14}
            color={subTab === 'remembered' ? Colors.success : Colors.textTertiary}
          />
          <Text
            style={[
              styles.packsTabText,
              subTab === 'remembered' && styles.packsTabTextActive,
              subTab === 'remembered' && styles.packsTabTextDone,
            ]}
          >
            {`已记住${rememberedTotal != null ? ` ${rememberedTotal}` : ''}`}
          </Text>
        </TouchableOpacity>
      </View>

      {/* 新安装卡组的子卡组同步进度 */}
      {preparingPack ? (
        <View style={styles.preparingInnerBar}>
          <ActivityIndicator size="small" color={Colors.primary} />
          <Text style={styles.preparingText}>
            卡组数据同步中… 已获取 {preparedCount} 个分类卡组
          </Text>
        </View>
      ) : null}

      {/* 卡组列表 / 加载 / 空态 */}
      {authLoading || loadingPacks || (loadingSubs && subPacks.length === 0) ? (
        <View style={styles.centerPadding}>
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text style={styles.loadingText}>正在加载卡组...</Text>
        </View>
      ) : subPacks.length === 0 ? (
        renderEmpty()
      ) : (
        <>
          {subPacks.map((item) => (
            <React.Fragment key={item.id}>{renderSubPack({ item })}</React.Fragment>
          ))}
          {loadingSubs ? (
            <View style={styles.footerLoading}>
              <ActivityIndicator size="small" color={Colors.primary} />
            </View>
          ) : null}
        </>
      )}
    </View>
  );

  /** 触底加载下一页分类卡组（ScrollView 无 onEndReached，这里按滚动位置判断） */
  const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
    const reachedBottom =
      contentOffset.y + layoutMeasurement.height >= contentSize.height - 240;
    if (!reachedBottom) return;
    handleLoadMore();
  };

  /** 卡组列表为空时的占位（加载态由卡片外层统一处理） */
  const renderEmpty = () => {
    // 未登录: 登录入口已放在「今日学习」卡片，这里只做无按钮的占位提示
    if (!isLoggedIn) {
      return (
        <View style={styles.lockedBox}>
          <Ionicons name="lock-closed-outline" size={26} color={Colors.textMuted} />
          <Text style={styles.lockedTitle}>分类卡组已锁定</Text>
          <Text style={styles.lockedDesc}>在上方「今日学习」中登录后即可查看</Text>
        </View>
      );
    }
    if (errorMsg) {
      return (
        <View style={styles.emptyWrap}>
          <Ionicons name="cloud-offline-outline" size={48} color={Colors.border} />
          <Text style={styles.emptyText}>{errorMsg}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={reloadAll} activeOpacity={0.8}>
            <Text style={styles.retryText}>重试</Text>
          </TouchableOpacity>
        </View>
      );
    }
    // 我的卡组为空: 引导去卡组市场添加
    if (topPacks.length === 0) {
      return (
        <View style={styles.emptyWrap}>
          <Ionicons name="albums-outline" size={48} color={Colors.border} />
          <Text style={styles.emptyText}>你还没有卡组，请先从卡组市场添加分类背单词卡组后才能使用</Text>
          <TouchableOpacity
            style={styles.retryBtn}
            onPress={() => navigation.navigate('Market', { firstSetup: true })}
            activeOpacity={0.8}
          >
            <Text style={styles.retryText}>去卡组市场</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return (
      <View style={styles.emptyWrap}>
        <Ionicons name="albums-outline" size={48} color={Colors.border} />
        <Text style={styles.emptyText}>
          {subTab === 'remembered' ? '暂无已记住的分类卡组' : '暂无未记住的分类卡组'}
        </Text>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" backgroundColor={Colors.background} />

      {/* 固定顶部标题栏 */}
      {renderTopBar()}

      <ScrollView
        onScroll={handleScroll}
        scrollEventThrottle={200}
        refreshControl={
          <RefreshControl refreshing={loadingPacks} onRefresh={reloadAll} colors={[Colors.primary]} />
        }
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ① 用户信息：头像 / 昵称 / 会员状态 / 登录入口 */}
        {renderUserCard()}

        {/* ② 生词本：今日目标与学习统计 */}
        {renderDashboardCard()}

        {/* ③ 我的卡组：分类卡组进度与列表（标题 + 整体进度 + tab + 列表） */}
        {renderPacksCard()}

        {/* ④ 电脑端插件说明 */}
        {renderTipCard()}
      </ScrollView>

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
    backgroundColor: Colors.background,
  },
  listContent: {
    paddingBottom: 40,
  },
  // 顶部标题栏：主色浅底 + 底部圆角，与下方看板形成层次
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 14,
    backgroundColor: Colors.primaryLight,
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20,
  },
  brandBlock: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 10,
    minWidth: 0,
  },
  logoCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.primary + '26',
  },
  brandTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  logoImage: {
    width: 26,
    height: 26,
  },
  brandTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: Colors.textPrimary,
    letterSpacing: 0.5,
  },
  brandPackName: {
    marginTop: 2,
    fontSize: 12,
    fontWeight: '600',
    color: Colors.primary,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  addButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.primary,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.28,
    shadowRadius: 6,
    elevation: 3,
  },
  streakBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.card,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  streakText: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.pinwheelRed,
    marginLeft: 4,
  },


  // 今日学习看板
  dashboardCard: {
    backgroundColor: Colors.card,
    borderRadius: 18,
    marginHorizontal: 16,
    marginTop: 16,
    marginBottom: 12,
    padding: 20,
    borderWidth: 1,
    borderColor: Colors.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 3,
  },
  dashHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  dashTitleIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  dashTitleWrap: {
    flex: 1,
    marginRight: 8,
  },
  dashTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: Colors.textPrimary,
  },
  dashSubtitle: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  dashPercentBadge: {
    backgroundColor: Colors.primaryLight,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  // 第二行: 学习 / 已学习 / 总数量
  notebookStatsRow: {
    flexDirection: 'row',
    marginTop: 16,
    gap: 10,
  },
  notebookStatCell: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: Colors.backgroundAlt,
    borderWidth: 1,
    borderColor: Colors.divider,
  },
  notebookStatIcon: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  notebookStatValue: {
    fontSize: 20,
    fontWeight: '800',
    color: Colors.textPrimary,
    lineHeight: 24,
  },
  notebookStatLabel: {
    marginTop: 2,
    fontSize: 12,
    color: Colors.textSecondary,
  },
  // 未登录标记
  unloginTag: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.divider,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
  },
  unloginTagText: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.textMuted,
  },
  // 未登录引导区
  loginStateWrap: {
    alignItems: 'center',
    paddingTop: 8,
    paddingBottom: 2,
  },
  loginStateIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: Colors.divider,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  loginStateTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  loginStateDesc: {
    fontSize: 12,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 18,
    marginTop: 6,
  },
  loginMainBtn: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 18,
    height: 44,
    borderRadius: 12,
    backgroundColor: Colors.primary,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.22,
    shadowRadius: 8,
    elevation: 3,
  },
  loginMainBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  dashPercentText: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.primary,
  },
  dashProgressTrack: {
    marginTop: 14,
  },
  dashProgressMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  dashProgressMetaText: {
    fontSize: 12,
    color: Colors.textSecondary,
  },
  // 今日任务（当前分类卡组）：只剩两个操作按钮
  todayTaskBox: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: Colors.divider,
  },
  actionBtn: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  primaryBtn: {
    backgroundColor: Colors.primary,
  },
  primaryBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  reviewBtn: {
    backgroundColor: Colors.primaryLight,
  },
  reviewBtnText: {
    color: Colors.primary,
    fontSize: 14,
    fontWeight: '700',
  },
  actionBtnDisabled: {
    opacity: 0.45,
  },

  todayActionRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
  },
  todayOutlineBtn: {
    flex: 1,
    height: 38,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  todayOutlineText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  todayPrimaryBtn: {
    flex: 1,
    height: 38,
    borderRadius: 8,
    backgroundColor: Colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  todayPrimaryText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },

  // 分类卡组卡片：与上方「今日学习」同款外观
  packsCard: {
    backgroundColor: Colors.card,
    borderRadius: 18,
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 3,
  },
  // 第一行: 父卡组名称 + 整体完成度
  packsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  packsTitleIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.28,
    shadowRadius: 5,
    elevation: 3,
  },
  packsTitleWrap: {
    flex: 1,
    marginRight: 8,
    minWidth: 0,
  },
  packsTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: Colors.textPrimary,
  },
  packsSubtitle: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  packsPercentBadge: {
    backgroundColor: Colors.success + '1A',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
  },
  packsPercentText: {
    fontSize: 13,
    fontWeight: '800',
    color: Colors.success,
  },
  packsProgressTrack: {
    marginTop: 14,
  },
  packsProgressMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  packsProgressText: {
    fontSize: 12,
    color: Colors.textSecondary,
  },
  packsProgressStrong: {
    fontWeight: '800',
    color: Colors.textPrimary,
  },
  // 未记住 / 已记住 分段控件
  packsTabs: {
    flexDirection: 'row',
    marginTop: 14,
    padding: 3,
    borderRadius: 12,
    backgroundColor: Colors.divider,
  },
  packsTab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 8,
    borderRadius: 10,
  },
  packsTabActive: {
    backgroundColor: Colors.card,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  packsTabText: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.textTertiary,
  },
  packsTabTextActive: {
    color: Colors.primary,
  },
  packsTabTextDone: {
    color: Colors.success,
  },
  preparingInnerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 10,
    backgroundColor: Colors.primaryLight,
    borderWidth: 1,
    borderColor: Colors.primary + '33',
    gap: 8,
  },
  preparingText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
    color: Colors.primaryDark,
  },
  // 卡片内的分类卡组行：底色按分类识别色做极淡 tint（由 renderSubPack 动态给）
  subCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    marginTop: 10,
    paddingRight: 12,
    borderWidth: 1,
    borderColor: 'transparent',
    overflow: 'hidden',
  },
  subColorBar: {
    width: 4,
    alignSelf: 'stretch',
  },
  subCardBody: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 14,
    paddingHorizontal: 12,
  },
  subCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  subCardName: {
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginRight: 8,
  },
  subCountPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: Colors.card,
  },
  subCountPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.textSecondary,
  },
  subMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    gap: 12,
  },
  subMetaText: {
    fontSize: 12,
    color: Colors.textSecondary,
  },
  subTodayText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.primary,
  },
  subProgressWrap: {
    marginTop: 8,
  },

  // 未登录时的分类卡组占位（无按钮，避免与上方登录入口重复）
  lockedBox: {
    marginTop: 12,
    paddingVertical: 22,
    paddingHorizontal: 20,
    borderRadius: 14,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: Colors.border,
    backgroundColor: Colors.card,
    alignItems: 'center',
    gap: 8,
  },
  lockedTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.textSecondary,
  },
  lockedDesc: {
    fontSize: 12,
    color: Colors.textMuted,
  },

  // 空态 / 加载
  centerPadding: {
    paddingTop: 26,
    paddingBottom: 10,
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 13,
    color: Colors.textSecondary,
  },
  emptyWrap: {
    alignItems: 'center',
    paddingTop: 22,
    paddingHorizontal: 20,
  },
  emptyText: {
    fontSize: 14,
    color: Colors.textMuted,
    marginTop: 12,
    textAlign: 'center',
  },
  retryBtn: {
    marginTop: 16,
    paddingHorizontal: 20,
    paddingVertical: 8,
    backgroundColor: Colors.primary,
    borderRadius: 8,
  },
  retryText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  footerLoading: {
    paddingVertical: 20,
    alignItems: 'center',
  },

  // ── 顶部用户信息卡 ──
  userCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.card,
    borderRadius: 18,
    marginHorizontal: 16,
    marginTop: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 3,
  },
  userCardLoading: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 10,
  },
  userCardLoadingText: {
    fontSize: 13,
    color: Colors.textSecondary,
  },
  userCardMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 0,
  },
  avatarWrap: {
    width: 48,
    height: 48,
    marginRight: 12,
  },
  avatarCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: Colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // 会员头像：金环 + 金色浅底
  avatarCircleVip: {
    backgroundColor: Colors.gold + '1A',
    borderWidth: 2,
    borderColor: Colors.gold,
  },
  avatarVipBadge: {
    position: 'absolute',
    right: 10,
    bottom: -2,
    width: 17,
    height: 17,
    borderRadius: 9,
    backgroundColor: Colors.gold,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: Colors.card,
  },
  userInfo: {
    flex: 1,
    minWidth: 0,
  },
  userNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  userName: {
    fontSize: 17,
    fontWeight: '800',
    color: Colors.textPrimary,
    flexShrink: 1,
  },
  vipTag: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 11,
    gap: 3,
  },
  vipTagActive: {
    backgroundColor: Colors.gold,
  },
  vipTagUpgrade: {
    borderWidth: 1,
    borderColor: Colors.gold + '66',
    backgroundColor: Colors.gold + '14',
  },
  vipTagText: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.gold,
  },
  vipTagTextActive: {
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },
  userSub: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 3,
  },
  profileEntry: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 10,
    paddingVertical: 6,
  },
  loginBtnSmall: {
    backgroundColor: Colors.primary,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 10,
  },
  loginBtnSmallText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },

  // ── 底部说明卡（电脑端插件） ──
  tipCard: {
    backgroundColor: Colors.backgroundAlt,
    borderRadius: 16,
    marginHorizontal: 16,
    marginBottom: 24,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  tipHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  tipTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: Colors.textPrimary,
  },
  tipText: {
    fontSize: 13,
    lineHeight: 21,
    color: Colors.textSecondary,
  },
  // 生词本卡片标题行左侧（可点击进入列表）
  dashHeaderLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 0,
  },
});
