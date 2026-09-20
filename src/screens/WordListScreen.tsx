import React, { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  SafeAreaView,
  ScrollView,
  Animated,
  Easing,
  LayoutAnimation,
  Platform,
  UIManager,
  Dimensions,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useProgress } from '../storage/progressStore';
import { useAuth } from '../context/AuthContext';
import { Colors } from '../theme/colors';
import { Word } from '../types';
import { Header } from '../components/Header';
import { RichText } from '../components/RichText';
import { SectionBadge } from '../components/SectionBadge';
import { ConfirmDialog, DialogPayload } from '../components/ConfirmDialog';
import { pronounceWord } from '../utils/speech';
import { showToast } from '../utils/toast';
import { playRememberedSound } from '../utils/effectSound';
import { packLibrary } from '../services/packLibrary';
import { checkVipGate, clearVipGateCache, FREE_MASTERED_LIMIT, VipGateResult } from '../services/vipGate';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
/** 底部「已记住」区域高度 */
const BOTTOM_PANEL_HEIGHT = Math.min(190, Math.max(130, Math.round(SCREEN_HEIGHT * 0.26)));
/** 底部标签高度，也是飞行动画的终点尺寸 */
const TAG_HEIGHT = 28;
/** 飞行动画时长 */
const FLY_DURATION = 560;
/** 今日学习单词一次拉取的数量（与首页 / 背词页保持一致） */
const TODAY_WORD_LIMIT = 50;
/** 今日学习卡片的过滤：0 未学 / 1、2、3 学习中（已记住 4 不再出现） */
const TODAY_WORD_TYPES = [0, 1, 2, 3];
/** 卡组 summary（分类词汇辨析）缓存，避免反复请求；key = 账号id#卡组id */
const summaryCache = new Map<string, string>();

/**
 * 点过卡片右侧按钮后，这段时间内忽略整行点击。
 * RN 里「按下命中谁就由谁接管」，但快速连点、按钮瞬时不可点或列表刚好重排时，
 * 收尾手势可能落到整行卡片上，表现为点了「已记住」却进了背诵页。
 */
const CHILD_ACTION_GRACE_MS = 350;
/** 右侧圆按钮 34pt，补一圈点击区到接近 44pt；左右只补 5，避免与相邻按钮抢触摸 */
const ACTION_HIT_SLOP = { top: 8, bottom: 8, left: 5, right: 5 };

/** 卡片主标题的展示方式：英文单词 / 中文词义 */
type ViewMode = 'word' | 'meaning';

const SEGMENTS: { id: ViewMode; label: string }[] = [
  { id: 'word', label: '列表' },
  { id: 'meaning', label: '词义记忆' },
];

/** 某个元素在窗口中的位置（measureInWindow 的结果） */
interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 被 VIP 拦截、待开通会员后继续执行的「标记记住」 */
type PendingMark =
  | { type: 'single'; word: Word; from: Rect }
  | { type: 'all'; words: Word[] };

/** 同一父卡组下的兄弟卡组（用于「学习下一个卡组」） */
interface SiblingPack {
  id: number;
  name: string;
}

/** 一个正在飞往底部区域的单词标签 */
interface FlyItem {
  id: number;
  label: string;
  from: Rect;
  to: { x: number; y: number };
  /** 飞行层所在容器的窗口原点，用于把窗口坐标换算成相对坐标 */
  origin: { x: number; y: number };
  tagWidth: number;
  progress: Animated.Value;
}

interface WordListScreenProps {
  route: any;
  navigation: any;
}

