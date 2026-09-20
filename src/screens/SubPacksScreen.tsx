import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  SafeAreaView,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useProgress } from '../storage/progressStore';
import { packLibrary, RemotePack } from '../services/packLibrary';
import { Colors, getCategoryColor } from '../theme/colors';
import { ProgressBar } from '../components/ProgressBar';
import { Header } from '../components/Header';
import { ConfirmDialog, DialogPayload } from '../components/ConfirmDialog';

/** 分类卡组分页大小 */
const SUB_PAGE_SIZE = 30;
/**
 * 首屏拿到空列表时的补偿重试：刚安装 / 刚同步的卡组，服务端可能还没把分类卡组生成完，
 * 此时接口会返回 total=0 的空列表，多试几次就能拿到真实数据。
 */
const SUB_FIRST_RETRY = 3;
const SUB_RETRY_DELAY_MS = 800;
/** 未记住 tab: remember_type = 0 未记住 + 1 进行中 */
const LEARNING_REMEMBER_TYPES = [0, 1];
/** 已记住 tab: remember_type = 2 */
const REMEMBERED_REMEMBER_TYPES = [2];

interface SubPacksScreenProps {
  navigation: any;
  route: any;
}

/**
 * 分类卡组列表页：
 * 「我的卡组」→ 某个卡组 → 这里，列出该卡组下的分类卡组，点分类进单词列表开始学习。
 */
