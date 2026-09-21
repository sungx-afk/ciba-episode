import React, { useCallback, useMemo, useRef, useState } from 'react';
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
import { showToast } from '../utils/toast';
import { ConfirmDialog, DialogPayload } from '../components/ConfirmDialog';
import { ActionSheet } from '../components/ActionSheet';

interface MyPacksScreenProps {
  navigation: any;
}

/**
 * 我的词库列表页：
 * 首页「我的词库」总览卡片的下一级，列出全部顶层词库（parentId = 0），
 * 点某个词库进入它的分类词库列表（SubPacks）开始学习。
 */
export const MyPacksScreen: React.FC<MyPacksScreenProps> = ({ navigation }) => {
  const { isLoggedIn, setCurrentTopPack, currentTopPack, resetCurrentTopPack } = useProgress();

  const [packs, setPacks] = useState<RemotePack[]>([]);
  /** 正在删除的词库 id：按钮上转圈并禁用其它删除，避免连点 */
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  /** 统一弹窗状态：确认/提示一律走 ConfirmDialog */
  const [dialog, setDialog] = useState<DialogPayload | null>(null);
  /** 卡片右上角「更多」菜单指向的词库 */
  const [menuPack, setMenuPack] = useState<RemotePack | null>(null);
  /** 首次聚焦由首次加载负责，避免重复请求 */
  const focusedOnceRef = useRef(false);

  const loadPacks = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setErrorMsg(null);
    try {
      const { packs: list } = await packLibrary.fetchMyPacks({ start: 0, limit: 50 });
      setPacks(list);
    } catch (e: any) {
      setErrorMsg(e?.message || '加载我的词库失败');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // 每次进入本页都刷新：从词库市场添加词库、或在下级页面学完后返回，数字都能同步
  useFocusEffect(
    useCallback(() => {
      if (!focusedOnceRef.current) {
        focusedOnceRef.current = true;
        loadPacks();
        return;
      }
      loadPacks(true);
    }, [loadPacks])
  );

  /** 全部词库的汇总统计：词库数 / 总词数 / 已记住词数 */
  const summary = useMemo(() => {
    const totalWords = packs.reduce((sum, p) => sum + (Number(p.card_count) || 0), 0);
    // 服务端缓存偶发「已记住 > 总数」，这里按词库逐个夹取
    const remembered = packs.reduce((sum, p) => {
      const total = Number(p.card_count) || 0;
      return sum + Math.max(0, Math.min(total, Number(p.remembered_card_count) || 0));
    }, 0);
    return {
      packCount: packs.length,
      totalWords,
      remembered,
      progress: totalWords > 0 ? Math.min(1, remembered / totalWords) : 0,
    };
  }, [packs]);

  /** 进入某个词库的分类词库列表；先把它设为当前词库，学习页要用它做词库名 */
  const handleOpenPack = (pack: RemotePack) => {
    setCurrentTopPack(pack);
    navigation.navigate('SubPacks', {
      packId: pack.id,
      packName: pack.name,
      pack,
    });
  };

  const handleOpenMarket = () => {
    if (!isLoggedIn) {
      setDialog({
        title: '需要登录',
        message: '请先登录后再添加词库',
        confirmText: '去登录',
        onConfirm: () => {
          setDialog(null);
          navigation.navigate('Login');
        },
      });
      return;
    }
    navigation.navigate('Market');
  };

  /** 删除词库：与「切换词库」里同一个接口，删完顺手把首页焦点让出来 */
  const confirmDelete = async (pack: RemotePack) => {
    setDeletingId(pack.id);
    try {
      await packLibrary.deletePack(pack.id);
      const rest = packs.filter((p) => Number(p.id) !== Number(pack.id));
      setPacks(rest);
      // 删掉的正好是首页在用的词库：清空焦点，避免首页继续拿已删 id 请求
      if (Number(currentTopPack?.id) === Number(pack.id)) {
        resetCurrentTopPack();
      }
      showToast('已删除词库');
      if (!rest.length) {
        setDialog({
          title: '词库已清空',
          message: '当前没有词库了，去词库市场添加新的分类背单词词库吧',
          confirmText: '去词库市场',
          cancelText: '稍后再说',
          onConfirm: () => {
            setDialog(null);
            navigation.navigate('Market');
          },
        });
      }
    } catch (e: any) {
      setDialog({
        title: '删除失败',
        message: e?.message || '请稍后重试',
        showCancel: false,
      });
    } finally {
      setDeletingId(null);
    }
  };

  /** 删除前二次确认：走页面统一的 ConfirmDialog */
  const handleDeletePack = (pack: RemotePack) => {
    if (!isLoggedIn) {
      setDialog({
        title: '需要登录',
        message: '请先登录后再管理我的词库',
        confirmText: '去登录',
        onConfirm: () => {
          setDialog(null);
          navigation.navigate('Login');
        },
      });
      return;
    }
    setDialog({
      title: '删除词库',
      message: `确定删除「${pack.name}」吗？该词库及其下分类词库、学习记录会一并删除，且不可恢复。`,
      confirmText: '删除',
      cancelText: '取消',
      onConfirm: () => {
        setDialog(null);
        confirmDelete(pack);
      },
    });
  };

  const renderItem = ({ item }: { item: RemotePack }) => {
    const total = Number(item.card_count) || 0;
    const remembered = Math.max(0, Math.min(total, Number(item.remembered_card_count) || 0));
    const progress = total > 0 ? Math.min(1, remembered / total) : 0;
    const color = getCategoryColor(item.name);
    const isDeleting = deletingId === item.id;

    return (
      <View style={styles.packCard}>
        <TouchableOpacity
          style={styles.packMain}
          onPress={() => handleOpenPack(item)}
          activeOpacity={0.8}
        >
          <View style={[styles.packIcon, { backgroundColor: `${color}1A` }]}>
            <Ionicons name="albums-outline" size={20} color={color} />
          </View>

          <View style={styles.packBody}>
            <Text style={styles.packName} numberOfLines={1}>
              {item.name}
            </Text>
            {item.summary ? (
              <Text style={styles.packSummary} numberOfLines={2}>
                {item.summary}
              </Text>
            ) : null}
            <View style={styles.progressRow}>
              <View style={styles.progressTrack}>
                <ProgressBar progress={progress} height={4} color={color} />
              </View>
              <Text style={styles.progressText}>
                已记住 {remembered}/{total} 词
              </Text>
            </View>
          </View>

          <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
        </TouchableOpacity>

        {/*
          右上角的「更多」：独立浮在卡片上（不是主体的子节点），
          所以它只会打开菜单，不会把点击继续传给主体的「查看分类词库」。
          命中区放大到 44x44，但图标本身贴在右上角，视觉上不压住中间的小箭头。
        */}
        <TouchableOpacity
          style={styles.moreBtn}
          onPress={() => setMenuPack(item)}
          disabled={deletingId !== null}
          activeOpacity={0.7}
          accessibilityLabel="更多操作"
        >
          {isDeleting ? (
            <ActivityIndicator size="small" color={Colors.textTertiary} />
          ) : (
            <Ionicons name="ellipsis-horizontal" size={18} color={Colors.textTertiary} />
          )}
        </TouchableOpacity>
      </View>
    );
  };

  const renderSummary = () => (
    <View style={styles.summaryCard}>
      <View style={styles.summaryTop}>
        <View style={styles.summaryTitleIcon}>
          <Ionicons name="albums-outline" size={16} color="#FFFFFF" />
        </View>
        <View style={styles.summaryTitleWrap}>
          <Text style={styles.summaryTitle}>我的词库</Text>
          <Text style={styles.summarySubtitle} numberOfLines={1}>
            {summary.packCount > 0
              ? `共 ${summary.packCount} 个词库 · 已记住 ${summary.remembered}/${summary.totalWords} 词`
              : '还没有词库'}
          </Text>
        </View>
        <View style={styles.summaryPercentBadge}>
          <Text style={styles.summaryPercentText}>
            {Math.round(summary.progress * 100)}%
          </Text>
        </View>
      </View>

      <ProgressBar progress={summary.progress} height={8} color={Colors.success} />

      <Text style={styles.summaryHint}>点词库查看分类并开始学习</Text>
    </View>
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <Header
        title="我的词库"
        onBack={() => navigation.goBack()}
        rightAction={{ icon: 'add', onPress: handleOpenMarket, filled: true, label: '添加' }}
      />

      {loading && packs.length === 0 ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text style={styles.loadingText}>正在加载我的词库...</Text>
        </View>
      ) : (
        <FlatList
          data={packs}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={packs.length > 0 ? renderSummary() : null}
          renderItem={renderItem}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                loadPacks(true);
              }}
              colors={[Colors.primary]}
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              {errorMsg ? (
                <>
                  <Ionicons name="cloud-offline-outline" size={48} color={Colors.border} />
                  <Text style={styles.emptyText}>{errorMsg}</Text>
                  <TouchableOpacity
                    style={styles.retryBtn}
                    onPress={() => loadPacks()}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.retryText}>重试</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  <Ionicons name="albums-outline" size={48} color={Colors.border} />
                  <Text style={styles.emptyText}>你还没有词库</Text>
                  <Text style={styles.emptyHint}>
                    从词库市场添加分类背单词词库后，就能在这里挑词库学习
                  </Text>
                  <TouchableOpacity
                    style={styles.retryBtn}
                    onPress={handleOpenMarket}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.retryText}>去词库市场</Text>
                  </TouchableOpacity>
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

      {/* 卡片「更多」菜单：删除这种不可逆操作，先出菜单再二次确认 */}
      <ActionSheet
        visible={menuPack !== null}
        items={[{ key: 'delete', name: '删除词库', danger: true }]}
        onSelect={(key) => {
          const target = menuPack;
          setMenuPack(null);
          if (key === 'delete' && target) handleDeletePack(target);
        }}
        onClose={() => setMenuPack(null)}
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
    marginBottom: 14,
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
  packCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.card,
    borderRadius: 14,
    paddingLeft: 14,
    paddingRight: 12,
    paddingVertical: 14,
    // 保证卡片足够高，中间的小箭头不会顶到右上角「更多」的命中区
    minHeight: 94,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 10,
  },
  packMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 0,
  },
  // 右上角浮层按钮：44x44 的命中区，图标居上显示，避开中间的小箭头
  moreBtn: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingTop: 7,
    zIndex: 2,
  },
  packIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  packBody: {
    flex: 1,
    minWidth: 0,
  },
  packName: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.textPrimary,
    // 给右上角的「更多」留位，长词库名不会被压在按钮下面
    marginRight: 28,
  },
  packSummary: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 4,
    lineHeight: 18,
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    gap: 8,
  },
  progressTrack: {
    flex: 1,
  },
  progressText: {
    fontSize: 11,
    color: Colors.textMuted,
    flexShrink: 0,
  },
  emptyWrap: {
    alignItems: 'center',
    paddingTop: 60,
    paddingHorizontal: 24,
  },
  emptyText: {
    fontSize: 14,
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