/** note 首行可能是音标（如「美 /ɡleɪd/  英 /ɡleɪd/」或「[ɡleɪd]」） */
function extractPhonetic(note: string): string {
  if (!note) return '';
  const first = note.split('\n')[0].trim();
  if (/^(美|英)?\s*(\/|\[)/.test(first) || /^\/[^/]{1,30}\//.test(first)) return first;
  return '';
}

/**
 * 去掉例句部分：
 *  - 本地词库的「【例】...」行
 *  - 远程卡组的「例句:」标题行及其后的「• ...」条目行
 * 单词列表只留助记与辨析，例句在背诵页看。
 */
function noteWithoutSentences(note: string): string {
  if (!note) return '';
  const kept: string[] = [];
  let inSentences = false;
  for (const line of note.split('\n')) {
    const trimmed = line.trim();
    if (/^(【例】|例句\s*[:：])/.test(trimmed)) {
      inSentences = true;
      continue;
    }
    if (inSentences) {
      if (/^[•·]/.test(trimmed)) continue;
      inSentences = false;
    }
    kept.push(line);
  }
  return kept.join('\n').trim();
}

/** 去掉音标行后的助记/辨析 */
function noteWithoutPhonetic(note: string, phonetic: string): string {
  if (!note) return '';
  const flat = note.replace(/\n/g, ' ').trim();
  if (!phonetic) return flat;
  return flat.slice(phonetic.length).trim();
}

/** 测量元素在窗口中的位置 */
function measureInWindow(ref: React.RefObject<any>): Promise<Rect | null> {
  return new Promise((resolve) => {
    if (!ref.current) {
      resolve(null);
      return;
    }
    ref.current.measureInWindow((x: number, y: number, width: number, height: number) => {
      if (width === 0 && height === 0) resolve(null);
      else resolve({ x, y, width, height });
    });
  });
}

/** 飞行中的标签：从卡片位置缩放移动到底部区域，同时卡片样式渐变为标签样式 */
const FlyTag: React.FC<{ item: FlyItem }> = ({ item }) => {
  const p = item.progress;
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.flyTag,
        {
          left: p.interpolate({
            inputRange: [0, 1],
            outputRange: [item.from.x - item.origin.x, item.to.x - item.origin.x],
          }),
          top: p.interpolate({
            inputRange: [0, 1],
            outputRange: [item.from.y - item.origin.y, item.to.y - item.origin.y],
          }),
          width: p.interpolate({ inputRange: [0, 1], outputRange: [item.from.width, item.tagWidth] }),
          height: p.interpolate({
            inputRange: [0, 1],
            outputRange: [item.from.height, TAG_HEIGHT],
          }),
          borderRadius: p.interpolate({ inputRange: [0, 1], outputRange: [14, 10] }),
          paddingHorizontal: p.interpolate({ inputRange: [0, 1], outputRange: [14, 10] }),
          backgroundColor: p.interpolate({
            inputRange: [0, 0.55, 1],
            outputRange: [
              'rgba(255,255,255,1)',
              'rgba(63,122,87,0.12)',
              'rgba(63,122,87,0.12)',
            ],
          }),
          borderColor: p.interpolate({
            inputRange: [0, 0.55, 1],
            outputRange: [
              'rgba(221,219,208,1)',
              'rgba(63,122,87,0.35)',
              'rgba(63,122,87,0.35)',
            ],
          }),
          opacity: p.interpolate({ inputRange: [0, 0.9, 1], outputRange: [1, 1, 0] }),
        },
      ]}
    >
      <Animated.View style={{ opacity: p.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0, 0, 1] }) }}>
        <Ionicons name="checkmark" size={12} color={Colors.success} />
      </Animated.View>
      <Animated.Text
        numberOfLines={1}
        style={{
          flexShrink: 1,
          fontWeight: '700',
          fontSize: p.interpolate({ inputRange: [0, 1], outputRange: [19, 13] }),
          color: p.interpolate({
            inputRange: [0, 0.55, 1],
            outputRange: ['rgb(23,35,30)', 'rgb(63,122,87)', 'rgb(63,122,87)'],
          }),
        }}
      >
        {item.label}
      </Animated.Text>
    </Animated.View>
  );
};

interface WordRowProps {
  word: Word;
  mode: ViewMode;
  showDetail: boolean;
  accent: 'en-US' | 'en-GB';
  onPress: () => void;
  /** rect 为卡片在窗口中的位置，飞行标签以此为起点 */
  onMastered: (word: Word, rect: Rect) => Promise<void>;
  isBookmarked: boolean;
  onToggleBookmark: () => Promise<void>;
}

