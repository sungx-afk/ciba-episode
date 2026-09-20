import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  ScrollView,
  StatusBar,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useProgress } from '../storage/progressStore';
import { useAuth } from '../context/AuthContext';
import { packLibrary } from '../services/packLibrary';
import { Word } from '../types';
import { Colors } from '../theme/colors';
import { pronounceWord } from '../utils/speech';
import { showToast } from '../utils/toast';
import { getWordExtras } from '../utils/wordExtras';
import { playRememberedSound } from '../utils/effectSound';
import { Header } from '../components/Header';
import { RichText } from '../components/RichText';
import { ConfirmDialog, DialogPayload } from '../components/ConfirmDialog';
import { checkVipGate, clearVipGateCache } from '../services/vipGate';

/** 今日学习单词一次拉取的数量（与首页保持一致） */
const TODAY_WORD_LIMIT = 50;
/** learn-by-menu 的卡片状态过滤：0 未学 / 1、2、3 学习中（已记住 4 不再出现） */
const TODAY_WORD_TYPES = [0, 1, 2, 3];

/** 同一父卡组下的兄弟卡组（用于「继续学习下一个卡组」） */
interface SiblingPack {
  id: number;
  name: string;
}

interface FlashcardScreenProps {
  route: any;
  navigation: any;
}

