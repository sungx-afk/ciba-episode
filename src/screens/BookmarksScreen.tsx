import React, { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  SafeAreaView,
  Animated,
  Easing,
  LayoutAnimation,
  Platform,
  UIManager,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useProgress } from '../storage/progressStore';
import { useAuth } from '../context/AuthContext';
import { Colors } from '../theme/colors';
import { Word } from '../types';
import { Header } from '../components/Header';
import { RichText } from '../components/RichText';
import { ConfirmDialog, DialogPayload } from '../components/ConfirmDialog';
import { pronounceWord } from '../utils/speech';
import { showToast } from '../utils/toast';
import { playRememberedSound } from '../utils/effectSound';
import {
  fetchBookmarkedWords,
  fetchDefaultMoviePackId,
  getCachedBookmarkPackId,
  BOOKMARK_PAGE_SIZE,
  BOOKMARK_LEARNING_TYPES,
  BOOKMARK_MASTERED_TYPES,
} from '../services/bookmarkApi';
import { AUTH_EXPIRED_RESULT } from '../services/api';
import {
  checkVipGate,
  clearVipGateCache,
  FREE_MASTERED_LIMIT,
  VipGateResult,
} from '../services/vipGate';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

/** 列表分组 */
type TabKey = 'learning' | 'mastered' | 'all';

interface TabMeta {
  key: TabKey;
  label: string;
  /** 传给服务端的卡片状态过滤，不传表示该词库下全部卡片 */
  types?: number[];
}

/** 顶部三个 tab：学习中 / 已记住 / 全部，各自对应一组服务端 type 过滤 */
const BOOKMARK_TABS: TabMeta[] = [
  { key: 'learning', label: '学习中', types: BOOKMARK_LEARNING_TYPES },
  { key: 'mastered', label: '已记住', types: BOOKMARK_MASTERED_TYPES },
  { key: 'all', label: '全部', types: undefined },
];

const TAB_TYPES: Record<TabKey, number[] | undefined> = {
  learning: BOOKMARK_LEARNING_TYPES,
  mastered: BOOKMARK_MASTERED_TYPES,
  all: undefined,
};

interface TabState {
  words: Word[];
  /** 服务端给出的该分组总数（不一定都已加载到本地） */
  total: number;
  hasMore: boolean;
  loadingMore: boolean;
}

/**
 * 点过卡片右侧按钮后，这段时间内忽略整行点击。
 * RN 里「按下命中谁就由谁接管」，但快速连点、按钮瞬时不可点或列表刚好重排时，
 * 收尾手势可能落到整行卡片上，表现为点了「已记住」却进了背诵页。
 */
const CHILD_ACTION_GRACE_MS = 350;
/** 右侧圆按钮 34pt，补一圈点击区到接近 44pt */
const ACTION_HIT_SLOP = { top: 8, bottom: 8, left: 5, right: 5 };

const emptyTab = (): TabState => ({ words: [], total: 0, hasMore: false, loadingMore: false });
const emptyTabs = (): Record<TabKey, TabState> => ({
  learning: emptyTab(),
  mastered: emptyTab(),
  all: emptyTab(),
});

/** 卡片淡出时长：按钮反馈之后才开始，避免「先消失再响应」 */
const LEAVE_DURATION = 260;

interface BookmarksScreenProps {
  navigation: any;
}

/** 被 VIP 拦截、待开通会员后继续执行的「标记记住」 */
type PendingMark = { type: 'single'; word: Word } | { type: 'all'; words: Word[] };