/** 未记住的单词卡片：右侧依次为加入生词本、标记为已记住 */
const WordRow: React.FC<WordRowProps> = ({
  word,
  mode,
  showDetail,
  accent,
  onPress,
  onMastered,
  isBookmarked,
  onToggleBookmark,
}) => {
  /** 0 -> 1：卡片淡出，把它「交给」飞行标签 */
  const hide = useRef(new Animated.Value(0)).current;
  /** 对勾按钮的按下反馈 */
  const press = useRef(new Animated.Value(0)).current;
  const cardRef = useRef<any>(null);
  const [busy, setBusy] = useState(false);
  const [bookmarking, setBookmarking] = useState(false);
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
  const noteBody = useMemo(
    () => noteWithoutPhonetic(noteWithoutSentences(word.note), phonetic),
    [word.note, phonetic]
  );

  const isMeaningMode = mode === 'meaning';
  const titleText = isMeaningMode ? word.meaning || word.word : word.word;
  const answerText = isMeaningMode ? word.word : word.meaning;

  const handlePronounce = (e: any) => {
    e?.stopPropagation?.();
    markAction();
    pronounceWord(word.word, { accent });
  };

  const handleBookmark = async (e: any) => {
    e?.stopPropagation?.();
    markAction();
    if (bookmarking) return;
    setBookmarking(true);
    try {
      await onToggleBookmark();
    } finally {
      setBookmarking(false);
    }
  };

  const handleMastered = (e: any) => {
    e?.stopPropagation?.();
    // 先记时间：忙时直接返回，也别把这一次点击让给整行卡片
    markAction();
    if (busy) return;
    setBusy(true);

    Animated.sequence([
      Animated.timing(press, { toValue: 1, duration: 110, useNativeDriver: true }),
      Animated.spring(press, { toValue: 0, friction: 4, tension: 180, useNativeDriver: true }),
    ]).start();

    // 先量出卡片当前位置，再交给父组件播放飞行动画
    const node = cardRef.current;
    if (node?.measureInWindow) {
      node.measureInWindow((x: number, y: number, width: number, height: number) => {
        startMastered({ x, y, width, height });
      });
    } else {
      startMastered({ x: 0, y: 0, width: 0, height: 0 });
    }
  };

  const startMastered = async (rect: Rect) => {
    Animated.timing(hide, { toValue: 1, duration: 140, useNativeDriver: true }).start();
    try {
      await onMastered(word, rect);
    } catch {
      // 标记失败：卡片淡回来
      Animated.timing(hide, { toValue: 0, duration: 200, useNativeDriver: true }).start();
      setBusy(false);
      return;
    }
    setBusy(false);
  };

  return (
    <Animated.View
      ref={cardRef}
      // 已点过「已记住」的卡片正在飞出，别再接收点击，避免残影被点到进了背诵页
      pointerEvents={busy ? 'none' : 'auto'}
      style={[styles.card, { opacity: hide.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) }]}
    >
      <TouchableOpacity style={styles.cardInner} onPress={handleRowPress} activeOpacity={0.7}>
        <View style={styles.cardMainRow}>
          <View style={styles.titleWrap}>
            <View style={styles.titleLine}>
              <Text style={[styles.cardTitle, isMeaningMode && styles.cardTitleCn]} numberOfLines={2}>
                {titleText}
              </Text>
              <TouchableOpacity
                style={styles.soundBtn}
                onPress={(e) => handlePronounce(e)}
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
            <TouchableOpacity
              style={[styles.roundBtn, isBookmarked ? styles.bookmarkBtnActive : styles.bookmarkBtn]}
              onPress={(e) => handleBookmark(e)}
              activeOpacity={0.85}
              hitSlop={ACTION_HIT_SLOP}
              accessibilityLabel="加入生词本"
            >
              <Ionicons
                name={isBookmarked ? 'bookmark' : 'bookmark-outline'}
                size={18}
                color={isBookmarked ? Colors.primary : Colors.textMuted}
              />
            </TouchableOpacity>

            <Animated.View
              style={{
                transform: [
                  { scale: press.interpolate({ inputRange: [0, 1], outputRange: [1, 0.82] }) },
                ],
              }}
            >
              <TouchableOpacity
                style={[styles.roundBtn, styles.checkBtn]}
                onPress={(e) => handleMastered(e)}
                activeOpacity={0.85}
                hitSlop={ACTION_HIT_SLOP}
                accessibilityLabel="标记为已记住"
              >
                <Ionicons name="checkmark" size={20} color={Colors.success} />
              </TouchableOpacity>
            </Animated.View>
          </View>
        </View>

        {showDetail ? (
          <View style={styles.detailBox}>
            <Text style={styles.detailAnswer} numberOfLines={2}>
              {answerText}
            </Text>
            {noteBody ? <RichText text={noteBody} style={styles.detailNote} /> : null}
          </View>
        ) : null}
      </TouchableOpacity>
    </Animated.View>
  );
};