export const FlashcardScreen: React.FC<FlashcardScreenProps> = ({ route, navigation }) => {
  const {
    category,
    subCategory,
    singleWordId,
    onlyDue,
    filter,
    wordIds,
    startWordId,
    queueWords,
    title,
    packCat,
    packId,
    packQueue,
    packIndex,
    hasMorePacks: hasMorePacksParam,
    listSource,
  } = route.params || {};
  const {
    state,
    stats,
    recordReview,
    toggleBookmark,
    words,
    todayWords,
    packWords,
    loadTodayWords,
    loadPackWordList,
    currentTopPack,
  } = useProgress();
  // 会员状态与注册时间都来自用户信息
  const { user, refreshUserInfo } = useAuth();

  /** 顶层卡组名: 继续学习下一个卡组时，作为新单词的 cat 标记 */
  const topPackName = packCat || currentTopPack?.name || '';

  /** 路由直接带过来的兄弟卡组列表（首页「开始背词」） */
  const paramQueue: SiblingPack[] = Array.isArray(packQueue) ? packQueue : [];
  /** 兄弟卡组列表: 用于「继续学习下一个卡组」 */
  const [siblingPacks, setSiblingPacks] = useState<SiblingPack[]>(paramQueue);
  /** 当前学习的是第几个兄弟卡组 */
  const [packCursor, setPackCursor] = useState<number>(
    typeof packIndex === 'number' && paramQueue.length ? packIndex : -1
  );
  /** 当前卡组名（继续学习下一个卡组时会更新） */
  const [sessionTitle, setSessionTitle] = useState<string | undefined>(title);
  /**
   * 直接使用的单词队列（最高优先级）:
   * 1. 首页「复习待办」等入口通过 queueWords 传入
   * 2. 「继续学习下一个卡组」时由下一个卡组拉取
   */
  const [queueOverride, setQueueOverride] = useState<Word[] | null>(
    Array.isArray(queueWords) && queueWords.length ? queueWords : null
  );
  const [switchingPack, setSwitchingPack] = useState(false);

  /**
   * 路由没带兄弟卡组（如从「单词列表」进入）时，按 packId 反查父卡组下的兄弟列表，
   * 以便学完后也能继续学习下一个卡组。失败则静默降级为不显示该按钮。
   */
  useEffect(() => {
    if (paramQueue.length || !packId) return;
    const currentPackId = Number(packId);
    if (!currentPackId) return;
    let cancelled = false;
    (async () => {
      try {
        const detail = await packLibrary.fetchPackDetail(currentPackId);
        const parentId = detail?.parent_id;
        if (!parentId) return;
        const { packs } = await packLibrary.fetchSubPacks(parentId, { start: 0, limit: 200 });
        if (cancelled || !packs.length) return;
        const index = packs.findIndex((p) => Number(p.id) === currentPackId);
        setSiblingPacks(packs.map((p) => ({ id: p.id, name: p.name })));
        setPackCursor(index);
      } catch {
        // 拿不到兄弟卡组就不提供「继续学习下一个卡组」
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [paramQueue.length, packId]);

  // 构建当前复习/学习单词队列
  const rawQueue: Word[] = useMemo(() => {
    // 在成果页「继续学习下一个卡组」时，队列已由下一个卡组直接给出
    if (queueOverride && queueOverride.length) return queueOverride;

    // 今日学习单词 / 子卡组单词列表 (learn-by-menu 拉取的卡片)
    if (wordIds && wordIds.length) {
      const pool = new Map<number, Word>();
      for (const w of todayWords) pool.set(w.id, w);
      for (const w of packWords) {
        if (!pool.has(w.id)) pool.set(w.id, w);
      }
      for (const w of words) {
        if (!pool.has(w.id)) pool.set(w.id, w);
      }
      const ids: number[] = Array.isArray(wordIds) ? wordIds : [];
      const queue: Word[] = [];
      for (const id of ids) {
        const w = pool.get(id);
        if (w) queue.push(w);
      }
      return queue;
    }

    if (singleWordId) {
      const single =
        words.find((w) => w.id === singleWordId) ||
        todayWords.find((w) => w.id === singleWordId) ||
        packWords.find((w) => w.id === singleWordId);
      return single ? [single] : [];
    }

    const now = Date.now();

    return words.filter((w) => {
      if (category && w.cat !== category) return false;
      if (subCategory && w.sub !== subCategory) return false;

      const p = state.progressMap[w.id];

      if (onlyDue) {
        return p && p.nextReviewTime > 0 && p.nextReviewTime <= now;
      }

      if (filter === 'mastered') {
        return p?.status === 'mastered';
      }
      if (filter === 'unlearned') {
        return p?.status !== 'mastered';
      }

      return true;
    });
  }, [
    queueOverride,
    category,
    subCategory,
    singleWordId,
    onlyDue,
    filter,
    state.progressMap,
    words,
    todayWords,
    packWords,
    wordIds,
  ]);

  /**
   * 排序: 未记住(未掌握)的单词优先，已记住(已掌握)的单词放到最后。
   * 使用稳定排序，保证同组内维持原有顺序。
   */
  const orderedQueue: Word[] = useMemo(() => {
    // 与单词列表页一致：服务端 type=4 也算已记住，避免两处判断不一致
    const isMastered = (w: Word) =>
      w.type === 4 || state.progressMap[w.id]?.status === 'mastered' ? 1 : 0;
    return rawQueue
      .map((w, index) => ({ w, index, mastered: isMastered(w) }))
      .sort((a, b) => a.mastered - b.mastered || a.index - b.index)
      .map((item) => item.w);
  }, [rawQueue, state.progressMap]);

  /**
   * 会话队列: 进入页面时按「未记住优先」排定顺序后锁定，
   * 避免学习中评分导致队列重排、索引错乱或已学单词再次出现。
   */
  const lockedOrderRef = useRef<number[] | null>(null);
  const studyQueue: Word[] = useMemo(() => {
    if (!orderedQueue.length) return orderedQueue;
    if (!lockedOrderRef.current) {
      lockedOrderRef.current = orderedQueue.map((w) => w.id);
    }
    const byId = new Map(orderedQueue.map((w) => [w.id, w]));
    const list: Word[] = [];
    for (const id of lockedOrderRef.current) {
      const w = byId.get(id);
      if (w) list.push(w);
    }
    return list;
  }, [orderedQueue]);

  /** 初始位置：列表页点的是哪个单词，就从这个单词开始背 */
  const [currentIndex, setCurrentIndex] = useState(() => {
    const idx = startWordId ? studyQueue.findIndex((w) => w.id === startWordId) : -1;
    return idx > 0 ? idx : 0;
  });
  const [sessionCompleted, setSessionCompleted] = useState(false);
  const [learnedInSessionCount, setLearnedInSessionCount] = useState(0);
  // 正在上报本次评分，避免连点导致跳过多张卡片
  const [grading, setGrading] = useState(false);
  /** 被会员限制拦截下来的评分，开通会员后自动继续 */
  const pendingGradeRef = useRef<'hard' | 'remembered' | null>(null);
  /** 需要升级会员时的提示文案（非空即弹窗） */
  const [vipGateMessage, setVipGateMessage] = useState<string | null>(null);
  /** 统一弹窗状态：确认/提示一律走 ConfirmDialog，不再使用系统 Alert */
  const [dialog, setDialog] = useState<DialogPayload | null>(null);

  const currentWord = studyQueue[currentIndex];
  const isBookmarked = currentWord
    ? state.progressMap[currentWord.id]?.isBookmarked || false
    : false;

  /** 单词深度解析：音标 / 词义辨析 / 巧记联想 / 场景例句 */
  const extras = useMemo(
    () =>
      currentWord
        ? getWordExtras(currentWord)
        : { phonetic: '', wordDifference: '', memoryMethod: '', sentences: [] },
    [currentWord]
  );

  /** 词包级「分类词汇辨析」：取自卡组详情 summary */
  const [packSummary, setPackSummary] = useState('');
  useEffect(() => {
    const targetId = Number(packId || currentWord?.packageId || 0);
    if (!targetId) {
      setPackSummary('');
      return;
    }
    // 已加载过的顶层卡组就不再单独请求
    if (Number((currentTopPack as any)?.id) === targetId) {
      setPackSummary(String((currentTopPack as any)?.summary || ''));
      return;
    }
    let cancelled = false;
    packLibrary
      .fetchPackDetail(targetId)
      .then((pack) => {
        if (!cancelled) setPackSummary(String((pack as any)?.summary || ''));
      })
      .catch(() => {
        if (!cancelled) setPackSummary('');
      });
    return () => {
      cancelled = true;
    };
  }, [packId, currentWord?.packageId, currentTopPack]);

  /** 辨析正文：与 web 背诵页一致，数字条目 / <b> 先拆行再渲染 */
  const packSummaryText = useMemo(() => formatPackSummary(packSummary), [packSummary]);

  /** 加入/取消生词本：加入会调服务端 /anki/movie2card，失败时不改本地状态 */
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

  // 切换到新词时，按设置自动发音
  useEffect(() => {
    if (currentWord && state.autoPronounce && !sessionCompleted) {
      pronounceWord(currentWord.word, {
        accent: state.accent,
        rate: state.speechRate,
      });
    }
  }, [currentIndex, sessionCompleted]);

  /**
   * 处理评分并翻到下一张卡片
   * - hard        -> 服务端 type=1，间隔 1 天（「明天复习」）
   * - remembered  -> 服务端 type=4，直接标记为已记住
   */
  const handleGrade = async (grade: 'hard' | 'remembered') => {
    if (!currentWord || grading) return;
    setGrading(true);
    try {
      // 非会员达到免费额度时先拦截，引导升级会员后再继续
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

      await recordReview(currentWord.id, grade);
      if (grade === 'remembered') playRememberedSound();
      setLearnedInSessionCount((prev) => prev + 1);

      if (currentIndex + 1 < studyQueue.length) {
        setCurrentIndex((prev) => prev + 1);
      } else {
        setSessionCompleted(true);
      }
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
   * 已开通会员就自动继续刚才被拦截的「明天复习 / 已记住」。
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
        showToast('会员已开通，继续学习');
        handleGradeRef.current(pending);
      })();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user, stats.masteredCount])
  );

  const handleManualPronounce = () => {
    if (currentWord) {
      pronounceWord(currentWord.word, {
        accent: state.accent,
        rate: state.speechRate,
      });
    }
  };

  /** 是否由首页带着兄弟卡组列表进入（只有这种场景才提供「继续学习下一个卡组」） */
  const hasPackContext = siblingPacks.length > 0 && packCursor >= 0;
  const nextPack: SiblingPack | undefined = hasPackContext
    ? siblingPacks[packCursor + 1]
    : undefined;
  /** 列表还有未加载的兄弟卡组（分页），此时最后一个不等于真的没有了 */
  const hasMorePacks = hasPackContext && !!hasMorePacksParam;

  /**
   * 继续学习下一个卡组:
   * 依次向后查找第一个「今日有单词」的子卡组，直接切换队列继续学习。
   */
  const handleContinueNextPack = async () => {
    if (switchingPack || !hasPackContext) return;
    setSwitchingPack(true);
    try {
      let cursor = packCursor + 1;
      let target: { pack: SiblingPack; words: Word[] } | null = null;

      // 单词列表（子卡组）来源取整组单词；其它场景取今日待学卡片
      const fromPackList = listSource === 'pack';

      while (cursor < siblingPacks.length) {
        const pack = siblingPacks[cursor];
        const list = fromPackList
          ? await loadPackWordList(pack.id, { cat: topPackName, sub: pack.name || '' })
          : await loadTodayWords(pack.id, {
              start: 0,
              limit: TODAY_WORD_LIMIT,
              types: TODAY_WORD_TYPES,
              cat: topPackName,
              sub: pack.name || '',
            });
        // 整组单词里可能全是已记住的，这种卡组直接跳过
        const learnable = fromPackList
          ? list.some((w) => w.type !== 4 && state.progressMap[w.id]?.status !== 'mastered')
          : list.length > 0;
        if (learnable) {
          target = { pack, words: list };
          break;
        }
        cursor += 1;
      }

      if (!target) {
        setPackCursor(siblingPacks.length); // 标记已到末尾，按钮转为提示
        setDialog({
          title: '太棒了',
          message:
            listSource === 'pack'
              ? '后面的卡组都没有待学习的单词'
              : '后面的卡组今日都没有待学习的单词',
          showCancel: false,
        });
        return;
      }

      // 重置会话: 解锁排序、换队列、回到第一张卡片
      lockedOrderRef.current = null;
      setQueueOverride(target.words);
      setPackCursor(cursor);
      setSessionTitle(target.pack.name);
      setCurrentIndex(0);
      setLearnedInSessionCount(0);
      setSessionCompleted(false);
    } catch (e: any) {
      setDialog({
        title: '加载失败',
        message: e?.message || '获取下一个卡组失败',
        showCancel: false,
      });
    } finally {
      setSwitchingPack(false);
    }
  };

  if (!studyQueue.length) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <Header title="闪卡背词" onBack={() => navigation.goBack()} />
        <View style={styles.emptyContainer}>
          <Ionicons name="checkmark-circle-outline" size={64} color={Colors.success} />
          <Text style={styles.emptyTitle}>暂无待学习的单词</Text>
          <Text style={styles.emptySubtitle}>太棒了！当前分类下的单词已全部复习完毕</Text>
          <TouchableOpacity
            style={styles.returnBtn}
            onPress={() => navigation.goBack()}
            activeOpacity={0.8}
          >
            <Text style={styles.returnBtnText}>返回上一页</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // 学习完成界面
  if (sessionCompleted) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <Header title="学习成果" onBack={() => navigation.goBack()} />
        <View style={styles.completeWrap}>
          <View style={styles.trophyCircle}>
            <Ionicons name="trophy" size={56} color={Colors.gold} />
          </View>
          <Text style={styles.completeTitle}>恭喜完成本次学习！</Text>
          <Text style={styles.completeSubtitle}>
            本次共学习复习了 <Text style={styles.highlightText}>{learnedInSessionCount}</Text> 个单词
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

          {/* 有下一个子卡组: 直接继续学习；已到末尾: 只给提示 */}
          {nextPack ? (
            <TouchableOpacity
              style={[styles.continueBtn, switchingPack && styles.continueBtnDisabled]}
              onPress={handleContinueNextPack}
              activeOpacity={0.85}
              disabled={switchingPack}
            >
              {switchingPack ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Ionicons name="arrow-forward-circle" size={22} color="#FFFFFF" />
              )}
              <View style={styles.continueBtnTextWrap}>
                <Text style={styles.continueBtnText}>继续学习下一个卡组</Text>
                <Text style={styles.continueBtnSub} numberOfLines={1} ellipsizeMode="tail">
                  {nextPack.name}
                </Text>
              </View>
            </TouchableOpacity>
          ) : hasPackContext ? (
            <View style={styles.packEndHint}>
              <Ionicons
                name={hasMorePacks ? 'ellipsis-horizontal-circle-outline' : 'flag-outline'}
                size={15}
                color={Colors.textMuted}
              />
              <Text style={styles.packEndHintText}>
                {hasMorePacks
                  ? '本页卡组已学完，返回列表可继续学习更多卡组'
                  : '已经是最后一个卡组啦，全部完成！'}
              </Text>
            </View>
          ) : null}

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

  /** 词头音标：服务端给的可能是「pruːv」这种裸音标，统一补上斜杠 */
  const phoneticText = extras.phonetic
    ? extras.phonetic.startsWith('/') || extras.phonetic.startsWith('[')
      ? extras.phonetic
      : `/${extras.phonetic}/`
    : '';

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" backgroundColor={Colors.card} />

      {/* 顶部：单词 + 学习进度（与 web 背诵页一致的一行式标题） */}
      <Header
        title={`单词 ${currentIndex + 1} / ${studyQueue.length}`}
        onBack={() => navigation.goBack()}
        rightAction={{
          icon: isBookmarked ? 'bookmark' : 'bookmark-outline',
          onPress: () => handleToggleBookmark(currentWord.id, currentWord.word),
        }}
      />

      {/* 固定词头：单词 / 音标 / 发音，不随内容滚动 */}
      <View style={styles.wordHead}>
        <Text style={styles.mainWordText}>{currentWord.word}</Text>
        {phoneticText ? <Text style={styles.wordPhonetic}>{phoneticText}</Text> : null}
        <TouchableOpacity
          style={styles.soundButton}
          onPress={handleManualPronounce}
          activeOpacity={0.7}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="volume-medium-outline" size={22} color={Colors.primary} />
        </TouchableOpacity>
      </View>

      <View style={styles.hairline} />

      <ScrollView
        style={styles.contentScroll}
        contentContainerStyle={styles.scrollInner}
        showsVerticalScrollIndicator={false}
      >
        {/* 中文释义 */}
        {currentWord.meaning ? (
          <View style={styles.sectionBlock}>
            <RichText text={currentWord.meaning} style={styles.textMeaning} />
          </View>
        ) : null}

        {/* 词义辨析 */}
        {extras.wordDifference ? (
          <View style={[styles.sectionBlock, styles.sectionBlockDivider]}>
            <Text style={styles.sectionLabel}>词义辨析：</Text>
            <RichText
              text={extras.wordDifference}
              style={styles.textContent}
              boldStyle={styles.boldStrong}
            />
          </View>
        ) : null}

        {/* 记忆方法 */}
        {extras.memoryMethod ? (
          <View style={[styles.sectionBlock, styles.sectionBlockDivider]}>
            <Text style={styles.sectionLabel}>记忆方法：</Text>
            <RichText
              text={extras.memoryMethod}
              style={styles.textContent}
              boldStyle={styles.boldStrong}
            />
          </View>
        ) : null}

        {/* 例句 */}
        {extras.sentences.length ? (
          <View style={[styles.sectionBlock, styles.sectionBlockDivider]}>
            <Text style={styles.sectionLabel}>例句：</Text>
            {extras.sentences.map((s, idx) => (
              <View key={idx} style={styles.sentenceItem}>
                {s.english ? (
                  <RichText
                    text={s.english}
                    style={styles.enSentence}
                    boldStyle={styles.boldStrong}
                  />
                ) : null}
                {s.chinese ? <RichText text={s.chinese} style={styles.cnSentence} /> : null}
              </View>
            ))}
          </View>
        ) : null}

        {/* 分类词汇辨析（卡组级内容）：样式对齐 web 背诵页 Review.vue 的 pack-summary-wrapper */}
        {packSummary ? (
          <View style={styles.summaryCard}>
            <Text style={styles.summaryTitle}>分类词汇辨析</Text>
            <RichText
              text={packSummaryText}
              style={styles.summaryText}
              boldStyle={styles.boldStrong}
            />
          </View>
        ) : null}

        {/* 兜底：没有任何结构化信息时仍显示原始 note */}
        {!extras.wordDifference &&
        !extras.memoryMethod &&
        !extras.sentences.length &&
        currentWord.note ? (
          <View style={[styles.sectionBlock, styles.sectionBlockDivider]}>
            <RichText text={currentWord.note} style={styles.textContent} />
          </View>
        ) : null}
      </ScrollView>

      {/* 底部操作栏: 返回 / 明天复习(type=1) / 已记住(type=4) */}
      <View style={styles.bottomBar}>
        <TouchableOpacity
          style={[styles.actionBtn, styles.backAction]}
          onPress={() => navigation.goBack()}
          activeOpacity={0.85}
        >
          <Text style={[styles.actionBtnText, styles.backActionText]}>返回</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.actionBtn, styles.tomorrowAction, grading && styles.actionBtnDisabled]}
          onPress={() => handleGrade('hard')}
          activeOpacity={0.85}
          disabled={grading}
        >
          <Text style={[styles.actionBtnText, styles.tomorrowActionText]}>明天复习</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.actionBtn, styles.rememberAction, grading && styles.actionBtnDisabled]}
          onPress={() => handleGrade('remembered')}
          activeOpacity={0.85}
          disabled={grading}
        >
          {grading ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Text style={[styles.actionBtnText, styles.rememberActionText]}>已记住</Text>
          )}
        </TouchableOpacity>
      </View>

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

