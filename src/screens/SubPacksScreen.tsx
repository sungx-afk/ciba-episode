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
/** 未记住 tab: remember_type = 0 未记住 + 1 进行中 */
const LEARNING_REMEMBER_TYPES = [0, 1];
/** 已记住 tab: remember_type = 2 */
const REMEMBERED_REMEMBER_TYPES = [2];

interface SubPacksScreenProps {
  navigation: any;
  route: any;
}

/** 合并分页数据并按 id 去重 */
function mergePacks(prev: RemotePack[], next: RemotePack[]): RemotePack[] {
  const seen = new Set(prev.map((p) => p.id));
  return [...prev, ...next.filter((p) => !seen.has(p.id))];
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
  /** 统一弹窗状态：确认/提示一律走 ConfirmDialog */
  const [dialog, setDialog] = useState<DialogPayload | null>(null);

  // 请求代次：切 tab / 重新加载时丢弃旧请求
  const reqGenRef = useRef(0);
  const focusedOnceRef = useRef(false);

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
        setSubPacks((prev) => (start === 0 ? res.packs : mergePacks(prev, res.packs)));
        setTotal(res.total);
        if (types.includes(0)) setLearningTotal(res.total);
        else setRememberedTotal(res.total);
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

  // 切 tab 时重新拉取；其它情况由首次加载 / 聚焦刷新负责
  const firstLoadRef = useRef(true);
  useEffect(() => {
    if (!packId) return;
    if (firstLoadRef.current) {
      firstLoadRef.current = false;
      load(0, LEARNING_REMEMBER_TYPES);
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
    if (subPacks.length === 0 || subPacks.length >= total) return;
    load(subPacks.length, currentTypes);
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
      <TouchableOpacity
        style={[styles.subCard, { backgroundColor: `${color}12` }]}
        onPress={() => handleOpenSubPack(item)}
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
              <Text style={styles.subCountPillText}>{subTotal} 词</Text>
            </View>
          </View>

          <View style={styles.subMetaRow}>
            <Text style={styles.subMetaText}>
              已记住 {remembered}/{subTotal}
            </Text>
            {tab === 'learning' && todayCount > 0 ? (
              <Text style={styles.subTodayText}>
                今日 {todayLearnedCount}/{todayCount}
              </Text>
            ) : null}
          </View>

          <View style={styles.subProgressWrap}>
            <ProgressBar progress={progress} height={4} color={color} backgroundColor="#FFFFFF" />
          </View>
        </View>

        <Ionicons name="chevron-forward" size={16} color={Colors.textMuted} />
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
                <>
                  <Ionicons name="albums-outline" size={48} color={Colors.border} />
                  <Text style={styles.emptyText}>
                    {tab === 'remembered' ? '暂无已记住的分类卡组' : '暂无未记住的分类卡组'}
                  </Text>
                </>
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
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 12,
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
  subCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  subColorBar: {
    width: 4,
    height: '100%',
    borderRadius: 2,
    marginRight: 10,
  },
  subCardBody: {
    flex: 1,
    minWidth: 0,
  },
  subCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  subCardName: {
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  subCountPill: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 8,
  },
  subCountPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.textSecondary,
  },
  subMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 4,
  },
  subMetaText: {
    fontSize: 11,
    color: Colors.textSecondary,
  },
  subTodayText: {
    fontSize: 11,
    color: Colors.primary,
    fontWeight: '600',
  },
  subProgressWrap: {
    marginTop: 8,
  },
  footerLoading: {
    paddingVertical: 20,
    alignItems: 'center',
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