export const WordListScreen: React.FC<WordListScreenProps> = ({ route, navigation }) => {
  const { category, subCategory, source, title: routeTitle } = route.params || {};
  const {
    state,
    stats,
    recordReview,
    recordReviews,
    toggleBookmark,
    words,
    todayWords,
    packWords,
    todayWordsPackId,
    packWordsPackId,
    loadTodayWords,
    loadPackWordList,
    currentTopPack,
  } = useProgress();
  // 会员状态与注册时间都来自用户信息
  const { user, refreshUserInfo } = useAuth();

  const [viewMode, setViewMode] = useState<ViewMode>('word');
  const [showDetail, setShowDetail] = useState(false);
  /** 「全部记住」进行中：批量请求只有一个来回，这里只记录进行中与总数 */
  const [markAll, setMarkAll] = useState({ running: false, total: 0 });
  const [flying, setFlying] = useState<FlyItem[]>([]);
  /**
   * 统一弹窗状态：确认/提示一律走 ConfirmDialog，不再使用系统 Alert。
   * 见 components/ConfirmDialog.tsx
   */
  const [dialog, setDialog] = useState<DialogPayload | null>(null);
  /** 被会员限制拦截下来的「标记记住」，开通会员后自动继续 */
  const pendingMarkRef = useRef<PendingMark | null>(null);

  const rootRef = useRef<any>(null);
  const bottomRef = useRef<any>(null);

  /** 「分类词汇辨析」：卡组详情里的 summary */
  const [packSummary, setPackSummary] = useState('');

  /** 当前列表所属卡组 id（今日学习 / 子卡组），非这两种来源时为 undefined */
  const listPackId = useMemo(
    () => (source === 'today' ? todayWordsPackId : source === 'pack' ? packWordsPackId : undefined),
    [source, todayWordsPackId, packWordsPackId]
  );

  const title =
    routeTitle || (subCategory ? `${category} · ${subCategory}` : category || '全部单词');
  /** 切到下一个卡组后的临时标题（兄弟列表还没刷新回来时先用它） */
  const [titleOverride, setTitleOverride] = useState<string | null>(null);

  /** 顶层卡组名：拉取下一个卡组的单词时要作为 cat 回传给服务端 */
  const topPackName = currentTopPack?.name || '';

  /** 同一父卡组下的兄弟卡组：学完当前卡组后用来继续学习下一个 */
  const [siblingPacks, setSiblingPacks] = useState<SiblingPack[]>([]);
  /** 当前卡组在兄弟列表中的位置，-1 表示未知（不显示按钮） */
  const [packCursor, setPackCursor] = useState(-1);
  /** 正在拉取下一个卡组的单词 */
  const [switchingPack, setSwitchingPack] = useState(false);

  /**
   * 标题优先跟随「当前卡组」：从背词页继续学习下一个卡组后返回，
   * 列表标题也能同步成新的卡组名。
   */
  const currentSiblingTitle =
    packCursor >= 0 && Number(siblingPacks[packCursor]?.id) === Number(listPackId)
      ? siblingPacks[packCursor].name
      : null;
  const displayTitle = currentSiblingTitle || titleOverride || title;

  // 基础词汇池：source = 'today' 今日学习单词；'pack' 子卡组单词列表；默认全部词库
  const baseWords = useMemo(() => {
    const pool = source === 'today' ? todayWords : source === 'pack' ? packWords : words;
    return pool.filter((w) => {
      if (category && w.cat !== category) return false;
      if (subCategory && w.sub !== subCategory) return false;
      return true;
    });
  }, [category, subCategory, words, todayWords, packWords, source]);

  /**
   * 是否已记住：以服务端卡片 type 为准（type=4 即已记住），
   * 本地刚标记过的单词也要立刻算记住，否则标记后不会移动到底部区域。
   * 本地词库（没有 type）沿用本地学习记录。
   */
  const isMastered = useCallback(
    (w: Word) => w.type === 4 || state.progressMap[w.id]?.status === 'mastered',
    [state.progressMap]
  );

  // 上半部分：未记住（type != 4）；下半部分：已记住（type == 4）
  const { pendingWords, masteredWords } = useMemo(() => {
    const pending: Word[] = [];
    const mastered: Word[] = [];
    for (const w of baseWords) {
      if (isMastered(w)) mastered.push(w);
      else pending.push(w);
    }
    return { pendingWords: pending, masteredWords: mastered };
  }, [baseWords, isMastered]);

  /** 词义记忆模式的研读顺序：未记住在前，已记住在后 */
  const studyWords = useMemo(
    () => [...pendingWords, ...masteredWords],
    [pendingWords, masteredWords]
  );

  /** 当前账号 id：卡组 summary 等缓存要按账号隔离，避免切换账号串内容 */
  const accountId = String((user as any)?.id ?? '');

  /** 拉取「分类词汇辨析」（卡组 summary），带缓存 */
  useEffect(() => {
    const targetId = Number(listPackId || baseWords[0]?.packageId || 0);
    if (!targetId) {
      setPackSummary('');
      return;
    }
    const cacheKey = `${accountId}#${targetId}`;
    const cached = summaryCache.get(cacheKey);
    if (cached !== undefined) {
      setPackSummary(cached);
      return;
    }
    let cancelled = false;
    packLibrary
      .fetchPackDetail(targetId)
      .then((pack) => {
        const summary = String((pack as any)?.summary || '');
        summaryCache.set(cacheKey, summary);
        if (!cancelled) setPackSummary(summary);
      })
      .catch(() => {
        if (!cancelled) setPackSummary('');
      });
    return () => {
      cancelled = true;
    };
  }, [listPackId, baseWords, accountId]);

  /** 进入背诵模式：队列为整个列表，焦点为点击的那个单词 */
  const openStudy = useCallback(
    (startWordId?: number) => {
      const ids = studyWords.map((w) => w.id);
      if (!ids.length) {
        setDialog({ title: '提示', message: '当前列表没有单词', showCancel: false });
        return;
      }
      const packId =
        source === 'today' ? todayWordsPackId : source === 'pack' ? packWordsPackId : undefined;
      navigation.navigate('Flashcard', {
        wordIds: ids,
        startWordId: startWordId ?? ids[0],
        title: displayTitle,
        packId: packId ?? undefined,
        // 背词页「继续学习下一个卡组」要按同样的来源拉取单词
        listSource: source,
      });
    },
    [studyWords, source, todayWordsPackId, packWordsPackId, displayTitle, navigation]
  );

  /**
   * 按父卡组反查兄弟卡组，支持「学习下一个卡组」。
   * 顶层卡组或接口失败时静默降级为不显示该按钮。
   */
  useEffect(() => {
    const currentPackId = Number(listPackId || 0);
    if (!currentPackId) {
      setSiblingPacks([]);
      setPackCursor(-1);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const detail = await packLibrary.fetchPackDetail(currentPackId);
        const parentId = Number((detail as any)?.parent_id || 0);
        if (!parentId) {
          if (!cancelled) {
            setSiblingPacks([]);
            setPackCursor(-1);
          }
          return;
        }
        const { packs } = await packLibrary.fetchSubPacks(parentId, { start: 0, limit: 200 });
        if (cancelled || !packs.length) return;
        setSiblingPacks(packs.map((p) => ({ id: Number(p.id), name: p.name })));
        setPackCursor(packs.findIndex((p) => Number(p.id) === currentPackId));
      } catch {
        // 拿不到兄弟卡组就不提供「学习下一个卡组」
        if (!cancelled) {
          setSiblingPacks([]);
          setPackCursor(-1);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [listPackId]);

  /** 下一个待学习的兄弟卡组 */
  const nextPack: SiblingPack | undefined =
    packCursor >= 0 ? siblingPacks[packCursor + 1] : undefined;

  /**
   * 学习下一个卡组:
   * 依次向后找第一个「还有未记住单词」的卡组，拉取它的单词后原地替换当前列表，
   * 不进入背诵模式，用户继续在列表里挑词学习。
   */
  const handleStudyNextPack = async () => {
    if (switchingPack || packCursor < 0) return;
    setSwitchingPack(true);
    try {
      let cursor = packCursor + 1;
      let target: SiblingPack | null = null;

      while (cursor < siblingPacks.length) {
        const pack = siblingPacks[cursor];
        // 今日学习来源只取今日待学卡片；子卡组来源取整组单词（与打开列表时一致）
        const list =
          source === 'today'
            ? await loadTodayWords(pack.id, {
                start: 0,
                limit: TODAY_WORD_LIMIT,
                types: TODAY_WORD_TYPES,
                cat: topPackName,
                sub: pack.name,
              })
            : await loadPackWordList(pack.id, { cat: topPackName, sub: pack.name });
        if (list.some((w) => !isMastered(w))) {
          target = pack;
          break;
        }
        cursor += 1;
      }

      if (!target) {
        setDialog({
          title: '太棒了',
          message: '后面的卡组都没有待学习的单词了',
          showCancel: false,
        });
        return;
      }

      // 单词已写进 store，列表会原地换成该卡组的数据
      setTitleOverride(target.name);
      showToast(`已切换到「${target.name}」`);
    } catch (e: any) {
      setDialog({
        title: '加载失败',
        message: e?.message || '获取下一个卡组的单词失败，请重试',
        showCancel: false,
      });
    } finally {
      setSwitchingPack(false);
    }
  };

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
   * 非会员免费额度校验（与背词页「明天复习 / 已记住」同一套规则）。
   * - silent：只返回结果、不弹升级弹窗（「从会员页返回」的自动继续判断用）
   * 返回值：null 表示放行；否则为被限制的结果（含 reason/message），
   * 调用方通常应中止并把操作存进 pendingMarkRef。
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

  /**
   * 标记单个单词为已记住：卡片原地变成标签，从点击位置飞进底部「已记住」区域。
   * 先起飞再上报，点击后无等待感；飞行期间底部暂不渲染该标签，落地后淡入。
   */
  const handleMarkMastered = async (word: Word, from: Rect) => {
    const label = viewMode === 'meaning' ? word.meaning || word.word : word.word;

    // 非会员达到免费额度时先拦截，引导升级会员后再继续
    if (await runVipGate()) {
      pendingMarkRef.current = { type: 'single', word, from };
      // 抛错走与上报失败相同的回滚：卡片淡回原位
      throw new Error('VIP_GATE');
    }

    // 底部面板贴着屏幕底边，底边位置恒定，落地前用「底边 - 面板高度」推算出落点
    if (from.width > 0 && from.height > 0) {
      const [panel, origin] = await Promise.all([
        measureInWindow(bottomRef),
        measureInWindow(rootRef),
      ]);
      if (panel && origin) {
        const cnCount = (label.match(/[\u4e00-\u9fa5]/g) || []).length;
        const tagWidth = Math.min(
          Math.max(cnCount * 14 + (label.length - cnCount) * 8 + 40, 56),
          Math.max(panel.width - 28, 56)
        );
        const progress = new Animated.Value(0);
        const item: FlyItem = {
          id: word.id,
          label,
          from,
          to: { x: panel.x + 14, y: panel.y + panel.height - BOTTOM_PANEL_HEIGHT + 36 },
          origin,
          tagWidth,
          progress,
        };
        setFlying((prev) => [...prev, item]);

        Animated.timing(progress, {
          toValue: 1,
          duration: FLY_DURATION,
          easing: Easing.inOut(Easing.cubic),
          useNativeDriver: false,
        }).start(() => {
          // 落地：底部区域淡入真正的标签
          LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
          setFlying((prev) => prev.filter((f) => f.id !== word.id));
        });
      }
    }

    try {
      await recordReview(word.id, 'remembered');
      playRememberedSound();
      // 卡片移出中部列表、底部区域变高时的布局动画
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    } catch (e: any) {
      // 上报失败：撤掉飞行中的标签
      setFlying((prev) => prev.filter((f) => f.id !== word.id));
      setDialog({
        title: '保存失败',
        message: e?.message || '标记已记住失败，请重试',
        showCancel: false,
      });
      throw e;
    }
  };

  /** 加入/取消生词本：加入成功给 Toast，失败弹提示 */
  const handleToggleBookmark = async (wordId: number, wordName?: string) => {
    const wasBookmarked = !!state.progressMap[wordId]?.isBookmarked;
    try {
      await toggleBookmark(wordId, wordName);
      if (!wasBookmarked) showToast('已加入生词本');
    } catch (e: any) {
      setDialog({
        title: '加入生词本失败',
        message: e?.message || '请检查网络后重试',
        showCancel: false,
      });
    }
  };

  /** 全部记住：一次批量请求标记整列表，成功后统一刷新界面 */
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
        'remembered'
      );
      // 单词一次性移到底部「已记住」区域时的布局动画
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setMarkAll({ running: false, total: 0 });
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
    if (!pendingWords.length) {
      setDialog({
        title: '提示',
        message: '当前列表没有未记住的单词',
        showCancel: false,
      });
      return;
    }
    setDialog({
      title: '全部记住',
      message: `将把当前列表 ${pendingWords.length} 个未记住的单词标记为已记住，是否继续？`,
      onConfirm: () => {
        setDialog(null);
        runMarkAll(pendingWords);
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
            await handleMarkMasteredRef.current(pending.word, pending.from);
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

  /** 正在飞行的单词不从底部标签区渲染，避免和飞行中的标签重复 */
  const flyingIds = useMemo(() => new Set(flying.map((f) => f.id)), [flying]);
  const visibleMastered = useMemo(
    () => masteredWords.filter((w) => !flyingIds.has(w.id)),
    [masteredWords, flyingIds]
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.root} ref={rootRef}>
        <Header
          title={displayTitle}
          subtitle={`共 ${baseWords.length} 词 · 已记住 ${masteredWords.length}`}
          onBack={() => navigation.goBack()}
          rightAction={{
            icon: 'play-circle',
            onPress: () => openStudy(),
          }}
        />

        {/* 顶部操作条：左侧视图切换，右侧显示/隐藏词义 + 全部记住 */}
        <View style={styles.topBar}>
          <View style={styles.segmentWrap}>
            {SEGMENTS.map((seg) => {
              const isActive = viewMode === seg.id;
              return (
                <TouchableOpacity
                  key={seg.id}
                  style={[styles.segment, isActive && styles.segmentActive]}
                  onPress={() => setViewMode(seg.id)}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.segmentText, isActive && styles.segmentTextActive]}>
                    {seg.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* 词义开关与全部记住只作用于单词列表，词义记忆模式下隐藏 */}
          {viewMode === 'word' ? (
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
                <Text style={[styles.ghostBtnText, showDetail && styles.ghostBtnTextActive]}>
                  词义
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.primaryBtn, markAll.running && styles.primaryBtnDisabled]}
                onPress={handleMarkAll}
                activeOpacity={0.85}
                disabled={markAll.running}
              >
                {markAll.running ? (
                  <>
                    <ActivityIndicator size="small" color="#FFFFFF" />
                    <Text style={styles.primaryBtnText}>标记中 {markAll.total} 词</Text>
                  </>
                ) : (
                  <Text style={styles.primaryBtnText}>全部记住</Text>
                )}
              </TouchableOpacity>
            </View>
          ) : null}
        </View>

        {viewMode === 'word' ? (
          /* 中部：未记住的单词列表 */
          <View style={styles.middleWrap}>
            <FlatList
              // 切换卡组时重建，列表自动回到顶部
              key={`pending-${listPackId ?? 'all'}`}
              data={pendingWords}
              keyExtractor={(item) => String(item.id)}
              renderItem={({ item }) => (
                <WordRow
                  word={item}
                  mode={viewMode}
                  showDetail={showDetail}
                  accent={state.accent}
                  onPress={() => openStudy(item.id)}
                  onMastered={handleMarkMastered}
                  isBookmarked={!!state.progressMap[item.id]?.isBookmarked}
                  onToggleBookmark={() => handleToggleBookmark(item.id, item.word)}
                />
              )}
              contentContainerStyle={styles.listContent}
              showsVerticalScrollIndicator={false}
              ListEmptyComponent={
                <View style={styles.emptyWrap}>
                  <Ionicons name="checkmark-done-circle" size={56} color={Colors.success} />
                  <Text style={styles.emptyTitle}>全部记住啦</Text>
                  <Text style={styles.emptyText}>当前列表的单词都已标记为已记住</Text>

                  {/* 全部记住后可原地切换到下一个卡组继续学 */}
                  {nextPack ? (
                    <TouchableOpacity
                      style={[styles.nextPackCard, switchingPack && styles.nextPackCardDisabled]}
                      onPress={handleStudyNextPack}
                      activeOpacity={0.85}
                      disabled={switchingPack}
                    >
                      <View style={styles.nextPackIcon}>
                        {switchingPack ? (
                          <ActivityIndicator size="small" color={Colors.primary} />
                        ) : (
                          <Ionicons name="arrow-forward" size={18} color="#FFFFFF" />
                        )}
                      </View>

                      <View style={styles.nextPackBody}>
                        <Text style={styles.nextPackTitle}>
                          {switchingPack ? '正在加载…' : '学习下一个卡组'}
                        </Text>
                        <Text
                          style={styles.nextPackDesc}
                          numberOfLines={1}
                          ellipsizeMode="tail"
                        >
                          下一个 · {nextPack.name}
                        </Text>
                      </View>

                      {!switchingPack ? (
                        <Ionicons name="chevron-forward" size={16} color={Colors.textTertiary} />
                      ) : null}
                    </TouchableOpacity>
                  ) : null}
                </View>
              }
            />
          </View>
        ) : (
          /* 中部：词义记忆 —— 只展示分类词汇辨析 */
          <View style={styles.middleWrap}>
            {packSummary ? (
              <ScrollView
                style={styles.summaryScroll}
                contentContainerStyle={styles.summaryScrollInner}
                showsVerticalScrollIndicator={false}
              >
                <View style={styles.summaryCard}>
                  <SectionBadge
                    icon="library-outline"
                    label="分类词汇辨析"
                    color={Colors.pinwheelBlue}
                  />
                  <RichText
                    text={packSummary}
                    style={styles.studyText}
                    boldStyle={styles.boldStrong}
                  />
                </View>
              </ScrollView>
            ) : (
              <View style={styles.emptyWrap}>
                <Ionicons name="library-outline" size={48} color={Colors.border} />
                <Text style={styles.emptyText}>该分类暂无词汇辨析内容</Text>
              </View>
            )}
          </View>
        )}

        {/* 底部：已记住的单词标签（仅列表模式） */}
        {viewMode === 'word' ? (
          <View
            ref={bottomRef}
            style={[
              styles.bottomPanel,
              masteredWords.length ? { height: BOTTOM_PANEL_HEIGHT } : null,
            ]}
          >
            <View style={styles.bottomHeader}>
              <Ionicons name="checkmark-done" size={14} color={Colors.success} />
              <Text style={styles.bottomTitle}>已记住 {masteredWords.length}</Text>
            </View>

            {visibleMastered.length ? (
              <ScrollView
                style={styles.tagScroll}
                contentContainerStyle={styles.tagWrap}
                showsVerticalScrollIndicator={false}
              >
                {visibleMastered.map((w) => (
                  <TouchableOpacity
                    key={w.id}
                    style={styles.tag}
                    onPress={() => openStudy(w.id)}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="checkmark" size={11} color={Colors.success} />
                    <Text style={styles.tagText} numberOfLines={1}>
                      {w.word}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            ) : (
              <Text style={styles.bottomEmpty}>点单词右侧的对勾，记住的单词会收进这里</Text>
            )}
          </View>
        ) : null}

        {/* 飞行动画层 */}
        {flying.map((item) => (
          <FlyTag key={item.id} item={item} />
        ))}
      </View>

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
  root: {
    flex: 1,
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
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 12,
    backgroundColor: Colors.primary,
  },
  primaryBtnDisabled: {
    opacity: 0.7,
  },
  primaryBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },

  middleWrap: {
    flex: 1,
  },
  listContent: {
    paddingTop: 4,
    paddingBottom: 12,
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
  cardTitleCn: {
    fontSize: 17,
    lineHeight: 24,
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
  bookmarkBtn: {
    backgroundColor: Colors.card,
    borderColor: Colors.border,
  },
  bookmarkBtnActive: {
    backgroundColor: Colors.primaryLight,
    borderColor: Colors.primary + '40',
  },
  checkBtn: {
    backgroundColor: Colors.success + '15',
    borderColor: Colors.success + '55',
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

  /* 词义记忆模式：分类词汇辨析 */
  studyText: {
    fontSize: 13,
    color: Colors.textSecondary,
    lineHeight: 20,
  },
  boldStrong: {
    color: Colors.textPrimary,
  },
  summaryScroll: {
    flex: 1,
  },
  summaryScrollInner: {
    paddingBottom: 20,
  },
  summaryCard: {
    backgroundColor: Colors.primaryLight,
    borderWidth: 1,
    borderColor: Colors.primary + '33',
    borderRadius: 12,
    padding: 12,
    marginHorizontal: 16,
    marginTop: 4,
    marginBottom: 10,
  },

  bottomPanel: {
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    backgroundColor: Colors.card,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 8,
  },
  bottomHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 8,
  },
  bottomTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.textSecondary,
  },
  tagScroll: {
    flex: 1,
  },
  tagWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingBottom: 6,
  },
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    height: TAG_HEIGHT,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: Colors.success + '14',
    borderWidth: 1,
    borderColor: Colors.success + '33',
    maxWidth: '100%',
  },
  tagText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.success,
    flexShrink: 1,
  },
  bottomEmpty: {
    fontSize: 12,
    color: Colors.textMuted,
    marginBottom: 4,
  },
  flyTag: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 4,
  },
  emptyWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 70,
  },
  emptyTitle: {
    marginTop: 12,
    fontSize: 16,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  emptyText: {
    marginTop: 6,
    fontSize: 13,
    color: Colors.textMuted,
  },
  // 全部记住后的「学习下一个卡组」：卡片式入口
  nextPackCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 22,
    width: '84%',
    maxWidth: 320,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 16,
    backgroundColor: Colors.primaryLight,
    borderWidth: 1,
    borderColor: Colors.primary + '2E',
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.14,
    shadowRadius: 14,
    elevation: 4,
  },
  nextPackCardDisabled: {
    opacity: 0.6,
  },
  nextPackIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
    elevation: 3,
  },
  nextPackBody: {
    flex: 1,
    alignItems: 'flex-start',
  },
  nextPackTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  nextPackDesc: {
    marginTop: 3,
    fontSize: 12,
    color: Colors.textMuted,
  },
});