/** note 首行可能是音标（如「英 /ɡleɪd/  美 /ɡleɪd/」或「[ɡleɪd]」） */
function extractPhonetic(note: string): string {
  if (!note) return '';
  const first = note.split('\n')[0].trim();
  if (/^(美|英)?\s*(\/|\[)/.test(first) || /^\/[^/]{1,30}\//.test(first)) return first;
  return '';
}

/** 去掉音标行后的助记/例句 */
function noteWithoutPhonetic(note: string, phonetic: string): string {
  if (!note) return '';
  const flat = note.replace(/\n/g, ' ').trim();
  if (!phonetic) return flat;
  return flat.slice(phonetic.length).trim();
}

interface WordRowProps {
  word: Word;
  /** 已经是「已记住」：右侧不再是可点的按钮，而是一个实心对勾 */
  mastered: boolean;
  showDetail: boolean;
  accent: 'en-US' | 'en-GB';
  onPress: () => void;
  onMastered: (word: Word) => Promise<void>;
}

/**
 * 生词卡片：右侧圆形按钮为「标记为已记住」。
 * 点击后：按钮弹一下并由描边变实心（对勾放大回弹），卡片淡出右滑，
 * 父组件紧接着把它从列表里删掉，layout 动画收拢留下的空隙。
 */
const WordRow: React.FC<WordRowProps> = ({
  word,
  mastered,
  showDetail,
  accent,
  onPress,
  onMastered,
}) => {
  /** 0 -> 1：按钮由描边变实心，给一个「已勾上」的确认反馈 */
  const fill = useRef(new Animated.Value(0)).current;
  /** 0 -> 1：卡片淡出并右滑，随后由列表删除 */
  const leave = useRef(new Animated.Value(0)).current;
  /** 按钮按下反馈 */
  const press = useRef(new Animated.Value(0)).current;
  const [busy, setBusy] = useState(false);
  /** 最近一次点击右侧按钮的时间，用于抑制误落到整行的点击 */
  const lastActionAt = useRef(0);

  /** 右侧按钮都记一下时间：接下来的一小段时间里整行点击不再进背诵页 */
  const markAction = () => {
    lastActionAt.current = Date.now();
  };

  /** 整行点击：刚操作过右侧按钮就忽略这一次，避免误进背诵页 */
  const handleRowPress = () => {
    if (Date.now() - lastActionAt.current < CHILD_ACTION_GRACE_MS) return;
    onPress();
  };

  const phonetic = useMemo(() => extractPhonetic(word.note), [word.note]);
  const noteBody = useMemo(() => noteWithoutPhonetic(word.note, phonetic), [word.note, phonetic]);

  const handlePronounce = (e: any) => {
    e?.stopPropagation?.();
    markAction();
    pronounceWord(word.word, { accent });
  };

  const startMastered = async () => {
    try {
      await onMastered(word);
    } catch {
      // 标记失败：按钮退回描边、卡片滑回来
      Animated.parallel([
        Animated.timing(fill, { toValue: 0, duration: 200, useNativeDriver: false }),
        Animated.timing(leave, { toValue: 0, duration: 200, useNativeDriver: true }),
      ]).start();
      setBusy(false);
      return;
    }
    setBusy(false);
  };

  const handleMastered = (e: any) => {
    e?.stopPropagation?.();
    // 先记时间：忙时直接返回，也别把这一次点击让给整行卡片
    markAction();
    if (busy || mastered) return;
    setBusy(true);

    // ① 按钮按下：缩一下再弹回
    Animated.sequence([
      Animated.timing(press, { toValue: 1, duration: 90, useNativeDriver: true }),
      Animated.spring(press, { toValue: 0, friction: 4, tension: 180, useNativeDriver: true }),
    ]).start();
    // ② 由描边变实心，对勾同步放大回弹
    Animated.spring(fill, { toValue: 1, friction: 5, tension: 140, useNativeDriver: false }).start();
    // ③ 卡片随后淡出右滑，剩下的空隙由列表的 layout 动画收拢
    Animated.timing(leave, {
      toValue: 1,
      duration: LEAVE_DURATION,
      delay: 130,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();

    // 先给反馈再上报，点击没有等待感
    void startMastered();
  };

  return (
    <Animated.View
      // 已点过「已记住」的卡片正在滑出，别再接收点击，避免残影被点到进了背诵页
      pointerEvents={busy ? 'none' : 'auto'}
      style={[
        styles.card,
        {
          opacity: leave.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
          transform: [
            { translateX: leave.interpolate({ inputRange: [0, 1], outputRange: [0, 32] }) },
          ],
        },
      ]}
    >
      <TouchableOpacity style={styles.cardInner} onPress={handleRowPress} activeOpacity={0.7}>
        <View style={styles.cardMainRow}>
          <View style={styles.titleWrap}>
            <View style={styles.titleLine}>
              <Text style={styles.cardTitle} numberOfLines={2}>
                {word.word}
              </Text>
              <TouchableOpacity
                style={styles.soundBtn}
                onPress={handlePronounce}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="volume-medium-outline" size={18} color={Colors.primary} />
              </TouchableOpacity>
            </View>
            {/* 音标单独一行，长单词或长音标都不会把标题挤变形 */}
            {phonetic ? (
              <Text style={styles.titlePhonetic} numberOfLines={1}>
                {phonetic}
              </Text>
            ) : null}
          </View>

          <View style={styles.actionRow}>
            {mastered ? (
              // 已记住的实心对勾不可点，但仍要自己吃掉触摸，否则会穿透到整行进了背诵页
              <TouchableOpacity
                style={[styles.roundBtn, styles.doneBtn]}
                onPress={markAction}
                activeOpacity={1}
                accessibilityLabel="已记住"
              >
                <Ionicons name="checkmark" size={20} color="#FFFFFF" />
              </TouchableOpacity>
            ) : (
              <Animated.View
                style={{
                  transform: [
                    { scale: press.interpolate({ inputRange: [0, 1], outputRange: [1, 0.82] }) },
                  ],
                }}
              >
                <TouchableOpacity
                  onPress={handleMastered}
                  activeOpacity={0.85}
                  hitSlop={ACTION_HIT_SLOP}
                  accessibilityLabel="标记为已记住"
                >
                  <Animated.View
                    style={[
                      styles.roundBtn,
                      {
                        backgroundColor: fill.interpolate({
                          inputRange: [0, 1],
                          outputRange: [Colors.success + '15', Colors.success],
                        }),
                        borderColor: fill.interpolate({
                          inputRange: [0, 1],
                          outputRange: [Colors.success + '55', Colors.success],
                        }),
                      },
                    ]}
                  >
                    <Animated.View
                      style={{
                        transform: [
                          {
                            scale: fill.interpolate({
                              inputRange: [0, 0.45, 1],
                              outputRange: [1, 1.35, 1],
                            }),
                          },
                        ],
                      }}
                    >
                      {/* 描边态与实心态的两个图标叠在一起交叉淡入淡出 */}
                      <View style={styles.checkIconStack}>
                        <Animated.View
                          style={{
                            opacity: fill.interpolate({
                              inputRange: [0, 0.5, 1],
                              outputRange: [1, 0.3, 0],
                            }),
                          }}
                        >
                          <Ionicons name="checkmark" size={20} color={Colors.success} />
                        </Animated.View>
                        <Animated.View
                          style={[
                            StyleSheet.absoluteFill,
                            {
                              opacity: fill.interpolate({
                                inputRange: [0, 0.5, 1],
                                outputRange: [0, 0.7, 1],
                              }),
                            },
                          ]}
                        >
                          <Ionicons name="checkmark" size={20} color="#FFFFFF" />
                        </Animated.View>
                      </View>
                    </Animated.View>
                  </Animated.View>
                </TouchableOpacity>
              </Animated.View>
            )}
          </View>
        </View>

        {showDetail ? (
          <View style={styles.detailBox}>
            <Text style={styles.detailAnswer} numberOfLines={2}>
              {word.meaning}
            </Text>
            {noteBody ? <RichText text={noteBody} style={styles.detailNote} /> : null}
          </View>
        ) : null}
      </TouchableOpacity>
    </Animated.View>
  );
};

/**
 * 生词本：
 *  - 顶部三个 tab（学习中 / 已记住 / 全部），各按自己的 type 过滤向服务端分页取数
 *  - 滚动到底追加下一页，打开页面时不再循环拉全量
 *  - 列表里点右侧对勾即标记为已记住，本地立刻从「学习中」移到「已记住」
 */
export const BookmarksScreen: React.FC<BookmarksScreenProps> = ({ navigation }) => {
  const { state, stats, recordReview, recordReviews, isLoggedIn } = useProgress();
  // 会员状态与注册时间都来自用户信息
  const { user, refreshUserInfo } = useAuth();

  /** 当前分组 */
  const [activeTab, setActiveTab] = useState<TabKey>('learning');
  /** 三个 tab 各自的分页数据 */
  const [tabs, setTabs] = useState<Record<TabKey, TabState>>(emptyTabs);
  /** 生词本词库 id：学习结果要按它上报 */
  const [bookmarkPackId, setBookmarkPackId] = useState(0);

  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [needLogin, setNeedLogin] = useState(false);
  const [showDetail, setShowDetail] = useState(false);
  /** 「全部记住」进行中：批量请求只有一个来回，这里只记录进行中与总数 */
  const [markAll, setMarkAll] = useState({ running: false, total: 0 });
  /** 统一弹窗状态：确认/提示一律走 ConfirmDialog，不再使用系统 Alert */
  const [dialog, setDialog] = useState<DialogPayload | null>(null);
  /** 被会员限制拦截下来的「标记记住」，开通会员后自动继续 */
  const pendingMarkRef = useRef<PendingMark | null>(null);

  // 防止并发请求 & 丢弃过期请求的结果
  const loadingRef = useRef(false);
  const genRef = useRef(0);
  const reqIdRef = useRef<Record<TabKey, number>>({ learning: 0, mastered: 0, all: 0 });
  /** loadMore 要读到最新的分页状态，又不能因为它重建回调 */
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;

  const activeState = tabs[activeTab];
  const words = activeState.words;

  /** 三个 tab 各拉第一页：一次拿到分组数量，切换 tab 无需等待 */
  const loadTabs = useCallback(async (mode: 'initial' | 'refresh') => {
    if (loadingRef.current) return;

    loadingRef.current = true;
    const gen = ++genRef.current;
    if (mode === 'initial') setInitialLoading(true);
    else setRefreshing(true);

    try {
      const failures: any[] = [];

      // 先确定生词本词库 id，后面三个 tab 的请求与上报共用它
      try {
        await fetchDefaultMoviePackId();
        setBookmarkPackId(getCachedBookmarkPackId());
      } catch (e) {
        failures.push(e);
      }

      await Promise.all(
        BOOKMARK_TABS.map(async ({ key, types }) => {
          const reqId = ++reqIdRef.current[key];
          try {
            const page = await fetchBookmarkedWords({
              start: 0,
              limit: BOOKMARK_PAGE_SIZE,
              types,
            });
            if (gen !== genRef.current || reqId !== reqIdRef.current[key]) return;
            setTabs((prev) => ({
              ...prev,
              [key]: {
                words: page.words,
                total: page.total,
                hasMore: page.hasMore,
                loadingMore: false,
              },
            }));
          } catch (e) {
            if (gen !== genRef.current || reqId !== reqIdRef.current[key]) return;
            failures.push(e);
          }
        })
      );

      if (gen !== genRef.current) return;

      const authErr = failures.find((e) => e?.result === AUTH_EXPIRED_RESULT);
      if (failures.length) {
        setNeedLogin(!!authErr);
        setErrorMsg(
          authErr
            ? '登录后即可同步你的生词本'
            : failures[0]?.message || '生词本加载失败，请稍后重试'
        );
      } else {
        setNeedLogin(false);
        setErrorMsg('');
      }
    } finally {
      loadingRef.current = false;
      if (gen === genRef.current) {
        setInitialLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  /** 追加下一页：滚动到底时按当前 tab 的筛选条件再取一页 */
  const loadMore = useCallback(async (key: TabKey) => {
    const cur = tabsRef.current[key];
    if (!cur.hasMore || cur.loadingMore) return;

    const reqId = ++reqIdRef.current[key];
    setTabs((prev) => ({ ...prev, [key]: { ...prev[key], loadingMore: true } }));

    try {
      const page = await fetchBookmarkedWords({
        start: cur.words.length,
        limit: BOOKMARK_PAGE_SIZE,
        types: TAB_TYPES[key],
      });
      if (reqId !== reqIdRef.current[key]) return;
      setTabs((prev) => {
        const t = prev[key];
        const seen = new Set(t.words.map((w) => w.id));
        const added = page.words.filter((w) => !seen.has(w.id));
        return {
          ...prev,
          [key]: {
            words: [...t.words, ...added],
            total: page.total,
            hasMore: page.hasMore,
            loadingMore: false,
          },
        };
      });
    } catch (e: any) {
      if (reqId !== reqIdRef.current[key]) return;
      setTabs((prev) => ({ ...prev, [key]: { ...prev[key], loadingMore: false } }));
      showToast('加载更多失败，请稍后重试');
    }
  }, []);

  // 首次进入 / 登录状态变化时重新拉取
  useEffect(() => {
    loadTabs('initial');
  }, [isLoggedIn, loadTabs]);

  // 每次重新聚焦（如从其它页面收藏后切回）时静默刷新，首次聚焦跳过
  const focusedOnceRef = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (!focusedOnceRef.current) {
        focusedOnceRef.current = true;
        return;
      }
      if (loadingRef.current) return;
      loadTabs('refresh');
    }, [loadTabs])
  );

  const handleRefresh = useCallback(() => loadTabs('refresh'), [loadTabs]);

  /** 会员限制的升级弹窗：一律走 ConfirmDialog */
  const showVipDialog = useCallback(
    (message: string) => {
      setDialog({
        title: '需要升级 VIP 会员',
        message,
        confirmText: '去开通',
        onConfirm: () => {
          setDialog(null);
          // pendingMarkRef 保留，支付成功后返回会自动继续这次标记
          navigation.navigate('Purchase');
        },
        onCancel: () => {
          setDialog(null);
          pendingMarkRef.current = null;
        },
      });
    },
    [navigation]
  );

  /**
   * 非会员免费额度校验（与单词列表页同一套规则）。
   * 返回值：null 表示放行；否则为被限制的结果（含 reason/message）。
   */
  const runVipGate = useCallback(
    async (options?: { silent?: boolean }): Promise<VipGateResult | null> => {
      const { silent = false } = options || {};
      // 会员状态请求失败时不拦截操作，也不把异常抛给调用方
      let gate: VipGateResult;
      try {
        gate = await checkVipGate({
          userVip: (user as any)?.vip,
          masteredCount: stats.masteredCount,
          createDate: (user as any)?.createDate,
        });
      } catch {
        return null;
      }
      if (!gate.blocked) return null;
      if (!silent) showVipDialog(gate.message || '升级 VIP 会员后可继续使用');
      return gate;
    },
    [user, stats.masteredCount, showVipDialog]
  );

  /** 进入复习模式：队列为当前 tab 已加载的生词，焦点为点击的那个单词 */
  const openStudy = useCallback(
    (startWordId?: number) => {
      const list = tabs[activeTab].words;
      if (!list.length) {
        setDialog({ title: '提示', message: '当前列表还没有单词', showCancel: false });
        return;
      }
      const index = startWordId === undefined ? 0 : list.findIndex((w) => w.id === startWordId);
      navigation.navigate('BookmarkStudy', {
        words: list,
        startIndex: index < 0 ? 0 : index,
        total: tabs[activeTab].total,
        // 复习页继续翻页时要沿用同一个筛选条件，否则会从「全部」里接着取
        types: TAB_TYPES[activeTab],
      });
    },
    [navigation, tabs, activeTab]
  );

  /** 列表底部的提示卡：与首页同一张「边看美剧，边学生词」的说明，只展示不做跳转 */
  const renderTipCard = () => (
    <View style={styles.tipCard}>
      <View style={styles.tipHeader}>
        <View style={styles.tipTitleRow}>
          <Ionicons name="bulb" size={15} color={Colors.accent} />
          <Text style={styles.tipTitle}>边看美剧，边学生词</Text>
        </View>
      </View>
      <Text style={styles.tipText}>
        电脑访问 <Text style={styles.tipLink}>www.cibaen.com</Text>{' '}
        安装 Chrome 浏览器插件后，即可在爱奇艺、B 站观看带字幕的视频时，边看视频边添加英文生词。然后在手机上碎片时间记忆单词。
      </Text>
    </View>
  );

  /**
   * 把「标记记住」的结果落到三个 tab 上：
   *  - 学习中：直接移除（服务端不会再把它算进来）
   *  - 已记住：插到队首
   *  - 全部：留在原地把 type 改成 4
   */
  const applyRemembered = useCallback((marked: Word[]) => {
    if (!marked.length) return;
    const ids = new Set(marked.map((w) => w.id));
    const asRemembered = (w: Word): Word => ({ ...w, type: 4 });

    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setTabs((prev) => {
      const next = { ...prev };
      for (const { key } of BOOKMARK_TABS) {
        const t = prev[key];
        if (key === 'learning') {
          const removed = t.words.filter((w) => ids.has(w.id)).length;
          next[key] = {
            ...t,
            words: t.words.filter((w) => !ids.has(w.id)),
            total: Math.max(0, t.total - removed),
          };
        } else if (key === 'mastered') {
          const added = marked.filter((w) => !t.words.some((x) => x.id === w.id));
          next[key] = {
            ...t,
            words: [...added.map(asRemembered), ...t.words.filter((w) => !ids.has(w.id))],
            total: t.total + added.length,
          };
        } else {
          next[key] = {
            ...t,
            words: t.words.map((w) => (ids.has(w.id) ? asRemembered(w) : w)),
          };
        }
      }
      return next;
    });
  }, []);

  /** 标记单个单词为已记住：按钮实心化后卡片划走，随后按 tab 归属移动分组 */
  const handleMarkMastered = async (word: Word) => {
    // 非会员达到免费额度时先拦截，引导升级会员后再继续
    if (await runVipGate()) {
      pendingMarkRef.current = { type: 'single', word };
      // 抛错走与上报失败相同的回滚：卡片滑回来
      throw new Error('VIP_GATE');
    }

    try {
      // 生词本不属于当前词库，必须显式带上它自己的词库 id
      await recordReview(word.id, 'remembered', { packId: bookmarkPackId || undefined });
      playRememberedSound();
      applyRemembered([word]);
    } catch (e: any) {
      setDialog({
        title: '保存失败',
        message: e?.message || '标记已记住失败，请重试',
        showCancel: false,
      });
      throw e;
    }
  };

  /** 全部记住：一次批量请求标记当前列表，成功后统一刷新界面 */
  const runMarkAll = async (targets: Word[]) => {
    if (!targets.length) return;

    // 免费额度只够标记一部分时，先标记够的那部分，剩下的留到开通会员后继续
    let batch = targets;
    let rest: Word[] = [];
    const blocked = await runVipGate({ silent: true });
    if (blocked) {
      const remaining =
        blocked.reason === 'mastered'
          ? Math.max(0, FREE_MASTERED_LIMIT - stats.masteredCount)
          : 0;
      batch = targets.slice(0, remaining);
      rest = targets.slice(remaining);
    }

    if (!batch.length) {
      // 一个都标记不了：提示升级会员，剩下的等开通后自动继续
      pendingMarkRef.current = { type: 'all', words: rest.length ? rest : targets };
      await runVipGate();
      return;
    }

    setMarkAll({ running: true, total: batch.length });

    try {
      await recordReviews(
        batch.map((w) => w.id),
        'remembered',
        { packId: bookmarkPackId || undefined }
      );
      setMarkAll({ running: false, total: 0 });
      applyRemembered(batch);
      showToast(`已把 ${batch.length} 个单词标记为已记住`);
    } catch (e: any) {
      setMarkAll({ running: false, total: 0 });
      setDialog({
        title: '标记失败',
        message: e?.message || '批量标记已记住失败，请检查网络后重试',
        showCancel: false,
      });
    }

    if (rest.length) {
      // 免费额度用完了：剩下这些等会员开通后接着标记
      pendingMarkRef.current = { type: 'all', words: rest };
      await runVipGate();
    }
  };

  /** 点击「全部记住」：先用 ConfirmDialog 二次确认，确认后再发起批量请求 */
  const handleMarkAll = () => {
    if (markAll.running) return;
    const targets = words.filter((w) => w.type !== 4);
    if (!targets.length) {
      setDialog({
        title: '提示',
        message: '没有未记住的单词了',
        showCancel: false,
      });
      return;
    }
    setDialog({
      title: '全部记住',
      message: `将把当前列表 ${targets.length} 个未记住的单词标记为已记住，是否继续？`,
      onConfirm: () => {
        setDialog(null);
        runMarkAll(targets);
      },
    });
  };

  // 供「从会员页返回」时调用最新的标记方法
  const handleMarkMasteredRef = useRef(handleMarkMastered);
  useEffect(() => {
    handleMarkMasteredRef.current = handleMarkMastered;
  }, [handleMarkMastered]);
  const runMarkAllRef = useRef(runMarkAll);
  useEffect(() => {
    runMarkAllRef.current = runMarkAll;
  }, [runMarkAll]);

  /**
   * 从会员页返回：先刷新用户信息与会员状态，
   * 已开通会员就自动继续刚才被拦截的「单个标记 / 全部记住」。
   */
  useFocusEffect(
    useCallback(() => {
      const pending = pendingMarkRef.current;
      if (!pending) return;
      (async () => {
        clearVipGateCache();
        try {
          await refreshUserInfo?.();
        } catch {
          // 刷新失败不阻断，下面仍会按最新接口结果判断
        }
        // silent 校验：没开通就丢弃待办，否则每次回到页面都会再弹一次升级弹窗
        if (await runVipGate({ silent: true })) {
          pendingMarkRef.current = null;
          return;
        }
        pendingMarkRef.current = null;
        showToast('会员已开通，继续标记');
        if (pending.type === 'single') {
          try {
            await handleMarkMasteredRef.current(pending.word);
          } catch {
            // 继续失败时卡片已回滚，不再额外弹窗
          }
        } else {
          await runMarkAllRef.current(pending.words);
        }
      })();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user, stats.masteredCount])
  );

  const totalCount = tabs.all.total;
  const rememberedCount = tabs.mastered.total;
  const showEmptyState = !initialLoading && !errorMsg && !needLogin && totalCount === 0;

  /** 当前 tab 的空态文案 */
  const emptyState = useMemo(() => {
    if (activeTab === 'mastered') {
      return {
        icon: 'checkmark-done-outline',
        color: Colors.success,
        title: '还没有记住的单词',
        text: '在「学习中」点单词右侧的对勾，记住的单词会出现在这里',
      };
    }
    if (activeTab === 'all') {
      return {
        icon: 'bookmark-outline',
        color: Colors.border,
        title: '生词本是空的',
        text: '在背词或单词列表里点击书签图标，随时将难记生词收藏到这里',
      };
    }
    return {
      icon: 'checkmark-done-circle',
      color: Colors.success,
      title: '全部记住啦',
      text: totalCount ? '生词本里的单词都已标记为已记住' : '还没有收藏任何单词',
    };
  }, [activeTab, totalCount]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <Header
        title="生词本"
        onBack={() => navigation.goBack()}
        subtitle={
          initialLoading && totalCount === 0
            ? '正在加载...'
            : `共 ${totalCount} 词 · 已记住 ${rememberedCount}`
        }
        rightAction={{
          icon: 'play-circle',
          onPress: () => openStudy(),
        }}
      />

      {/* 顶部操作条：左侧为分组 tab，右侧显示/隐藏词义 */}
      <View style={styles.topBar}>
        <View style={styles.segmentWrap}>
          {BOOKMARK_TABS.map((t) => {
            const active = t.key === activeTab;
            const count = tabs[t.key].total;
            return (
              <TouchableOpacity
                key={t.key}
                style={[styles.segment, active && styles.segmentActive]}
                onPress={() => setActiveTab(t.key)}
                activeOpacity={0.8}
              >
                <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
                  {t.label}
                  {count ? ` ${count}` : ''}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={styles.topActions}>
          <TouchableOpacity
            style={[styles.ghostBtn, showDetail && styles.ghostBtnActive]}
            onPress={() => setShowDetail((v) => !v)}
            activeOpacity={0.8}
          >
            <Ionicons
              name={showDetail ? 'eye-off-outline' : 'eye-outline'}
              size={15}
              color={showDetail ? Colors.primary : Colors.textTertiary}
            />
            <Text style={[styles.ghostBtnText, showDetail && styles.ghostBtnTextActive]}>词义</Text>
          </TouchableOpacity>
          {/* 「全部记住」入口暂时下掉，批量标记的逻辑仍保留在 handleMarkAll */}
        </View>
      </View>

      {initialLoading && totalCount === 0 ? (
        <View style={styles.centerWrap}>
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text style={styles.centerText}>正在加载生词本...</Text>
        </View>
      ) : null}

      {!initialLoading && needLogin ? (
        <View style={styles.centerWrap}>
          <Ionicons name="person-circle-outline" size={64} color={Colors.border} />
          <Text style={styles.emptyTitle}>登录后同步生词本</Text>
          <Text style={styles.emptyDesc}>{errorMsg}</Text>
          <TouchableOpacity
            style={styles.loginBtn}
            onPress={() => navigation.navigate('Login')}
            activeOpacity={0.8}
          >
            <Text style={styles.loginBtnText}>去登录</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {!initialLoading && !needLogin && !!errorMsg ? (
        <View style={styles.centerWrap}>
          <Ionicons name="cloud-offline-outline" size={64} color={Colors.border} />
          <Text style={styles.emptyTitle}>加载失败</Text>
          <Text style={styles.emptyDesc}>{errorMsg}</Text>
          <TouchableOpacity
            style={styles.loginBtn}
            onPress={() => loadTabs('initial')}
            activeOpacity={0.8}
          >
            <Text style={styles.loginBtnText}>重新加载</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {!initialLoading && !needLogin && !errorMsg ? (
        <FlatList
          data={words}
          keyExtractor={(item) => String(item.id)}
          style={styles.list}
          renderItem={({ item }) => (
            <WordRow
              word={item}
              mastered={item.type === 4 || activeTab === 'mastered'}
              showDetail={showDetail}
              accent={state.accent}
              onPress={() => openStudy(item.id)}
              onMastered={handleMarkMastered}
            />
          )}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={Colors.primary}
            />
          }
          onEndReached={() => loadMore(activeTab)}
          onEndReachedThreshold={0.4}
          ListEmptyComponent={
            showEmptyState || !words.length ? (
              <View style={styles.emptyWrap}>
                <Ionicons name={emptyState.icon as any} size={56} color={emptyState.color} />
                <Text style={styles.emptyTitle}>{emptyState.title}</Text>
                <Text style={styles.emptyText}>{emptyState.text}</Text>
              </View>
            ) : null
          }
          ListFooterComponent={
            <>
              {activeState.loadingMore ? (
                <View style={styles.footerLoading}>
                  <ActivityIndicator size="small" color={Colors.primary} />
                </View>
              ) : words.length && !activeState.hasMore ? (
                <Text style={styles.footerText}>没有更多单词了</Text>
              ) : null}
              {/* 空列表时也渲染，正好告诉用户生词从哪来 */}
              {renderTipCard()}
            </>
          }
        />
      ) : null}

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
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 8,
    gap: 8,
  },
  segmentWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.divider,
    borderRadius: 14,
    padding: 2,
  },
  segment: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 12,
  },
  segmentActive: {
    backgroundColor: Colors.card,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
  },
  segmentText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textTertiary,
  },
  segmentTextActive: {
    color: Colors.primary,
  },
  topActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  ghostBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  ghostBtnActive: {
    backgroundColor: Colors.primaryLight,
    borderColor: Colors.primary + '40',
  },
  ghostBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textTertiary,
  },
  ghostBtnTextActive: {
    color: Colors.primary,
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingTop: 4,
    paddingBottom: 20,
  },
  card: {
    backgroundColor: Colors.card,
    borderRadius: 14,
    marginVertical: 6,
    marginHorizontal: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  cardInner: {
    padding: 14,
  },
  cardMainRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  titleWrap: {
    flex: 1,
    minWidth: 0,
    paddingRight: 8,
  },
  titleLine: {
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 0,
  },
  cardTitle: {
    flexShrink: 1,
    fontSize: 20,
    fontWeight: '700',
    color: Colors.textPrimary,
    letterSpacing: 0.3,
  },
  titlePhonetic: {
    marginTop: 2,
    fontSize: 13,
    lineHeight: 18,
    color: Colors.primary,
  },
  soundBtn: {
    marginLeft: 8,
    padding: 4,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  roundBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  doneBtn: {
    backgroundColor: Colors.success,
    borderColor: Colors.success,
  },
  checkIconStack: {
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailBox: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.divider,
  },
  detailAnswer: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.textPrimary,
    lineHeight: 22,
  },
  detailNote: {
    marginTop: 4,
    fontSize: 12,
    color: Colors.textMuted,
    lineHeight: 18,
  },
  footerLoading: {
    paddingVertical: 16,
    alignItems: 'center',
  },
  footerText: {
    paddingVertical: 16,
    textAlign: 'center',
    fontSize: 12,
    color: Colors.textMuted,
  },
  // ── 底部提示卡（电脑端插件） ──
  tipCard: {
    marginHorizontal: 16,
    marginTop: 6,
    marginBottom: 20,
    padding: 16,
    borderRadius: 20,
    backgroundColor: Colors.paper,
    borderWidth: 1,
    borderColor: 'rgba(194,154,78,0.18)',
  },
  tipHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 9,
  },
  tipTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    flexShrink: 1,
  },
  tipTitle: {
    fontSize: 14.5,
    fontWeight: '800',
    color: Colors.textPrimary,
  },
  tipText: {
    fontSize: 13,
    lineHeight: 22,
    color: Colors.textSecondary,
  },
  tipLink: {
    fontWeight: '700',
    color: Colors.pinwheelBlue,
  },
  centerWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 100,
    paddingHorizontal: 40,
  },
  centerText: {
    marginTop: 12,
    fontSize: 14,
    color: Colors.textMuted,
  },
  loginBtn: {
    marginTop: 20,
    paddingHorizontal: 28,
    paddingVertical: 10,
    borderRadius: 22,
    backgroundColor: Colors.primary,
  },
  loginBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  emptyWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
    paddingHorizontal: 40,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginTop: 16,
  },
  emptyDesc: {
    fontSize: 13,
    color: Colors.textMuted,
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 20,
  },
  emptyText: {
    fontSize: 13,
    color: Colors.textMuted,
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 20,
  },
});