export const SubPacksScreen: React.FC<SubPacksScreenProps> = ({ navigation, route }) => {
  const packId = Number(route?.params?.packId);
  const packName: string = route?.params?.packName || '分类卡组';
  const initialPack = route?.params?.pack as RemotePack | undefined;

  const {
    isLoggedIn,
    loadPackWordList,
    isLoadingPackWords,
    packWordsPackId,
    packMasteredDelta,
    setCurrentTopPack,
  } = useProgress();

  const [pack, setPack] = useState<RemotePack | null>(initialPack ?? null);
  const [subPacks, setSubPacks] = useState<RemotePack[]>([]);
  const [total, setTotal] = useState(0);
  /** 未记住 / 已记住 */
  const [tab, setTab] = useState<'learning' | 'remembered'>('learning');
  const [learningTotal, setLearningTotal] = useState<number | null>(null);
  const [rememberedTotal, setRememberedTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  /** 还有下一页可拉：以「上一页是否满页 / 是否有新增」为准，不单看服务端 total */
  const [hasMore, setHasMore] = useState(true);
  /** 列表拿空但顶层卡组显示有词：服务端还在生成，界面上给「准备中」而不是「暂无」 */
  const [syncing, setSyncing] = useState(false);
  /** 统一弹窗状态：确认/提示一律走 ConfirmDialog */
  const [dialog, setDialog] = useState<DialogPayload | null>(null);

  // 请求代次：切 tab / 重新加载时丢弃旧请求
  const reqGenRef = useRef(0);
  const focusedOnceRef = useRef(false);
  /** 列表镜像：分页游标与到底判断都读它，避免闭包里拿到过期的 subPacks */
  const listRef = useRef<RemotePack[]>([]);
  /** 顶层卡组详情镜像：判断「列表空但卡组有词」时读它 */
  const packRef = useRef<RemotePack | null>(initialPack ?? null);
  /** 连续空页计数：连着两页拉不到新数据就停，防止 total 偏大时反复空转 */
  const emptyPageRef = useRef(0);

  useEffect(() => {
    packRef.current = pack;
  }, [pack]);

  /** 进入页面即把它设为当前词库：背词页与闪卡页要拿它做词库名 */
  useEffect(() => {
    if (!packId) return;
    if (initialPack) {
      setCurrentTopPack(initialPack);
      return;
    }
    packLibrary
      .fetchPackDetail(packId)
      .then((detail) => {
        setPack(detail);
        setCurrentTopPack(detail);
      })
      .catch(() => {});
  }, [packId, initialPack, setCurrentTopPack]);

  /** 刷新顶层卡组自身的统计（总词数 / 已记住） */
  const refreshPackStats = useCallback(async () => {
    try {
      const detail = await packLibrary.fetchPackDetail(packId);
      setPack(detail);
    } catch {
      // 静默失败：保留原有统计
    }
  }, [packId]);

  const currentTypes = tab === 'remembered' ? REMEMBERED_REMEMBER_TYPES : LEARNING_REMEMBER_TYPES;

  const load = useCallback(
    async (start: number, types: number[], silent = false) => {
      const gen = ++reqGenRef.current;
      if (!silent) {
        if (start === 0) setLoading(true);
        else setLoadingMore(true);
      }
      try {
        const res = await packLibrary.fetchSubPacks(packId, {
          start,
          limit: SUB_PAGE_SIZE,
          rememberTypes: types,
        });
        if (gen !== reqGenRef.current) return;

        const incoming = res.packs || [];
        const prev = start === 0 ? [] : listRef.current;
        const seen = new Set(prev.map((p) => p.id));
        const fresh = incoming.filter((p) => !seen.has(p.id));
        const merged = start === 0 ? incoming : [...prev, ...fresh];
        listRef.current = merged;
        setSubPacks(merged);

        // total 可能偏小（卡组刚安装、服务端统计未就绪）：已加载条数优先
        const serverTotal = res.total || 0;
        const effectiveTotal = Math.max(serverTotal, merged.length);
        setTotal(effectiveTotal);
        if (types.includes(0)) setLearningTotal(effectiveTotal);
        else setRememberedTotal(effectiveTotal);

        if (start === 0) {
          emptyPageRef.current = 0;
          setSyncing(merged.length === 0 && Number(packRef.current?.card_count) > 0);
        }

        // 是否还能继续拉：
        //  - 本页满页 → 后面大概率还有，即使已加载数 >= total 也要再探一页（total 偏小的情形）
        //  - 本页不满 → 正常到底；但如果已加载数仍小于 total（total 偏大），再给一次机会
        //  - 本页 0 条新增 → 累计空页，连续两次空页直接终止，避免死循环
        if (fresh.length === 0) {
          emptyPageRef.current += 1;
          setHasMore(emptyPageRef.current < 2 && merged.length < serverTotal);
        } else {
          emptyPageRef.current = 0;
          setHasMore(incoming.length >= SUB_PAGE_SIZE || merged.length < serverTotal);
        }
      } catch (e: any) {
        if (gen !== reqGenRef.current) return;
        setErrorMsg(e?.message || '加载分类卡组失败');
      } finally {
        if (gen === reqGenRef.current) {
          setLoading(false);
          setLoadingMore(false);
          setRefreshing(false);
        }
      }
    },
    [packId]
  );

  /** 另一个 tab 的数量（列表接口只返回当前过滤条件的 total） */
  const loadOtherTabCount = useCallback(
    async (types: number[]) => {
      try {
        const res = await packLibrary.fetchSubPacks(packId, {
          start: 0,
          limit: 1,
          rememberTypes: types,
        });
        if (types.includes(0)) setLearningTotal(res.total);
        else setRememberedTotal(res.total);
      } catch {
        // 静默失败：tab 上少个数字不影响使用
      }
    },
    [packId]
  );

  /**
   * 首屏加载：卡组刚安装时服务端可能还没生成完分类卡组，
   * 接口会先返回空列表（total=0），这里静默补几次，避免用户看到「暂无分类」却怎么刷都刷不出来。
   */
  const loadFirstPage = useCallback(
    async (types: number[]) => {
      await load(0, types);
      let gen = reqGenRef.current;
      let tries = 0;
      while (tries < SUB_FIRST_RETRY && listRef.current.length === 0) {
        // 顶层卡组一个词都没有时不重试：那就是真的没有分类，不是没生成完
        if (!(Number(packRef.current?.card_count) > 0)) break;
        if (reqGenRef.current !== gen) return; // 期间已有别的请求接管
        tries += 1;
        setSyncing(true);
        await new Promise((r) => setTimeout(r, SUB_RETRY_DELAY_MS));
        if (reqGenRef.current !== gen) return;
        await load(0, types, true);
        gen = reqGenRef.current;
      }
    },
    [load]
  );

  // 切 tab 时重新拉取；其它情况由首次加载 / 聚焦刷新负责
  const firstLoadRef = useRef(true);
  useEffect(() => {
    if (!packId) return;
    if (firstLoadRef.current) {
      firstLoadRef.current = false;
      loadFirstPage(LEARNING_REMEMBER_TYPES);
      loadOtherTabCount(REMEMBERED_REMEMBER_TYPES);
      refreshPackStats();
      return;
    }
    load(0, currentTypes);
    loadOtherTabCount(
      tab === 'learning' ? REMEMBERED_REMEMBER_TYPES : LEARNING_REMEMBER_TYPES
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // 学完返回本页时静默刷新，保证进度数字是最新的
  useFocusEffect(
    useCallback(() => {
      if (!focusedOnceRef.current) {
        focusedOnceRef.current = true;
        return;
      }
      if (!packId) return;
      load(0, currentTypes, true);
      refreshPackStats();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [packId, currentTypes, load, refreshPackStats])
  );

  const handleLoadMore = () => {
    if (loading || loadingMore || refreshing) return;
    // 游标用列表镜像：合并去重后 subPacks.length 才是真实已加载条数
    if (!hasMore || listRef.current.length === 0) return;
    load(listRef.current.length, currentTypes);
  };

  /** 打开某个分类卡组的单词列表 */
  const handleOpenSubPack = async (sub: RemotePack) => {
    if (!isLoggedIn) {
      setDialog({
        title: '需要登录',
        message: '请先登录后再学习在线卡组',
        confirmText: '去登录',
        onConfirm: () => {
          setDialog(null);
          navigation.navigate('Login');
        },
      });
      return;
    }
    try {
      const list = await loadPackWordList(sub.id, { cat: packName, sub: sub.name || '' });
      if (!list.length) {
        setDialog({ title: '提示', message: '该分类暂无单词', showCancel: false });
        return;
      }
      navigation.navigate('WordList', { source: 'pack', title: sub.name });
    } catch (e: any) {
      setDialog({
        title: '加载失败',
        message: e?.message || '获取单词列表失败',
        showCancel: false,
      });
    }
  };

  /** 顶层卡组的整体单词进度 */
  const packProgress = useMemo(() => {
    const totalWords = Number(pack?.card_count) || 0;
    const remembered = Math.max(
      0,
      Math.min(totalWords, Number(pack?.remembered_card_count) || 0)
    );
    return {
      totalWords,
      remembered,
      notRemembered: Math.max(0, totalWords - remembered),
      progress: totalWords > 0 ? Math.min(1, remembered / totalWords) : 0,
    };
  }, [pack]);

  const renderItem = ({ item }: { item: RemotePack }) => {
    const subTotal = item.card_count || 0;
    // 服务端 remembered_card_count 不实时更新，叠加本地学习产生的增量
    const delta = packMasteredDelta[item.id] || 0;
    const remembered = Math.max(
      0,
      Math.min(subTotal, (item.remembered_card_count || 0) + delta)
    );
    const todayCount = item.today_card_count || 0;
    const todayLearnedCount = Math.min(item.today_learned_card_count || 0, todayCount);
    const progress = subTotal > 0 ? Math.min(1, remembered / subTotal) : 0;
    const color = getCategoryColor(item.name);
    const isLoadingList = isLoadingPackWords && packWordsPackId === item.id;

    return (
      <TouchableOpacity style={styles.subCard} onPress={() => handleOpenSubPack(item)} activeOpacity={0.85}>
        {/* 分类色只留一条细色条做识别，卡面统一走白卡，避免一片花花绿绿的色块 */}
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
              <Text style={styles.subCountPillText}>{subTotal} 词</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={Colors.textMuted} />
          </View>

          <View style={styles.subMetaRow}>
            <Text style={styles.subMetaText}>已记住 {remembered}/{subTotal}</Text>
            {tab === 'learning' && todayCount > 0 ? (
              <>
                <Text style={styles.subMetaDot}>·</Text>
                <Text style={styles.subTodayText}>
                  今日 {todayLearnedCount}/{todayCount}
                </Text>
              </>
            ) : null}
          </View>

          <View style={styles.subProgressRow}>
            <View style={styles.subProgressBar}>
              <ProgressBar
                progress={progress}
                height={5}
                color={color}
                backgroundColor={Colors.divider}
              />
            </View>
            <Text style={styles.subProgressText}>{Math.round(progress * 100)}%</Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  const renderHeader = () => (
    <View>
      <View style={styles.summaryCard}>
        <View style={styles.summaryTop}>
          <View style={styles.summaryTitleIcon}>
            <Ionicons name="albums-outline" size={16} color="#FFFFFF" />
          </View>
          <View style={styles.summaryTitleWrap}>
            <Text style={styles.summaryTitle} numberOfLines={1}>
              {pack?.name || packName}
            </Text>
            <Text style={styles.summarySubtitle} numberOfLines={1}>
              已记住 {packProgress.remembered}/{packProgress.totalWords} 词
            </Text>
          </View>
          <View style={styles.summaryPercentBadge}>
            <Text style={styles.summaryPercentText}>
              {Math.round(packProgress.progress * 100)}%
            </Text>
          </View>
        </View>
        <ProgressBar progress={packProgress.progress} height={8} color={Colors.success} />
        <Text style={styles.summaryHint}>点分类卡组开始背词</Text>
      </View>

      <View style={styles.tabs}>
        <TouchableOpacity
          style={[styles.tab, tab === 'learning' && styles.tabActive]}
          onPress={() => setTab('learning')}
          activeOpacity={0.8}
        >
          <Ionicons
            name={tab === 'learning' ? 'albums' : 'albums-outline'}
            size={14}
            color={tab === 'learning' ? Colors.primary : Colors.textTertiary}
          />
          <Text style={[styles.tabText, tab === 'learning' && styles.tabTextActive]}>
            {`未记住${learningTotal != null ? ` ${learningTotal}` : ''}`}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tab, tab === 'remembered' && styles.tabActive]}
          onPress={() => setTab('remembered')}
          activeOpacity={0.8}
        >
          <Ionicons
            name={tab === 'remembered' ? 'checkmark-circle' : 'checkmark-circle-outline'}
            size={14}
            color={tab === 'remembered' ? Colors.success : Colors.textTertiary}
          />
          <Text
            style={[
              styles.tabText,
              tab === 'remembered' && styles.tabTextActive,
              tab === 'remembered' && styles.tabTextDone,
            ]}
          >
            {`已记住${rememberedTotal != null ? ` ${rememberedTotal}` : ''}`}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <Header
        title="分类卡组"
        subtitle={packName}
        onBack={() => navigation.goBack()}
      />

      {loading && subPacks.length === 0 ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text style={styles.loadingText}>正在加载分类卡组...</Text>
        </View>
      ) : (
        <FlatList
          data={subPacks}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={renderHeader()}
          renderItem={renderItem}
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.4}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                load(0, currentTypes, true);
                refreshPackStats();
              }}
              colors={[Colors.primary]}
            />
          }
          ListFooterComponent={
            loadingMore ? (
              <View style={styles.footerLoading}>
                <ActivityIndicator size="small" color={Colors.primary} />
              </View>
            ) : !hasMore && subPacks.length > 0 ? (
              <Text style={styles.footerText}>已显示全部分类卡组</Text>
            ) : null
          }
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              {errorMsg ? (
                <>
                  <Ionicons name="cloud-offline-outline" size={48} color={Colors.border} />
                  <Text style={styles.emptyText}>{errorMsg}</Text>
                  <TouchableOpacity
                    style={styles.retryBtn}
                    onPress={() => load(0, currentTypes)}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.retryText}>重试</Text>
                  </TouchableOpacity>
                </>
              ) : (
                syncing ? (
                  <>
                    <Ionicons name="time-outline" size={48} color={Colors.border} />
                    <Text style={styles.emptyText}>卡组刚添加，分类还在准备中</Text>
                    <Text style={styles.emptyHint}>服务端生成需要一点时间，可下拉刷新或点下面重试</Text>
                    <TouchableOpacity
                      style={styles.retryBtn}
                      onPress={() => loadFirstPage(currentTypes)}
                      activeOpacity={0.8}
                    >
                      <Text style={styles.retryText}>重新加载</Text>
                    </TouchableOpacity>
                  </>
                ) : (
                  <>
                    <Ionicons name="albums-outline" size={48} color={Colors.border} />
                    <Text style={styles.emptyText}>
                      {tab === 'remembered' ? '暂无已记住的分类卡组' : '暂无未记住的分类卡组'}
                    </Text>
                  </>
                )
              )}
            </View>
          }
        />
      )}

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
  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 13,
    color: Colors.textSecondary,
  },
  listContent: {
    padding: 16,
    paddingBottom: 40,
  },
  summaryCard: {
    backgroundColor: Colors.card,
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.divider,
    marginBottom: 12,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.06,
    shadowRadius: 14,
    elevation: 2,
  },
  summaryTop: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  summaryTitleIcon: {
    width: 30,
    height: 30,
    borderRadius: 10,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  summaryTitleWrap: {
    flex: 1,
    minWidth: 0,
  },
  summaryTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: Colors.textPrimary,
  },
  summarySubtitle: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  summaryPercentBadge: {
    backgroundColor: Colors.primaryLight,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
  },
  summaryPercentText: {
    fontSize: 13,
    fontWeight: '800',
    color: Colors.primary,
  },
  summaryHint: {
    fontSize: 11,
    color: Colors.textMuted,
    marginTop: 10,
  },
  tabs: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 12,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 9,
    borderRadius: 10,
    backgroundColor: Colors.divider,
  },
  tabActive: {
    backgroundColor: Colors.primaryLight,
  },
  tabText: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.textTertiary,
  },
  tabTextActive: {
    color: Colors.primary,
  },
  tabTextDone: {
    color: Colors.success,
  },
  // 与首页卡片同一套规格：白卡 + 圆角 18 + 1px 分隔色边 + 主色柔和投影
  subCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.card,
    borderRadius: 18,
    paddingVertical: 14,
    paddingHorizontal: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: Colors.divider,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.06,
    shadowRadius: 14,
    elevation: 2,
  },
  // 分类识别色：一条撑满卡片高度的细色条，比整卡染色干净
  subColorBar: {
    width: 4,
    alignSelf: 'stretch',
    borderRadius: 2,
    marginRight: 12,
  },
  subCardBody: {
    flex: 1,
    minWidth: 0,
  },
  subCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  subCardName: {
    flex: 1,
    fontSize: 16,
    fontWeight: '700',
    color: Colors.textPrimary,
    letterSpacing: 0.2,
  },
  subCountPill: {
    backgroundColor: Colors.surfaceSoft,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  subCountPillText: {
    fontSize: 11.5,
    fontWeight: '700',
    color: Colors.textSecondary,
  },
  subMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 5,
  },
  subMetaText: {
    fontSize: 12,
    color: Colors.textTertiary,
  },
  subMetaDot: {
    fontSize: 12,
    color: Colors.textMuted,
  },
  subTodayText: {
    fontSize: 12,
    color: Colors.primary,
    fontWeight: '600',
  },
  subProgressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 10,
  },
  subProgressBar: {
    flex: 1,
    minWidth: 0,
  },
  subProgressText: {
    width: 34,
    textAlign: 'right',
    fontSize: 11.5,
    fontWeight: '700',
    color: Colors.textSecondary,
  },
  footerLoading: {
    paddingVertical: 20,
    alignItems: 'center',
  },
  footerText: {
    paddingVertical: 18,
    textAlign: 'center',
    fontSize: 12,
    color: Colors.textMuted,
  },
  emptyWrap: {
    alignItems: 'center',
    paddingTop: 40,
    paddingHorizontal: 24,
  },
  emptyText: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginTop: 12,
    textAlign: 'center',
  },
  emptyHint: {
    fontSize: 12,
    color: Colors.textMuted,
    marginTop: 6,
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
});
