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
import { fetchNotebookStats, NotebookStats } from '../services/bookmarkApi';
import { Colors } from '../theme/colors';
import { ProgressBar } from '../components/ProgressBar';

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
    setLoadingNotebook(false);
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

  /** 登录态/账号变化后刷新生词本数据；未登录时清空，避免串账号 */
  useEffect(() => {
    if (authLoading) return;
    if (!isLoggedIn) {
      notebookReqRef.current += 1;
      setNotebook(null);
      setLoadingNotebook(false);
      return;
    }
    loadNotebook();
  }, [authLoading, isLoggedIn, (user as any)?.id, loadNotebook]);

  /**
   * 从学习页返回时静默刷新：我的卡组总览统计 + 生词本统计，
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
    }, [isLoggedIn, loadTopPacks, loadNotebook])
  );

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

  /**
   * 顶部头图区：淡彩水墨山水打底，头像/昵称/会员一眼可见，
   * 下面压一句 slogan 与连续学习天数，收在一条细线里。
   * 整块跟随页面滚动（不再固定在顶部），首屏更像一张「宣纸封面」。
   */
  const renderHero = () => (
    <View style={styles.hero}>
      <Image
        source={require('../assets/header-ink.jpg')}
        style={styles.heroBg}
        resizeMode="cover"
      />
      {/* 极淡的米白柔光：压住背景、托亮文字，也顺手柔化图片边缘 */}
      <View style={styles.heroVeil} pointerEvents="none" />

      {authLoading ? (
        <View style={styles.heroLoading}>
          <ActivityIndicator size="small" color={Colors.primaryDark} />
          <Text style={styles.heroLoadingText}>正在读取登录状态…</Text>
        </View>
      ) : (
        <View style={styles.heroTopRow}>
          <TouchableOpacity
            style={styles.heroUser}
            activeOpacity={0.85}
            onPress={handleOpenProfile}
          >
            <View style={[styles.heroAvatar, isVip && styles.heroAvatarVip]}>
              <Ionicons
                name={isLoggedIn ? 'person' : 'log-in-outline'}
                size={24}
                color={isVip ? Colors.gold : Colors.primary}
              />
            </View>
            <View style={styles.heroUserText}>
              <View style={styles.heroNameRow}>
                <Text style={styles.heroName} numberOfLines={1}>
                  {displayName}
                </Text>
                {isLoggedIn ? (
                  <TouchableOpacity
                    style={[styles.vipTag, isVip ? styles.vipTagActive : styles.vipTagUpgrade]}
                    onPress={() => navigation.navigate('Purchase')}
                    activeOpacity={0.85}
                  >
                    <Ionicons
                      name={isVip ? 'diamond' : 'diamond-outline'}
                      size={11}
                      color={isVip ? Colors.textPrimary : Colors.gold}
                    />
                    <Text style={[styles.vipTagText, isVip && styles.vipTagTextActive]}>
                      {isVip ? 'VIP 会员' : '升级会员'}
                    </Text>
                  </TouchableOpacity>
                ) : null}
              </View>
              <Text style={styles.heroUserSub} numberOfLines={1}>
                {isLoggedIn
                  ? authUser?.mobile
                    ? `已登录 · ${maskMobile(authUser.mobile)}`
                    : '已登录'
                  : '登录后可同步词书与多端学习进度'}
              </Text>
            </View>
          </TouchableOpacity>

          <View style={styles.heroActions}>
            {/* 卡组市场：挑新的分类背单词卡组 */}
            <TouchableOpacity
              style={styles.heroIconBtn}
              onPress={handleOpenMarket}
              activeOpacity={0.8}
              accessibilityLabel="卡组市场"
            >
              <Ionicons name="compass-outline" size={18} color={Colors.primaryDark} />
            </TouchableOpacity>
            {/* 设置：进「我的」；未登录时先去登录 */}
            <TouchableOpacity
              style={styles.heroIconBtn}
              onPress={handleOpenProfile}
              activeOpacity={0.8}
              accessibilityLabel="我的"
            >
              <Ionicons name="settings-outline" size={18} color={Colors.primaryDark} />
            </TouchableOpacity>
          </View>
        </View>
      )}

      <View style={styles.heroSloganRow}>
        <Text style={styles.heroSlogan} numberOfLines={1}>
          语言是通往更大世界的门。
        </Text>
        <View style={styles.heroStreak}>
          <Ionicons name="flame" size={13} color={Colors.accent} />
          <Text style={styles.heroStreakText}>{stats.streakDays} 天</Text>
        </View>
      </View>
      <View style={styles.heroRule} />
    </View>
  );

  /** 提示卡：电脑端 Chrome 插件用法（边看剧边攒生词） */
  const renderTipCard = () => (
    <TouchableOpacity style={styles.tipCard} onPress={handleOpenSite} activeOpacity={0.9}>
      <View style={styles.tipHeader}>
        <View style={styles.tipTitleRow}>
          <Ionicons name="bulb" size={15} color={Colors.accent} />
          <Text style={styles.tipTitle}>边看美剧，边擦生词</Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color={Colors.textMuted} />
      </View>
      <Text style={styles.tipText}>
        电脑访问 <Text style={styles.tipLink}>www.cibaen.com</Text>{' '}
        安装 Chrome 浏览器插件后，即可在爱奇艺、B 站观看带字幕的视频时，边看视频边添加英文生词。然后在手机上碎片时间记忆单词。
      </Text>
    </TouchableOpacity>
  );

  /** 页脚：一句短引 + 快速开始学习入口 */
  const renderQuoteFooter = () => (
    <View style={styles.quoteWrap}>
      <Ionicons name="leaf-outline" size={38} color="rgba(27,75,63,0.14)" />
      <View style={styles.quoteTextWrap}>
        <Text style={styles.quoteEn} numberOfLines={1}>
          The best time to start is now.
        </Text>
        <Text style={styles.quoteCn} numberOfLines={1}>
          最好的开始，就是现在。
        </Text>
      </View>
      <TouchableOpacity
        style={styles.quoteBtn}
        onPress={handleOpenBookmarks}
        activeOpacity={0.85}
      >
        <Ionicons name="play" size={13} color="#FFFFFF" />
        <Text style={styles.quoteBtnText}>开始学习</Text>
      </TouchableOpacity>
    </View>
  );

  /** 生词本指标: 学习目标 / 已学习 / 总数量，一行三列、竖线分隔 */
  const renderNotebookMetric = (label: string, value: number | string, accent: string) => (
    <View style={styles.metricItem}>
      <Text style={[styles.metricValue, { color: accent }]} numberOfLines={1}>
        {value}
      </Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );

  /**
   * 生词本卡片：标题行 + 三格指标 + 主色实心入口按钮，整卡点击进入生词本。
   * 三格指标只回答「今天要背多少、已经背了多少、本子一共多少」。
   */
  const renderDashboardCard = () => {
    const dayLimit = notebook?.dayLimit ?? 0;
    const learned = notebook?.learnedToday ?? 0;
    const progress = dayLimit ? Math.min(1, learned / dayLimit) : 0;

    if (authLoading) {
      /* 登录状态读取中 */
      return (
        <View style={styles.dashboardCard}>
          <View style={styles.loginStateWrap}>
            <ActivityIndicator size="small" color={Colors.primary} />
            <Text style={styles.loginStateDesc}>正在读取登录状态…</Text>
          </View>
        </View>
      );
    }

    if (!isLoggedIn) {
      /* 未登录状态：只给文字提示，登录入口统一由顶部头图区承载 */
      return (
        <View style={styles.dashboardCard}>
          <View style={styles.cardHeader}>
            <View style={styles.cardIcon}>
              <Ionicons name="book" size={17} color="#FFFFFF" />
            </View>
            <View style={styles.cardTitleWrap}>
              <Text style={styles.cardTitle}>生词本</Text>
              <Text style={styles.cardSubtitle}>登录后开始今日学习</Text>
            </View>
            <View style={styles.unloginTag}>
              <Ionicons name="person-outline" size={13} color={Colors.textMuted} />
              <Text style={styles.unloginTagText}>未登录</Text>
            </View>
          </View>

          <View style={styles.unloginHintRow}>
            <Ionicons name="lock-closed-outline" size={13} color={Colors.textMuted} />
            <Text style={styles.unloginHintText}>登录后查看今日目标与生词本进度</Text>
          </View>
        </View>
      );
    }

    /* 已登录: 数据全部取自生词本 */
    return (
      <TouchableOpacity
        style={styles.dashboardCard}
        onPress={handleOpenBookmarks}
        activeOpacity={0.9}
      >
        {/* 第一行: 标题 + 今日目标完成度 + 进入箭头 */}
        <View style={styles.cardHeader}>
          <View style={styles.cardIcon}>
            <Ionicons name="book" size={17} color="#FFFFFF" />
          </View>
          <View style={styles.cardTitleWrap}>
            <Text style={styles.cardTitle}>生词本</Text>
            <Text style={styles.cardSubtitle} numberOfLines={1}>
              {loadingNotebook
                ? '正在获取生词本数据…'
                : notebook
                ? `今日目标 ${dayLimit} 个单词 · 共 ${notebook.totalWords} 词`
                : '生词本数据获取失败'}
            </Text>
          </View>
          {!loadingNotebook && dayLimit ? (
            <View style={styles.percentBadge}>
              <Text style={styles.percentBadgeText}>{Math.round(progress * 100)}%</Text>
            </View>
          ) : null}
          <Ionicons name="chevron-forward" size={17} color={Colors.textMuted} />
        </View>

        {/* 指标行: 学习目标 / 已学习 / 总数量（浅米子卡片，竖线分隔） */}
        <View style={styles.notebookMetrics}>
          {renderNotebookMetric('学习目标', notebook?.dayLimit ?? '-', Colors.primary)}
          <View style={styles.metricDivider} />
          {renderNotebookMetric('已学习', notebook?.learnedToday ?? '-', Colors.textPrimary)}
          <View style={styles.metricDivider} />
          {renderNotebookMetric('总数量', notebook?.totalWords ?? '-', Colors.accent)}
        </View>

        {/* 底部入口：主色实心按钮，最醒目的一条路径 */}
        <View style={styles.primaryCta}>
          <Ionicons name="book-outline" size={17} color="#FFFFFF" />
          <Text style={styles.primaryCtaText}>进入生词本，开始今日学习</Text>
          <Ionicons name="chevron-forward" size={15} color="rgba(255,255,255,0.85)" />
        </View>
      </TouchableOpacity>
    );
  };

  /**
   * 我的卡组卡片：全部顶层卡组的汇总统计（不再列子卡组、也不再有焦点卡组）。
   * 卡片整体可点，进「我的卡组」列表页 → 挑卡组 → 分类卡组 → 学习。
   */
  const renderPacksCard = () => (
    <TouchableOpacity
      style={styles.packsCard}
      onPress={isLoggedIn ? handleOpenMyPacks : undefined}
      activeOpacity={isLoggedIn ? 0.9 : 1}
    >
      {/* 第一行: 标题 + 全部卡组的完成度 */}
      <View style={styles.cardHeader}>
        <View style={styles.cardIcon}>
          <Ionicons name="albums" size={17} color="#FFFFFF" />
        </View>
        <View style={styles.cardTitleWrap}>
          <Text style={styles.cardTitle} numberOfLines={1}>
            我的卡组
          </Text>
          <Text style={styles.cardSubtitle} numberOfLines={1}>
            {!isLoggedIn
              ? '登录后查看我的卡组'
              : allPacksStats.packCount > 0
              ? `共 ${allPacksStats.packCount} 个卡组 · 已记住 ${allPacksStats.remembered}/${allPacksStats.totalWords} 词`
              : '还没有卡组'}
          </Text>
        </View>
        <View style={styles.percentBadge}>
          <Text style={styles.percentBadgeText}>{Math.round(allPacksStats.progress * 100)}%</Text>
        </View>
        {isLoggedIn ? (
          <Ionicons name="chevron-forward" size={17} color={Colors.textMuted} />
        ) : null}
      </View>

      {/* 全部卡组的已记住 / 未记住 单词数 */}
      <View style={styles.packsProgressTrack}>
        <ProgressBar progress={allPacksStats.progress} height={6} color={Colors.primary} />
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
          <TouchableOpacity style={styles.retryBtn} onPress={reloadAll} activeOpacity={0.85}>
            <Text style={styles.retryText}>重试</Text>
          </TouchableOpacity>
        </View>
      ) : !isLoggedIn ? (
        <View style={styles.unloginHintRow}>
          <Ionicons name="lock-closed-outline" size={13} color={Colors.textMuted} />
          <Text style={styles.unloginHintText}>登录后去卡组市场添加分类背单词卡组</Text>
        </View>
      ) : topPacks.length === 0 ? (
        <View style={styles.packsEmptyWrap}>
          <Ionicons name="albums-outline" size={34} color={Colors.border} />
          <Text style={styles.emptyText}>还没有卡组，去卡组市场添加分类背单词卡组</Text>
          <TouchableOpacity
            style={styles.retryBtn}
            onPress={() => navigation.navigate('Market', { firstSetup: true })}
            activeOpacity={0.85}
          >
            <Text style={styles.retryText}>去卡组市场</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.softCta}>
          <Ionicons name="albums-outline" size={16} color={Colors.primary} />
          <Text style={styles.softCtaText}>查看全部卡组，挑一个开始学习</Text>
          <Ionicons name="chevron-forward" size={14} color={Colors.primary} />
        </View>
      )}
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" backgroundColor={Colors.background} />

      <ScrollView
        style={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={loadingPacks}
            onRefresh={reloadAll}
            colors={[Colors.primary]}
            tintColor={Colors.primary}
          />
        }
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
      >
        {/* 头图区：水墨山水 + 用户信息 + slogan（随页面一起滚走） */}
        {renderHero()}

        <View style={styles.bodyWrap}>
          {/* ① 生词本：今日目标与学习统计 */}
          {renderDashboardCard()}

          {/* ② 我的卡组：全部卡组总览，点进去挑卡组学习 */}
          {renderPacksCard()}

          {/* ③ 电脑端插件说明 */}
          {renderTipCard()}

          {/* ④ 页脚：一句短引 + 开始学习 */}
          {renderQuoteFooter()}
        </View>
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
  scroll: {
    flex: 1,
  },
  listContent: {
    paddingBottom: 28,
  },
  // 头图以下的内容区（左右留白交给各卡片自己控制）
  bodyWrap: {
    paddingTop: 4,
  },

  // ── 顶部头图区：水墨山水打底，信息压在画面下部 ──
  hero: {
    minHeight: 186,
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 6,
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  // 背景图：铺满宽度、顶部对齐，底部多出来的部分被容器裁掉
  heroBg: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    aspectRatio: 1080 / 633,
  },
  // 极淡柔光：压住画面、托亮文字，也顺手柔化图片下缘
  heroVeil: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(248,247,242,0.34)',
  },
  heroLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 18,
  },
  heroLoadingText: {
    fontSize: 13,
    color: Colors.textSecondary,
  },
  heroTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  heroUser: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
  },
  heroAvatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.88)',
    borderWidth: 1,
    borderColor: 'rgba(27,75,63,0.14)',
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
    elevation: 2,
  },
  // 会员头像：金环 + 浅金底
  heroAvatarVip: {
    backgroundColor: 'rgba(192,146,63,0.16)',
    borderWidth: 1.5,
    borderColor: Colors.gold,
  },
  heroUserText: {
    flex: 1,
    minWidth: 0,
    marginLeft: 12,
  },
  heroNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  heroName: {
    flexShrink: 1,
    fontSize: 21,
    fontWeight: '800',
    color: Colors.primaryDark,
    letterSpacing: 0.2,
  },
  heroUserSub: {
    marginTop: 5,
    fontSize: 13,
    color: Colors.textSecondary,
  },
  heroActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginLeft: 10,
  },
  heroIconBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.76)',
    borderWidth: 1,
    borderColor: 'rgba(27,75,63,0.12)',
  },
  heroSloganRow: {
    marginTop: 26,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  heroSlogan: {
    flexShrink: 1,
    fontSize: 14,
    fontWeight: '600',
    color: Colors.primaryDark,
    opacity: 0.9,
  },
  heroStreak: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginLeft: 10,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.72)',
  },
  heroStreakText: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.accent,
  },
  heroRule: {
    marginTop: 12,
    height: 1,
    backgroundColor: 'rgba(27,75,63,0.18)',
  },

  // ── 通用卡片（生词本 / 我的卡组同款） ──
  dashboardCard: {
    backgroundColor: Colors.card,
    borderRadius: 20,
    marginHorizontal: 16,
    marginTop: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.divider,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.06,
    shadowRadius: 14,
    elevation: 2,
  },
  packsCard: {
    backgroundColor: Colors.card,
    borderRadius: 20,
    marginHorizontal: 16,
    marginTop: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.divider,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.06,
    shadowRadius: 14,
    elevation: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  // 卡片标题左侧的墨绿圆形图标
  cardIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    marginRight: 11,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 3,
  },
  cardTitleWrap: {
    flex: 1,
    minWidth: 0,
    marginRight: 8,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: Colors.textPrimary,
    letterSpacing: 0.2,
  },
  cardSubtitle: {
    marginTop: 3,
    fontSize: 12.5,
    color: Colors.textSecondary,
  },
  // 完成度小胶囊（0% / 1%）
  percentBadge: {
    marginRight: 2,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    backgroundColor: Colors.surfaceSoft,
  },
  percentBadgeText: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.primary,
  },

  // ── 生词本：三格指标 ──
  notebookMetrics: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 14,
    paddingVertical: 14,
    borderRadius: 16,
    backgroundColor: Colors.surfaceSoft,
  },
  metricItem: {
    flex: 1,
    alignItems: 'center',
  },
  metricValue: {
    fontSize: 22,
    fontWeight: '800',
    lineHeight: 26,
  },
  metricLabel: {
    marginTop: 4,
    fontSize: 12,
    color: Colors.textSecondary,
  },
  metricDivider: {
    width: 1,
    height: 30,
    backgroundColor: Colors.border,
  },

  // ── 两枚入口按钮 ──
  // 生词本：墨绿实心，一屏里最重的一个动作
  primaryCta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 14,
    height: 52,
    borderRadius: 26,
    backgroundColor: Colors.primary,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.24,
    shadowRadius: 12,
    elevation: 4,
  },
  primaryCtaText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },
  // 我的卡组：浅米底 + 墨绿字，弱一档
  softCta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    marginTop: 14,
    height: 48,
    borderRadius: 24,
    backgroundColor: Colors.primaryLight,
  },
  softCtaText: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.primary,
  },

  // ── 未登录 / 加载 / 空态 ──
  unloginTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    backgroundColor: Colors.surfaceSoft,
  },
  unloginTagText: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.textMuted,
  },
  unloginHintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 14,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: Colors.surfaceSoft,
  },
  unloginHintText: {
    flexShrink: 1,
    fontSize: 12,
    color: Colors.textMuted,
  },
  loginStateWrap: {
    alignItems: 'center',
    paddingTop: 8,
    paddingBottom: 2,
  },
  loginStateDesc: {
    marginTop: 6,
    fontSize: 12,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 18,
  },
  centerPadding: {
    alignItems: 'center',
    paddingTop: 26,
    paddingBottom: 10,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 13,
    color: Colors.textSecondary,
  },
  packsEmptyWrap: {
    alignItems: 'center',
    paddingTop: 14,
    paddingBottom: 4,
  },
  emptyText: {
    marginTop: 12,
    fontSize: 14,
    color: Colors.textMuted,
    textAlign: 'center',
  },
  retryBtn: {
    marginTop: 16,
    paddingHorizontal: 20,
    paddingVertical: 9,
    borderRadius: 18,
    backgroundColor: Colors.primary,
  },
  retryText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },

  // ── 我的卡组：进度条与两端数字 ──
  packsProgressTrack: {
    marginTop: 16,
  },
  packsProgressMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  packsProgressText: {
    fontSize: 12.5,
    color: Colors.textSecondary,
  },
  packsProgressStrong: {
    fontSize: 13,
    fontWeight: '800',
    color: Colors.textPrimary,
  },

  // ── 提示卡（电脑端插件） ──
  tipCard: {
    marginHorizontal: 16,
    marginTop: 14,
    padding: 16,
    borderRadius: 20,
    backgroundColor: Colors.paper,
    borderWidth: 1,
    borderColor: 'rgba(192,146,63,0.18)',
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

  // ── 页脚：短引 + 开始学习 ──
  quoteWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 18,
    marginTop: 18,
    marginBottom: 24,
  },
  quoteTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  quoteEn: {
    fontSize: 12.5,
    fontStyle: 'italic',
    color: Colors.textTertiary,
  },
  quoteCn: {
    marginTop: 4,
    fontSize: 13,
    fontWeight: '700',
    color: Colors.primaryDark,
  },
  quoteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 42,
    paddingHorizontal: 16,
    borderRadius: 21,
    backgroundColor: Colors.primary,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.22,
    shadowRadius: 10,
    elevation: 3,
  },
  quoteBtnText: {
    fontSize: 13.5,
    fontWeight: '700',
    color: '#FFFFFF',
  },

  // ── 头图里的会员标签（金底 + 深墨绿字） ──
  vipTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    marginLeft: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 11,
  },
  vipTagActive: {
    backgroundColor: Colors.gold,
  },
  vipTagUpgrade: {
    borderWidth: 1,
    borderColor: Colors.gold + '66',
    backgroundColor: 'rgba(255,255,255,0.72)',
  },
  vipTagText: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.gold,
  },
  vipTagTextActive: {
    color: Colors.textPrimary,
    letterSpacing: 0.3,
  },
});
