import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  SafeAreaView,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useProgress } from '../storage/progressStore';
import { packLibrary, RemotePack } from '../services/packLibrary';
import { Colors } from '../theme/colors';
import { Header } from '../components/Header';
import { ConfirmDialog, DialogPayload } from '../components/ConfirmDialog';

interface MarketScreenProps {
  route: any;
  navigation: any;
}

/** 顶部帮助说明 */
const HELP_LINES = [
  '- 降低负荷：顺应大脑规律，将零散单词打包为语义组块，减轻记忆压力。',
  '- 提升效率：提供多重语义线索，让回忆更顺畅，复习节奏更科学。',
  '- 强化应用：结合真实场景学习，避免死记硬背，促进主动输出。',
  '- 意义记忆：将机械背诵转化为意义记忆，实现词汇量的质变。',
];

/**
 * 词库市场: 从市场选择 pack_type = qian_wen_cat 的词库并安装到我的词库
 * 列表: GET  /anki/pack/in-store.json
 * 安装: POST /anki/pack/install.json (sourceId + name)
 */
export const MarketScreen: React.FC<MarketScreenProps> = ({ route, navigation }) => {
  const { isLoggedIn, setInstalledPack } = useProgress();

  // 分类页检测到「我的词库」为空时进入，顶部展示引导提示
  const firstSetup = route?.params?.firstSetup === true;

  const [packs, setPacks] = useState<RemotePack[]>([]);
  const [installedIds, setInstalledIds] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [installingId, setInstallingId] = useState<number | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // 当前选中的词库
  const [selectedPackId, setSelectedPackId] = useState<number | null>(null);
  // 待确认添加的词库 (不为 null 时显示确认框)
  const [pendingPack, setPendingPack] = useState<RemotePack | null>(null);
  /** 统一弹窗状态：确认/提示一律走 ConfirmDialog，不再使用系统 Alert */
  const [dialog, setDialog] = useState<DialogPayload | null>(null);

  const loadMarket = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const [market, mine] = await Promise.all([
        packLibrary.fetchMarketPacks({ start: 0, limit: 50 }),
        packLibrary.fetchPackList({ start: 0, limit: 100, parentId: 0 }),
      ]);
      setPacks(market.packs);
      const ids = new Set<number>();
      for (const p of mine.packs) {
        if (p.source_id) ids.add(Number(p.source_id));
      }
      setInstalledIds(ids);
    } catch (e: any) {
      setErrorMsg(e?.message || '加载词库市场失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMarket();
  }, [loadMarket]);

  /** 点击「确定」: 已添加的词库不能选，未添加的弹确认框后安装 */
  const handleConfirm = useCallback(() => {
    const pack = packs.find((p) => p.id === selectedPackId);
    if (!pack) return;

    // 双保险：卡片已禁止选中，这里再拦一次
    if (installedIds.has(pack.id)) {
      setDialog({
        title: '已添加',
        message: `「${pack.name}」已在你的词库中，市场不支持重复添加`,
        showCancel: false,
      });
      return;
    }
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
    if (installingId !== null) return;
    setPendingPack(pack);
  }, [packs, selectedPackId, installedIds, isLoggedIn, installingId, navigation]);

  /** 确认框点「确定」: 执行安装 */
  const confirmInstall = useCallback(async () => {
    const pack = pendingPack;
    setPendingPack(null);
    if (!pack) return;

    setInstallingId(pack.id);
    try {
      const installed = await packLibrary.installPack(pack.id, pack.name);
      setInstalledIds((prev) => {
        const next = new Set(prev);
        next.add(pack.id);
        return next;
      });
      setInstallingId(null);
      // 通知分类页刷新我的词库并切换到新安装的词库
      setInstalledPack(installed || ({ ...pack } as RemotePack));
      navigation.goBack();
      setDialog({
        title: '添加成功',
        message: `「${pack.name}」已添加到我的词库`,
        showCancel: false,
      });
    } catch (e: any) {
      setInstallingId(null);
      setDialog({
        title: '添加失败',
        message: e?.message || '安装词库失败，请稍后重试',
        showCancel: false,
      });
    }
  }, [pendingPack, navigation, setInstalledPack]);

  const renderPackCard = (item: RemotePack) => {
    const installed = installedIds.has(item.id);
    const selected = !installed && selectedPackId === item.id;
    return (
      // 已添加的词库：禁用点击，不允许再次选中/重复添加
      <TouchableOpacity
        key={String(item.id)}
        style={[styles.packCard, selected && styles.packCardSelected, installed && styles.packCardInstalled]}
        onPress={() => setSelectedPackId(selected ? null : item.id)}
        disabled={installed}
        activeOpacity={0.75}
      >
        <Text
          style={[styles.packName, selected && styles.packNameSelected, installed && styles.packNameInstalled]}
          numberOfLines={2}
        >
          {item.name}
        </Text>

        <View style={styles.packMetaRow}>
          <Text style={styles.packCount}>{item.card_count || 0} 词</Text>
          {installed ? (
            <View style={styles.installedTag}>
              <Ionicons name="checkmark-circle" size={11} color={Colors.success} />
              <Text style={styles.installedTagText}>已添加</Text>
            </View>
          ) : null}
        </View>

        {selected ? (
          <View style={styles.checkBadge}>
            <Ionicons name="checkmark" size={13} color="#FFFFFF" />
          </View>
        ) : null}
      </TouchableOpacity>
    );
  };

  const installing = installingId !== null;
  // 已添加的词库不可选：选中态本身就不会落到它们身上
  const selectedPackInstalled =
    selectedPackId !== null && installedIds.has(selectedPackId);
  const canConfirm = selectedPackId !== null && !selectedPackInstalled && !installing;

  return (
    <SafeAreaView style={styles.safeArea}>
      <Header
        title="词库市场"
        subtitle="选择需要的词库后点击确定"
        onBack={() => navigation.goBack()}
      />

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={loadMarket} colors={[Colors.primary]} />
        }
      >
        {firstSetup ? (
          <View style={styles.tipBanner}>
            <Ionicons name="information-circle" size={18} color={Colors.primary} />
            <Text style={styles.tipText}>你还没有词库，请先添加一个分类背单词词库后才能使用</Text>
          </View>
        ) : null}

        {/* 帮助说明 */}
        <View style={styles.helpCard}>
          <Text style={styles.helpTitle}>英语单词分类记忆</Text>
          {HELP_LINES.map((line) => (
            <Text key={line} style={styles.helpLine}>
              {line}
            </Text>
          ))}
        </View>

        {/* 提示独立放在说明卡片外，避免读成卡片内容 */}
        <Text style={styles.helpPrompt}>请选择需要的词库</Text>

        {/* 词库网格 */}
        {loading && packs.length === 0 ? (
          <View style={styles.centerWrap}>
            <ActivityIndicator size="large" color={Colors.primary} />
            <Text style={styles.centerText}>正在加载词库市场...</Text>
          </View>
        ) : errorMsg ? (
          <View style={styles.centerWrap}>
            <Ionicons name="cloud-offline-outline" size={44} color={Colors.border} />
            <Text style={styles.centerText}>{errorMsg}</Text>
            <TouchableOpacity style={styles.retryBtn} onPress={loadMarket} activeOpacity={0.8}>
              <Text style={styles.retryText}>重试</Text>
            </TouchableOpacity>
          </View>
        ) : packs.length === 0 ? (
          <View style={styles.centerWrap}>
            <Ionicons name="albums-outline" size={44} color={Colors.border} />
            <Text style={styles.centerText}>暂无可添加的词库</Text>
          </View>
        ) : (
          <View style={styles.grid}>{packs.map(renderPackCard)}</View>
        )}
      </ScrollView>

      {/* 底部确定 */}
      <View style={styles.bottomBar}>
        <TouchableOpacity
          style={[styles.confirmBtn, !canConfirm && styles.confirmBtnDisabled]}
          onPress={handleConfirm}
          disabled={!canConfirm}
          activeOpacity={0.85}
        >
          {installing ? (
            <View style={styles.confirmBtnLoading}>
              <ActivityIndicator size="small" color="#FFFFFF" />
              <Text style={styles.confirmBtnText}>添加中...</Text>
            </View>
          ) : (
            <Text style={styles.confirmBtnText}>确定</Text>
          )}
        </TouchableOpacity>
      </View>

      <ConfirmDialog
        visible={pendingPack !== null}
        title="添加词库"
        message={`确定把「${pendingPack?.name || ''}」添加到我的词库？`}
        onConfirm={confirmInstall}
        onCancel={() => setPendingPack(null)}
        onClose={() => setPendingPack(null)}
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

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  content: {
    padding: 16,
    paddingBottom: 24,
  },

  // 首次进入引导
  tipBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: Colors.primaryLight,
    borderWidth: 1,
    borderColor: Colors.primary + '33',
    gap: 8,
  },
  tipText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    color: Colors.primaryDark,
    fontWeight: '600',
  },

  // 帮助说明
  helpCard: {
    backgroundColor: Colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  helpTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: Colors.textPrimary,
    marginBottom: 8,
  },
  helpLine: {
    fontSize: 13,
    lineHeight: 21,
    color: Colors.textSecondary,
  },
  // 说明卡片外的提示语：与卡片、网格各留 16 间距
  helpPrompt: {
    marginTop: 16,
    fontSize: 14,
    fontWeight: '700',
    color: Colors.textPrimary,
  },

  // 词库网格
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginTop: 16,
  },
  packCard: {
    width: '48.5%',
    minHeight: 84,
    marginBottom: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.card,
    justifyContent: 'space-between',
  },
  packCardSelected: {
    borderColor: Colors.primary,
    borderWidth: 2,
    backgroundColor: Colors.primaryLight,
  },
  // 已添加：置灰且不可点击
  packCardInstalled: {
    backgroundColor: Colors.backgroundAlt,
    borderColor: Colors.border,
    opacity: 0.7,
  },
  packName: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.textPrimary,
    lineHeight: 21,
  },
  packNameSelected: {
    color: Colors.primaryDark,
    fontWeight: '800',
  },
  packNameInstalled: {
    color: Colors.textMuted,
  },
  packMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    gap: 8,
  },
  packCount: {
    fontSize: 13,
    color: Colors.textMuted,
  },
  installedTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5,
    backgroundColor: Colors.success + '15',
  },
  installedTagText: {
    fontSize: 10,
    fontWeight: '700',
    color: Colors.success,
  },
  checkBadge: {
    position: 'absolute',
    top: -1,
    right: -1,
    width: 22,
    height: 22,
    borderTopRightRadius: 9,
    borderBottomLeftRadius: 10,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // 加载 / 错误 / 空态
  centerWrap: {
    alignItems: 'center',
    paddingVertical: 48,
    paddingHorizontal: 20,
  },
  centerText: {
    marginTop: 12,
    fontSize: 14,
    color: Colors.textMuted,
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

  // 底部确定
  bottomBar: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 16,
    backgroundColor: Colors.background,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border,
  },
  confirmBtn: {
    height: 48,
    borderRadius: 10,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmBtnDisabled: {
    backgroundColor: Colors.border,
  },
  confirmBtnLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  confirmBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 1,
  },
});
