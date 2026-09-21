import React, { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  SafeAreaView,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useProgress } from '../storage/progressStore';
import { packLibrary, RemotePack } from '../services/packLibrary';
import { Colors } from '../theme/colors';
import { showToast } from '../utils/toast';
import { Header } from '../components/Header';
import { ConfirmDialog, DialogPayload } from '../components/ConfirmDialog';

interface BookSelectScreenProps {
  navigation: any;
}

export const BookSelectScreen: React.FC<BookSelectScreenProps> = ({ navigation }) => {
  const {
    isLoggedIn,
    loadPackWords,
    currentPack,
    currentTopPack,
    revertToLocal,
    resetCurrentTopPack,
    setCurrentTopPack,
  } = useProgress();
  const [packs, setPacks] = useState<RemotePack[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingPackId, setLoadingPackId] = useState<number | null>(null);
  const [deletingPackId, setDeletingPackId] = useState<number | null>(null);
  /** 统一弹窗状态：确认/提示一律走 ConfirmDialog，不再使用系统 Alert */
  const [dialog, setDialog] = useState<DialogPayload | null>(null);
  /** 待确认删除的词库（ConfirmDialog 用） */
  const [pendingDelete, setPendingDelete] = useState<RemotePack | null>(null);

  const loadPacks = useCallback(async () => {
    setLoading(true);
    try {
      // 与首页顶部「我的词库」下拉同一份数据: GET /anki/pack.json (parentId = 0)
      const { packs } = await packLibrary.fetchMyPacks({ start: 0, limit: 100 });
      setPacks(packs);
    } catch (e: any) {
      setDialog({
        title: '加载失败',
        message: e?.message || '无法获取我的词库',
        showCancel: false,
      });
    } finally {
      setLoading(false);
    }
  }, []);

  // 每次进入本页都重新拉取：从词库市场添加成功后返回，列表能立刻拿到新词库
  useFocusEffect(
    useCallback(() => {
      loadPacks();
    }, [loadPacks])
  );

  const handleSelectPack = async (pack: RemotePack) => {
    if (!isLoggedIn) {
      setDialog({
        title: '需要登录',
        message: '请先登录后再切换在线词库',
        confirmText: '去登录',
        onConfirm: () => {
          setDialog(null);
          navigation.navigate('Login');
        },
      });
      return;
    }

    setLoadingPackId(pack.id);
    try {
      // 列表本身就是「我的词库」，无需再走安装流程
      await loadPackWords(pack);
      navigation.goBack();
    } catch (e: any) {
      setDialog({
        title: '切换词库失败',
        message: e?.message || '请稍后重试',
        showCancel: false,
      });
    } finally {
      setLoadingPackId(null);
    }
  };

  const confirmDelete = async (pack: RemotePack) => {
    setDeletingPackId(pack.id);
    try {
      await packLibrary.deletePack(pack.id);

      const rest = packs.filter((p) => Number(p.id) !== Number(pack.id));
      setPacks(rest);

      const isCurrent =
        Number(currentTopPack?.id) === Number(pack.id) ||
        Number(currentPack?.id) === Number(pack.id);

      // 删的不是当前在用的词库，列表移除即可
      if (!isCurrent) {
        showToast('已删除词库');
        return;
      }

      // 删掉的是当前词库：先清掉旧焦点，再把焦点交给列表第一个
      resetCurrentTopPack();
      const next = rest[0];

      if (!next) {
        // 全删没了：引导去词库市场重新添加
        showToast('已删除词库');
        setDialog({
          title: '词库已清空',
          message: '当前没有可用词库，去词库市场添加新的分类背单词词库吧',
          confirmText: '去词库市场',
          cancelText: '稍后再说',
          onConfirm: () => {
            setDialog(null);
            navigation.navigate('Market', { firstSetup: true });
          },
        });
        return;
      }

      setDeletingPackId(null);
      setLoadingPackId(next.id);
      try {
        // 先把首页显示的顶层词库切过去，否则首页没有焦点，子词库与今日学习都会为空
        await setCurrentTopPack(next);
        await loadPackWords(next);
        showToast(`已删除词库，已切换到「${next.name}」`);
      } catch (e: any) {
        setDialog({
          title: '切换词库失败',
          message: e?.message || `已删除原词库，切换到「${next.name}」失败，请手动选择`,
          showCancel: false,
        });
      } finally {
        setLoadingPackId(null);
      }
    } catch (e: any) {
      setDialog({
        title: '删除失败',
        message: e?.message || '请稍后重试',
        showCancel: false,
      });
    } finally {
      setDeletingPackId(null);
    }
  };

  /** 二次确认：由 ConfirmDialog 弹窗承载 */
  const handleDeletePack = (pack: RemotePack) => {
    setPendingDelete(pack);
  };

  const handleUseLocal = () => {
    revertToLocal();
    navigation.goBack();
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <Header title="切换词库" onBack={() => navigation.goBack()} />

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text style={styles.loadingText}>正在加载我的词库...</Text>
        </View>
      ) : (
        <FlatList
          data={packs}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.listContent}
          // ListHeaderComponent={
          //   <View style={styles.localSection}>
          //     <TouchableOpacity style={styles.localCard} onPress={handleUseLocal} activeOpacity={0.7}>
          //       <View style={styles.localIconWrap}>
          //         <Ionicons name="folder-open-outline" size={24} color={Colors.primary} />
          //       </View>
          //       <View style={styles.localInfo}>
          //         <Text style={styles.localTitle}>本地词库 (TOEFL 意群)</Text>
          //         <Text style={styles.localDesc}>内置 9800+ 托福词汇，按意群分类</Text>
          //       </View>
          //       {currentPack === null && (
          //         <Ionicons name="checkmark-circle" size={22} color={Colors.success} />
          //       )}
          //     </TouchableOpacity>
          //     <Text style={styles.sectionLabel}>词库列表</Text>
          //   </View>
          // }
          renderItem={({ item }) => {
            // 与首页顶部「我的词库」保持一致：优先按当前顶层词库判定
            const isActive =
              [currentTopPack?.id, currentPack?.id].filter((id) => id !== undefined && id !== null)
                .some((id) => Number(id) === Number(item.id));
            const isLoadingThis = loadingPackId === item.id;
            return (
              <View style={[styles.packCard, isActive && styles.packCardActive]}>
                {/* 主体：点击切换词库 */}
                <TouchableOpacity
                  style={styles.packMain}
                  onPress={() => handleSelectPack(item)}
                  disabled={loadingPackId !== null}
                  activeOpacity={0.7}
                >
                  <View style={styles.packHeader}>
                    <Text style={styles.packName} numberOfLines={1}>
                      {item.name}
                    </Text>
                    {isActive ? (
                      <Ionicons name="checkmark-circle" size={20} color={Colors.success} />
                    ) : null}
                  </View>
                  {item.summary ? (
                    <Text style={styles.packSummary} numberOfLines={2}>
                      {item.summary}
                    </Text>
                  ) : null}
                  <View style={styles.packMeta}>
                    <View style={styles.metaItem}>
                      <Ionicons name="documents-outline" size={14} color={Colors.textMuted} />
                      <Text style={styles.metaText}>
                        {item.card_count ? `${item.card_count} 词` : '—'}
                      </Text>
                    </View>
                    {/* {typeof item.price === 'number' && item.price > 0 ? (
                      <View style={styles.priceTag}>
                        <Text style={styles.priceText}>¥{item.price}</Text>
                      </View>
                    ) : (
                      <View style={styles.freeTag}>
                        <Text style={styles.freeText}>免费</Text>
                      </View>
                    )} */}
                  </View>
                </TouchableOpacity>

                {/* 删除按钮与主体平级：嵌套在切换按钮里会抢不到点击 */}
                <TouchableOpacity
                  style={styles.deleteBtn}
                  onPress={() => handleDeletePack(item)}
                  disabled={deletingPackId !== null || loadingPackId !== null}
                  activeOpacity={0.8}
                  accessibilityLabel="删除词库"
                >
                  {deletingPackId === item.id ? (
                    <ActivityIndicator size="small" color={Colors.coral} />
                  ) : (
                    <Ionicons name="trash-outline" size={16} color={Colors.coral} />
                  )}
                </TouchableOpacity>

                {isLoadingThis ? (
                  <View style={styles.loadingOverlay}>
                    <ActivityIndicator color={Colors.primary} />
                    <Text style={styles.loadingOverlayText}>加载中...</Text>
                  </View>
                ) : null}
              </View>
            );
          }}
          // 有数据也一直展示入口：方便直接再去市场补词库，不用先删空
          ListFooterComponent={
            packs.length > 0 ? (
              <TouchableOpacity
                style={styles.addMoreBtn}
                onPress={() => navigation.navigate('Market', { firstSetup: false })}
                activeOpacity={0.7}
              >
                <View style={styles.addMoreIconWrap}>
                  <Ionicons name="add" size={20} color={Colors.primary} />
                </View>
                <View style={styles.addMoreTextWrap}>
                  <Text style={styles.addMoreTitle}>去词库市场添加更多词库</Text>
                  <Text style={styles.addMoreHint}>市场里有分类单词组块，可继续扩充我的词库</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={Colors.textMuted} />
              </TouchableOpacity>
            ) : null
          }
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Ionicons name="library-outline" size={48} color={Colors.border} />
              <Text style={styles.emptyText}>我的词库还是空的</Text>
              <Text style={styles.emptyHint}>先去词库市场添加词库，之后就能在这里直接切换</Text>
              <TouchableOpacity
                style={styles.retryBtn}
                onPress={() => navigation.navigate('Market', { firstSetup: true })}
              >
                <Text style={styles.retryText}>去词库市场</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.secondaryBtn} onPress={loadPacks}>
                <Text style={styles.secondaryText}>刷新</Text>
              </TouchableOpacity>
            </View>
          }
        />
      )}

      <ConfirmDialog
        visible={pendingDelete !== null}
        title="删除词库"
        message={`确定删除「${pendingDelete?.name || ''}」吗？该词库及其下分类词库、学习记录会一并删除，且不可恢复。`}
        onConfirm={() => {
          const target = pendingDelete;
          setPendingDelete(null);
          if (target) confirmDelete(target);
        }}
        onCancel={() => setPendingDelete(null)}
        onClose={() => setPendingDelete(null)}
      />

      {/* 加载失败 / 需要登录 等提示：之前只在 state 里设了 dialog 却没渲染，弹不出来 */}
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
  localSection: {
    marginBottom: 8,
  },
  localCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.card,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 12,
  },
  localIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: Colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  localInfo: {
    flex: 1,
  },
  localTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  localDesc: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.textSecondary,
    marginLeft: 4,
    marginBottom: 8,
  },
  packCard: {
    backgroundColor: Colors.card,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 10,
  },
  packCardActive: {
    borderColor: Colors.primary,
    borderWidth: 2,
  },
  packHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  packMain: {
    paddingRight: 40,
  },
  // 与卡片主体平级的删除按钮，绝对定位到卡片右上角
  deleteBtn: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.coral + '12',
    borderWidth: 1,
    borderColor: Colors.coral + '33',
  },
  packName: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.textPrimary,
    flex: 1,
    marginRight: 8,
  },
  packSummary: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 6,
    lineHeight: 18,
  },
  packMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  metaText: {
    fontSize: 12,
    color: Colors.textMuted,
  },
  priceTag: {
    backgroundColor: Colors.pinwheelRed + '15',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  priceText: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.pinwheelRed,
  },
  freeTag: {
    backgroundColor: Colors.success + '15',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  freeText: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.success,
  },
  loadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(255,255,255,0.85)',
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  loadingOverlayText: {
    fontSize: 13,
    color: Colors.primary,
    fontWeight: '600',
  },
  emptyWrap: {
    alignItems: 'center',
    paddingTop: 60,
  },
  emptyText: {
    fontSize: 14,
    color: Colors.textSecondary,
    marginTop: 12,
  },
  emptyHint: {
    fontSize: 12,
    color: Colors.textMuted,
    marginTop: 6,
    textAlign: 'center',
    paddingHorizontal: 40,
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
  secondaryBtn: {
    marginTop: 10,
    paddingHorizontal: 20,
    paddingVertical: 8,
  },
  secondaryText: {
    color: Colors.textMuted,
    fontSize: 13,
  },
  // 列表底部的「去词库市场」入口（空态时在 ListEmptyComponent 里另有一枚）
  addMoreBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: Colors.borderStrong,
    backgroundColor: Colors.backgroundAlt,
  },
  addMoreIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  addMoreTextWrap: {
    flex: 1,
  },
  addMoreTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  addMoreHint: {
    fontSize: 12,
    color: Colors.textMuted,
    marginTop: 2,
  },
});
