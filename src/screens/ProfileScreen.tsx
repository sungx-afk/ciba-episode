import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Switch,
  Alert,
  SafeAreaView,
  Share,
  TextInput,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useProgress } from '../storage/progressStore';
import { Colors } from '../theme/colors';
import { Header } from '../components/Header';
import { ConfirmDialog, DialogPayload } from '../components/ConfirmDialog';
import { useAuth } from '../context/AuthContext';
import {
  fetchNotebookDayLimit,
  saveNotebookDayLimit,
  NOTEBOOK_DAY_LIMIT_OPTIONS,
  NOTEBOOK_DAY_LIMIT_MAX,
} from '../services/bookmarkApi';

interface ProfileScreenProps {
  navigation: any;
}

export const ProfileScreen: React.FC<ProfileScreenProps> = ({ navigation }) => {
  const { user: authUser, isLoggedIn: authLoggedIn, logout: authLogout } = useAuth();
  const { state, stats, updateSettings, resetProgress, exportProgressData, user: progressUser, isLoggedIn: progressLoggedIn, logout: progressLogout, currentPack, wordSource, currentTopPack, readRememberedTopPack } = useProgress();

  const user = authUser || progressUser;
  const isLoggedIn = authLoggedIn || progressLoggedIn;
  /** 用户资料里的 vip 字段为 1 表示付费会员 */
  const isVip = Number(user?.vip) === 1;

  const [logoutVisible, setLogoutVisible] = useState(false);
  /** 统一弹窗状态：确认/提示一律走 ConfirmDialog，不再使用系统 Alert */
  const [dialog, setDialog] = useState<DialogPayload | null>(null);

  /**
   * 生词本学习目标：即生词本设置里的「每日添加新学习卡片数量」，
   * 存在生词本卡组 conf.pack_btns_setting.day_limit（服务端字段，非本地设置）。
   */
  const [dayLimit, setDayLimit] = useState(0);
  const [loadingDayLimit, setLoadingDayLimit] = useState(true);
  const [savingDayLimit, setSavingDayLimit] = useState(false);
  /** 自定义输入框里的值；在别处（如生词本学习页）设成非档位数字时回填到这里 */
  const [customLimit, setCustomLimit] = useState('');

  // 当前使用的词库: 与首页顶部「我的卡组」共用同一份 currentTopPack
  const [rememberedPackName, setRememberedPackName] = useState<string | null>(null);

  // 还没进过首页时 currentTopPack 为空，先用本地记住的卡组名占位
  useEffect(() => {
    let alive = true;
    (async () => {
      const remembered = await readRememberedTopPack();
      if (alive) setRememberedPackName(remembered?.name || null);
    })();
    return () => {
      alive = false;
    };
  }, [readRememberedTopPack, currentTopPack?.id]);

  const activePackName =
    currentTopPack?.name || rememberedPackName || currentPack?.name || '本地词库 (TOEFL 意群)';

  // 手机号脱敏
  const maskMobile = (m?: string) => {
    if (!m) return '';
    return m.replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2');
  };

  /** 读取生词本每日学习目标 */
  const loadDayLimit = useCallback(async () => {
    setLoadingDayLimit(true);
    try {
      const limit = await fetchNotebookDayLimit();
      setDayLimit(limit);
    } catch {
      // 取不到（未登录或网络问题）时保持 0，卡片仍可点，点了会提示
      setDayLimit(0);
    } finally {
      setLoadingDayLimit(false);
    }
  }, []);

  /** 进页面/登录态变化时读取生词本每日学习目标 */
  useEffect(() => {
    loadDayLimit();
  }, [isLoggedIn, loadDayLimit]);

  // 每次切回「我的」tab 都重新拉一次，别处（如生词本学习页）改过这里也能同步；首次聚焦跳过避免重复请求
  const dayLimitFocusedRef = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (!dayLimitFocusedRef.current) {
        dayLimitFocusedRef.current = true;
        return;
      }
      loadDayLimit();
    }, [loadDayLimit])
  );

  /** 切换生词本学习目标：整包回传卡组，只改 day_limit，其它字段不动 */
  const handleDayLimitChange = async (goal: number) => {
    if (savingDayLimit || dayLimit === goal) return;
    setSavingDayLimit(true);
    try {
      const saved = await saveNotebookDayLimit(goal);
      setDayLimit(saved);
    } catch (e: any) {
      setDialog({
        title: '设置失败',
        message: e?.message || '生词本学习目标保存失败，请稍后重试',
        confirmText: '知道了',
        showCancel: false,
        onConfirm: () => setDialog(null),
      });
    } finally {
      setSavingDayLimit(false);
    }
  };

  /** 当前目标不在快捷档位里时，说明是自定义值（可能是别处设置的） */
  const isCustomLimit = dayLimit > 0 && !NOTEBOOK_DAY_LIMIT_OPTIONS.includes(dayLimit);

  /** 自定义值回填：不是快捷档位时把服务端的值显示在输入框里 */
  useEffect(() => {
    setCustomLimit(isCustomLimit ? String(dayLimit) : '');
  }, [dayLimit, isCustomLimit]);

  /** 自定义输入提交：空值或非法值不保存，恢复成当前目标 */
  const handleCustomSubmit = async () => {
    const raw = customLimit.trim();
    const n = Number(raw);
    if (!raw || !Number.isFinite(n) || n <= 0) {
      setCustomLimit(isCustomLimit ? String(dayLimit) : '');
      return;
    }
    const goal = Math.min(NOTEBOOK_DAY_LIMIT_MAX, Math.floor(n));
    if (goal === dayLimit) {
      setCustomLimit(String(goal));
      return;
    }
    await handleDayLimitChange(goal);
  };

  const handleAccentChange = (accent: 'en-US' | 'en-GB') => {
    updateSettings({ accent });
  };

  const handleToggleAutoPronounce = (value: boolean) => {
    updateSettings({ autoPronounce: value });
  };

  const handleExport = async () => {
    try {
      const data = exportProgressData();
      await Share.share({
        title: '糍粑看美剧学英语学习备份',
        message: data,
      });
    } catch (err) {
      console.warn(err);
    }
  };

  const handleReset = () => {
    setDialog({
      title: '清空学习记录',
      message: '确定要清除所有词汇的学习进度与生词本记录吗？此操作不可恢复。',
      confirmText: '确定清空',
      onConfirm: () => {
        setDialog(null);
        resetProgress();
      },
    });
  };

  const handleLogout = () => {
    setLogoutVisible(true);
  };

  /**
   * 调试入口：连点 3 次用户名弹出当前账号的用户 ID，方便反馈问题时定位账号。
   * 超过 1.5 秒没有继续点就重新计数，避免平时误触弹出。
   */
  const nameTapCountRef = useRef(0);
  const nameTapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleUserNameTap = () => {
    if (nameTapTimerRef.current) clearTimeout(nameTapTimerRef.current);
    nameTapCountRef.current += 1;
    nameTapTimerRef.current = setTimeout(() => {
      nameTapCountRef.current = 0;
    }, 1500);

    if (nameTapCountRef.current < 3) return;
    nameTapCountRef.current = 0;
    if (nameTapTimerRef.current) clearTimeout(nameTapTimerRef.current);

    setDialog({
      title: '用户信息',
      message: `用户 ID：${user?.id ?? '未登录'}`,
      confirmText: '知道了',
      showCancel: false,
      onConfirm: () => setDialog(null),
    });
  };

  // 离开页面时清掉连点计时器
  useEffect(
    () => () => {
      if (nameTapTimerRef.current) clearTimeout(nameTapTimerRef.current);
    },
    []
  );

  const confirmLogout = async () => {
    setLogoutVisible(false);
    try {
      await authLogout();
    } catch (_) {}
    try {
      await progressLogout();
    } catch (_) {}
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <Header title="我的" onBack={() => navigation.goBack()} />

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        {/* 用户概览卡片 */}
        <View style={styles.userCard}>
          <View style={styles.avatarWrap}>
            <View style={[styles.avatarCircle, isVip && styles.avatarCircleVip]}>
              <Ionicons
                name={isLoggedIn ? 'person' : 'log-in-outline'}
                size={32}
                color={isVip ? Colors.gold : Colors.primary}
              />
            </View>
            {/* 会员身份：头像右下角挂一枚金色小钻石，一眼可辨 */}
            {isVip ? (
              <View style={styles.avatarVipBadge}>
                <Ionicons name="diamond" size={10} color={Colors.textPrimary} />
              </View>
            ) : null}
          </View>
          <View style={styles.userInfo}>
            <View style={styles.userNameRow}>
              <Text style={styles.userName} numberOfLines={1} onPress={handleUserNameTap}>
                {isLoggedIn ? user?.nickname || user?.loginName || maskMobile(user?.mobile) || '糍粑学员' : '未登录'}
              </Text>
              {isLoggedIn && (
                <TouchableOpacity
                  style={[styles.vipButton, isVip ? styles.vipButtonVip : styles.vipButtonUpgrade]}
                  onPress={() => navigation.navigate('Purchase')}
                  activeOpacity={0.75}
                >
                  <Ionicons
                    name={isVip ? 'diamond' : 'diamond-outline'}
                    size={12}
                    color={isVip ? Colors.textPrimary : Colors.gold}
                  />
                  <Text style={[styles.vipButtonText, isVip && styles.vipButtonTextVip]}>
                    {isVip ? 'VIP 会员' : '升级会员'}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
            <Text style={styles.userSub}>
              {isLoggedIn
                ? (user?.mobile ? maskMobile(user.mobile) : user?.email)
                : '登录后可同步词书与多端学习进度'}
            </Text>
          </View>
          {isLoggedIn ? (
            <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout} activeOpacity={0.7} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Ionicons name="log-out-outline" size={18} color={Colors.pinwheelRed} />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={styles.loginBtnSmall}
              onPress={() => navigation.navigate('Login')}
              activeOpacity={0.7}
            >
              <Text style={styles.loginBtnSmallText}>登录</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* 词库切换 */}
        <TouchableOpacity
          style={[styles.sectionCard, styles.rowCard]}
          onPress={() => navigation.navigate('BookSelect')}
          activeOpacity={0.7}
        >
          <View style={styles.actionLeft}>
            <Ionicons name="library-outline" size={20} color={Colors.primary} />
            <View style={styles.packInfo}>
              <Text style={styles.actionLabel}>切换词库</Text>
              <Text style={styles.settingDesc} numberOfLines={1}>
                当前: {activePackName}
              </Text>
            </View>
          </View>
          <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
        </TouchableOpacity>

        {/* 学习总览 */}
        <View style={styles.statsCard}>
          <Text style={styles.cardHeaderTitle}>学习统计</Text>
          <View style={styles.statsGrid}>
            <View style={styles.statBox}>
              <Text style={styles.statNum}>{stats.streakDays}</Text>
              <Text style={styles.statLbl}>连续打卡(天)</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={styles.statNum}>{stats.masteredCount}</Text>
              <Text style={styles.statLbl}>已掌握单词</Text>
            </View>
          </View>
        </View>

        {/* 生词本学习目标：对应生词本设置里的「每日添加新学习卡片数量」 */}
        <View style={styles.sectionCard}>
          <Text style={styles.cardHeaderTitle}>生词本学习目标</Text>
          <Text style={styles.settingDesc}>每天添加到生词本的新学习卡片数量</Text>
          <View style={styles.goalRow}>
            {NOTEBOOK_DAY_LIMIT_OPTIONS.map((goal) => {
              const isSelected = dayLimit === goal;
              return (
                <TouchableOpacity
                  key={goal}
                  style={[styles.goalChip, isSelected && styles.goalChipActive]}
                  onPress={() => handleDayLimitChange(goal)}
                  activeOpacity={0.7}
                  disabled={loadingDayLimit || savingDayLimit}
                >
                  <Text style={[styles.goalChipText, isSelected && styles.goalChipTextActive]}>
                    {goal} 词
                  </Text>
                </TouchableOpacity>
              );
            })}
            {/* 自定义：别处可能设成非档位数字，这里原样显示并可直接改 */}
            <TextInput
              style={[styles.goalInput, isCustomLimit && styles.goalInputActive]}
              value={customLimit}
              onChangeText={(t) => setCustomLimit(t.replace(/[^0-9]/g, ''))}
              keyboardType="number-pad"
              placeholder="自定义"
              placeholderTextColor={Colors.textMuted}
              maxLength={3}
              returnKeyType="done"
              onSubmitEditing={handleCustomSubmit}
              onBlur={handleCustomSubmit}
              editable={!loadingDayLimit && !savingDayLimit}
            />
          </View>
        </View>

        {/* 发音设置 */}
        <View style={styles.sectionCard}>
          <Text style={styles.cardHeaderTitle}>发音与朗读</Text>

          {/* 口音 */}
          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>口音类型</Text>
            <View style={styles.accentToggle}>
              <TouchableOpacity
                style={[styles.accentOption, state.accent === 'en-US' && styles.accentOptionActive]}
                onPress={() => handleAccentChange('en-US')}
              >
                <Text
                  style={[styles.accentText, state.accent === 'en-US' && styles.accentTextActive]}
                >
                  美音 (US)
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.accentOption, state.accent === 'en-GB' && styles.accentOptionActive]}
                onPress={() => handleAccentChange('en-GB')}
              >
                <Text
                  style={[styles.accentText, state.accent === 'en-GB' && styles.accentTextActive]}
                >
                  英音 (UK)
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* 自动朗读 */}
          <View style={[styles.settingRow, styles.borderTop]}>
            <View>
              <Text style={styles.settingLabel}>进入新词自动朗读</Text>
              <Text style={styles.settingDesc}>切换卡片时自动播放发音</Text>
            </View>
            <Switch
              value={state.autoPronounce}
              onValueChange={handleToggleAutoPronounce}
              trackColor={{ false: Colors.divider, true: Colors.primary }}
              thumbColor="#FFFFFF"
            />
          </View>
        </View>

        {/* 数据与存储 */}
        {/* <View style={styles.sectionCard}>
          <Text style={styles.cardHeaderTitle}>数据与隐私</Text>

          <TouchableOpacity style={styles.actionRow} onPress={handleExport} activeOpacity={0.7}>
            <View style={styles.actionLeft}>
              <Ionicons name="share-outline" size={20} color={Colors.primary} />
              <Text style={styles.actionLabel}>导出与备份学习记录</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionRow, styles.borderTop]}
            onPress={handleReset}
            activeOpacity={0.7}
          >
            <View style={styles.actionLeft}>
              <Ionicons name="trash-outline" size={20} color={Colors.pinwheelRed} />
              <Text style={[styles.actionLabel, { color: Colors.pinwheelRed }]}>
                清空全部学习记录
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
          </TouchableOpacity>
        </View> */}

        {/* 关于 */}
        <View style={styles.aboutFooter}>
          <Text style={styles.aboutText}>糍粑看美剧学英语 · CibaEnglishEpisode v1.0.0</Text>
          <Text style={styles.aboutSub}> 纯粹的分类单词记忆工具</Text>
        </View>
      </ScrollView>

      <ConfirmDialog
        visible={logoutVisible}
        title="退出登录"
        message="确定要退出登录吗？"
        onConfirm={confirmLogout}
        onCancel={() => setLogoutVisible(false)}
        onClose={() => setLogoutVisible(false)}
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
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  userCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.card,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 16,
  },
  avatarWrap: {
    width: 52,
    height: 52,
    marginRight: 14,
  },
  avatarCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: Colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // 会员头像：金环 + 金色底，与普通用户区分开
  avatarCircleVip: {
    backgroundColor: Colors.gold + '1A',
    borderWidth: 2,
    borderColor: Colors.gold,
  },
  avatarVipBadge: {
    position: 'absolute',
    right: 11,
    bottom: -2,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: Colors.gold,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: Colors.card,
    shadowColor: Colors.gold,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.5,
    shadowRadius: 4,
    elevation: 4,
  },
  userInfo: {
    flex: 1,
  },
  userNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  userName: {
    fontSize: 18,
    fontWeight: '800',
    color: Colors.textPrimary,
    flexShrink: 1,
  },
  vipButton: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 8,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 3,
  },
  // 已是会员：金色实心 + 外发光，身份展示更醒目
  vipButtonVip: {
    backgroundColor: Colors.gold,
    shadowColor: Colors.gold,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.5,
    shadowRadius: 8,
    elevation: 5,
  },
  // 未开通：金色描边浅底，作为升级入口
  vipButtonUpgrade: {
    borderWidth: 1,
    borderColor: Colors.gold + '66',
    backgroundColor: Colors.gold + '14',
  },
  vipButtonText: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.gold,
  },
  vipButtonTextVip: {
    color: Colors.textPrimary,
    letterSpacing: 0.3,
  },
  userSub: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 3,
  },
  logoutBtn: {
    padding: 8,
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
  statsCard: {
    backgroundColor: Colors.card,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 16,
  },
  cardHeaderTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginBottom: 12,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  statBox: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: Colors.background,
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
  },
  statNum: {
    fontSize: 22,
    fontWeight: '800',
    color: Colors.primary,
  },
  statLbl: {
    fontSize: 11,
    color: Colors.textSecondary,
    marginTop: 4,
  },
  sectionCard: {
    backgroundColor: Colors.card,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 16,
  },
  // 生词本学习目标档位（与「发音与朗读」的口音切换同一套观感）
  goalRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 10,
  },
  goalChip: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: Colors.divider,
    alignItems: 'center',
  },
  goalChipActive: {
    backgroundColor: Colors.primary,
  },
  goalChipText: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.textSecondary,
  },
  goalChipTextActive: {
    color: '#FFFFFF',
  },
  goalInput: {
    flex: 1.3,
    paddingHorizontal: 8,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: Colors.divider,
    borderWidth: 1,
    borderColor: Colors.border,
    textAlign: 'center',
    fontSize: 13,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  // 服务端的值不是快捷档位时高亮，提示当前用的是自定义数量
  goalInputActive: {
    backgroundColor: Colors.primaryLight,
    borderColor: Colors.primary,
    color: Colors.primary,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  borderTop: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.divider,
    marginTop: 8,
    paddingTop: 12,
  },
  settingLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  settingDesc: {
    fontSize: 11,
    color: Colors.textMuted,
    marginTop: 2,
  },
  accentToggle: {
    flexDirection: 'row',
    backgroundColor: Colors.divider,
    borderRadius: 8,
    padding: 3,
  },
  accentOption: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  accentOptionActive: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 1,
  },
  accentText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  accentTextActive: {
    color: Colors.primary,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
  },
  actionLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  packInfo: {
    flex: 1,
  },
  rowCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  actionLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  aboutFooter: {
    alignItems: 'center',
    paddingVertical: 20,
  },
  aboutText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textMuted,
  },
  aboutSub: {
    fontSize: 11,
    color: Colors.textMuted,
    marginTop: 4,
  },
});