/**
 * 「分类词汇辨析」正文预处理，与 web 背诵页 Review.vue 的 formatText 保持一致：
 * 数字条目与 <b> 前后补换行，去掉多余空行（<br> / <p> 由其后的 RichText 继续处理）。
 */
function formatPackSummary(raw: string): string {
  if (!raw) return '';
  return String(raw)
    .replace(/(\d+\.)/g, '\n$1')
    .replace(/(<b>)/g, '\n$1')
    .replace(/(<\/b>)/g, '$1\n')
    .replace(/\n+/g, '\n')
    .trim();
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Colors.card,
  },
  contentScroll: {
    flex: 1,
    backgroundColor: Colors.card,
  },
  // 内容较多时从顶部排布，整页白底、不再套卡片
  scrollInner: {
    paddingBottom: 24,
    flexGrow: 1,
    justifyContent: 'flex-start',
  },
  // 固定词头：单词 / 音标 / 发音图标居中，滚动时保持不动
  wordHead: {
    alignItems: 'center',
    flexShrink: 0,
    backgroundColor: Colors.card,
    paddingHorizontal: 16,
    paddingTop: 18,
    paddingBottom: 14,
  },
  mainWordText: {
    fontSize: 32,
    fontWeight: '700',
    color: Colors.textPrimary,
    textAlign: 'center',
    letterSpacing: 0.3,
  },
  wordPhonetic: {
    fontSize: 14,
    color: Colors.textTertiary,
    textAlign: 'center',
    marginTop: 8,
  },
  soundButton: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
    padding: 4,
  },
  // 全宽细分隔线（贴边，与 web 背诵页一致）
  hairline: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: Colors.divider,
  },
  sectionBlock: {
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  sectionBlockDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.divider,
  },
  // 分区标题：「词义辨析：」「记忆方法：」「例句：」单独一行
  sectionLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginBottom: 8,
  },
  textMeaning: {
    fontSize: 15,
    fontWeight: '500',
    color: Colors.textSecondary,
    lineHeight: 24,
  },
  textContent: {
    fontSize: 14,
    color: Colors.textSecondary,
    lineHeight: 23,
  },
  /** <b> 提升为加粗标题行时的强调色 */
  boldStrong: {
    color: Colors.textPrimary,
  },
  // 分类词汇辨析：浅底卡片 + 居中标题，对齐 web 背诵页 Review.vue
  summaryCard: {
    backgroundColor: Colors.backgroundAlt,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 12,
    padding: 14,
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 4,
  },
  summaryTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.textPrimary,
    textAlign: 'center',
    marginBottom: 8,
  },
  summaryText: {
    fontSize: 13,
    color: Colors.textSecondary,
    lineHeight: 23,
  },
  sentenceItem: {
    marginBottom: 12,
  },
  enSentence: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textPrimary,
    lineHeight: 21,
  },
  cnSentence: {
    fontSize: 13,
    color: Colors.textTertiary,
    lineHeight: 20,
    marginTop: 3,
  },
  // 底部三个操作按钮: 返回 / 明天复习(type=1) / 已记住(type=4)，平铺无圆角
  bottomBar: {
    flexDirection: 'row',
    backgroundColor: Colors.card,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border,
  },
  actionBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
  },
  actionBtnDisabled: {
    opacity: 0.6,
  },
  actionBtnText: {
    fontSize: 16,
    fontWeight: '700',
  },
  backAction: {
    flex: 1,
    backgroundColor: Colors.backgroundAlt,
  },
  backActionText: {
    color: Colors.textSecondary,
  },
  // 「还没掌握，明天再来」= 待办提醒，用鎏金（与 Profile「待复习」同语义色），
  // 与右侧苍绿的「已记住」形成色相 + 明度双重差异
  tomorrowAction: {
    flex: 1.5,
    backgroundColor: Colors.warningDeep,
  },
  tomorrowActionText: {
    color: '#FFFFFF',
  },
  // 主推动作：全页唯一的实心深绿，视觉最重
  rememberAction: {
    flex: 1.5,
    backgroundColor: Colors.primary,
  },
  rememberActionText: {
    color: '#FFFFFF',
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
    marginTop: 8,
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
  // 继续学习下一个卡组
  continueBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    width: '100%',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 14,
    backgroundColor: Colors.success,
    marginBottom: 12,
  },
  continueBtnDisabled: {
    opacity: 0.7,
  },
  continueBtnTextWrap: {
    flexShrink: 1,
    alignItems: 'flex-start',
  },
  continueBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  continueBtnSub: {
    color: '#FFFFFF',
    fontSize: 12,
    opacity: 0.9,
    marginTop: 2,
  },
  packEndHint: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginBottom: 12,
    paddingHorizontal: 12,
  },
  packEndHintText: {
    flexShrink: 1,
    fontSize: 13,
    color: Colors.textMuted,
    textAlign: 'center',
  },

  doneBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
});
