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
import { Colors } from '../theme/colors';
import { ProgressBar } from '../components/ProgressBar';

/** 生词本「复习待办」一次拉取的数量 */
const NOTEBOOK_REVIEW_LIMIT = 50;

interface HomeScreenProps {
  navigation: any;
}

export const HomeScreen: React.FC<HomeScreenProps> = ({ navigation }) => {
  const {
    stats,
    isLoggedIn,
    user,
    currentPack,
    installedPack,
    setInstalledPack,
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

  /**
   * 我的卡组 (/anki/pack.json, parentId = 0)：
   * 首页只用它算「全部卡组」的总览统计，列表与学习入口在 MyPacks / SubPacks 页。
   */
  const [topPacks, setTopPacks] = useState<RemotePack[]>([]);
  const [loadingPacks, setLoadingPacks] = useState(true);
  // 当前词库仍由全局 store 持有：下级页面（分类卡组 / 背词 / 我的）要用它做词库名
  const selectedTop = currentTopPack;
  const setSelectedTop = setCurrentTopPack;

  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  /** 「今日学习-生词本」卡片数据：学习目标 / 已学习 / 总数量 */
  const [notebook, setNotebook] = useState<NotebookStats | null>(null);
  const [loadingNotebook, setLoadingNotebook] = useState(false);
  /** 生词本复习待办: 学过但还没记住的单词（type = 1/2/3） */
  const [notebookReviewWords, setNotebookReviewWords] = useState<Word[]>([]);
  const [notebookReviewTotal, setNotebookReviewTotal] = useState(0);
  const [loadingNotebookReview, setLoadingNotebookReview] = useState(false);
  /** 「开始背词」正在拉取生词队列 */
  const [startingNotebookStudy, setStartingNotebookStudy] = useState(false);

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
  // 生词本统计请求代次，避免旧结果覆盖新结果
  const notebookReqRef = useRef(0);
  // 生词本复习待办请求代次
  const notebookReviewReqRef = useRef(0);

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
    setNotebook(null);
    setNotebookReviewWords([]);
    setNotebookReviewTotal(0);
    setLoadingNotebook(false);
    setLoadingNotebookReview(false);
    setErrorMsg(null);
    setLastPackName(null);
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

  const reloadAll = useCallback(async () => {
    await loadTopPacks();
  }, [loadTopPacks]);

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
   * 从学习页返回时静默刷新：我的卡组总览统计 + 生词本统计与复习待办，
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
      loadTopPacks();
      loadNotebook();
      loadNotebookReview();
    }, [isLoggedIn, loadTopPacks, loadNotebook, loadNotebookReview])
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
   * 我的卡组总览：全部顶层卡组（parentId = 0）的汇总统计。
   * 首页不再展示某个焦点卡组，也不再列子卡组，只回答
   * 「我有几个卡组、一共多少词、记住了多少」。
   */
  const allPacksStats = useMemo(() => {
    const totalWords = topPacks.reduce((sum, p) => sum + (Number(p.card_count) || 0), 0);
    // 服务端缓存偶发「已记住 > 总数」，按卡组逐个夹取
    const remembered = topPacks.reduce((sum, p) => {
      const total = Number(p.card_count) || 0;
      return sum + Math.max(0, Math.min(total, Number(p.remembered_card_count) || 0));
    }, 0);
    return {
      packCount: topPacks.length,
      totalWords,
      remembered,
      notRemembered: Math.max(0, totalWords - remembered),
      progress: totalWords > 0 ? Math.min(1, remembered / totalWords) : 0,
    };
  }, [topPacks]);

  /** 打开「我的卡组」列表页：在里面挑卡组 → 分类卡组 → 开始学习 */
  const handleOpenMyPacks = () => {
    if (!isLoggedIn) {
      promptLogin();
      return;
    }
    navigation.navigate('MyPacks');
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
   * 我的卡组卡片：全部顶层卡组的汇总统计（不再列子卡组、也不再有焦点卡组）。
   * 卡片整体可点，进「我的卡组」列表页 → 挑卡组 → 分类卡组 → 学习。
   */
  const renderPacksCard = () => (
    <TouchableOpacity style={styles.packsCard} onPress={handleOpenMyPacks} activeOpacity={0.85}>
      {/* 第一行: 标题 + 全部卡组的完成度 */}
      <View style={styles.packsHeader}>
        <View style={styles.packsTitleIcon}>
          <Ionicons name="albums-outline" size={16} color="#FFFFFF" />
        </View>
        <View style={styles.packsTitleWrap}>
          <Text style={styles.packsTitle} numberOfLines={1}>
            我的卡组
          </Text>
          <Text style={styles.packsSubtitle} numberOfLines={1}>
            {allPacksStats.packCount > 0
              ? `共 ${allPacksStats.packCount} 个卡组 · 已记住 ${allPacksStats.remembered}/${allPacksStats.totalWords} 词`
              : '还没有卡组'}
          </Text>
        </View>
        <View style={styles.packsPercentBadge}>
          <Text style={styles.packsPercentText}>{Math.round(allPacksStats.progress * 100)}%</Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color={Colors.textMuted} />
      </View>

      {/* 全部卡组的已记住 / 未记住 单词数 */}
      <View style={styles.packsProgressTrack}>
        <ProgressBar progress={allPacksStats.progress} height={8} color={Colors.success} />
      </View>
      <View style={styles.packsProgressMeta}>
        <Text style={styles.packsProgressText}>
          已记住 <Text style={styles.packsProgressStrong}>{allPacksStats.remembered}</Text> 词
        </Text>
        <Text style={styles.packsProgressText}>
          未记住 <Text style={styles.packsProgressStrong}>{allPacksStats.notRemembered}</Text> 词
        </Text>
      </View>

      {/* 加载 / 错误 / 空态 / 入口 */}
      {authLoading || loadingPacks ? (
        <View style={styles.centerPadding}>
          <ActivityIndicator size="small" color={Colors.primary} />
          <Text style={styles.loadingText}>正在加载卡组...</Text>
        </View>
      ) : errorMsg ? (
        <View style={styles.packsEmptyWrap}>
          <Text style={styles.emptyText}>{errorMsg}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={reloadAll} activeOpacity={0.8}>
            <Text style={styles.retryText}>重试</Text>
          </TouchableOpacity>
        </View>
      ) : topPacks.length === 0 ? (
        <View style={styles.packsEmptyWrap}>
          <Ionicons name="albums-outline" size={34} color={Colors.border} />
          <Text style={styles.emptyText}>还没有卡组，去卡组市场添加分类背单词卡组</Text>
          <TouchableOpacity
            style={styles.retryBtn}
            onPress={() => navigation.navigate('Market', { firstSetup: true })}
            activeOpacity={0.8}
          >
            <Text style={styles.retryText}>去卡组市场</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.packsFooterRow}>
          <Text style={styles.packsFooterHint}>查看全部卡组，挑一个开始学习</Text>
          <Ionicons name="arrow-forward" size={13} color={Colors.primary} />
        </View>
      )}
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" backgroundColor={Colors.background} />

      {/* 固定顶部标题栏 */}
      {renderTopBar()}

      <ScrollView
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
  // 分类卡组行（分类卡组列表页用）：底色按分类识别色做极淡 tint
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
  // 我的卡组卡片内的空态 / 错误态（比整屏空态更紧凑）
  packsEmptyWrap: {
    alignItems: 'center',
    paddingTop: 12,
    paddingBottom: 4,
  },
  packsFooterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingTop: 12,
  },
  packsFooterHint: {
    fontSize: 12,
    color: Colors.primary,
    fontWeight: '600',
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
