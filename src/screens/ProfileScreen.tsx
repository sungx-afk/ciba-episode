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
import { SectionBadge } from '../components/SectionBadge';
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
  const { state, stats, updateSettings, resetProgress, exportProgressData, user: progressUser, isLoggedIn: progressLoggedIn, logout: progressLogout } = useProgress();

  const user = authUser || progressUser;
  const isLoggedIn = authLoggedIn || progressLoggedIn;
  /** 用户资料里的 vip 字段为 1 表示付费会员 */
  const isVip = Number(user?.vip) === 1;

  const [logoutVisible, setLogoutVisible] = useState(false);
  /** 统一弹窗状态：确认/提示一律走 ConfirmDialog，不再使用系统 Alert */
  const [dialog, setDialog] = useState<DialogPayload | null>(null);

  /**
   * 生词本学习目标：即生词本设置里的「每日添加新学习卡片数量」，
   * 存在生词本词库 conf.pack_btns_setting.day_limit（服务端字段，非本地设置）。
   */
  const [dayLimit, setDayLimit] = useState(0);
  const [loadingDayLimit, setLoadingDayLimit] = useState(true);
  /**
   * 学习目标保存走乐观更新：点了立刻选中，请求后台跑。
   * dayLimitReqRef 记请求序号，保证只有最后一次点击的结果落到界面；
   * dayLimitSavingRef 标记是否有请求在飞，飞行期间跳过 focus 刷新，
   * 否则切回「我的」tab 会拉到服务端旧值，把刚点的选项闪回去。
   */
  const dayLimitReqRef = useRef(0);
  const dayLimitSavingRef = useRef(false);
  /** 自定义输入框里的值；在别处（如生词本学习页）设成非档位数字时回填到这里 */
  const [customLimit, setCustomLimit] = useState('');

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
      // 保存请求还在飞时跳过：此时服务端可能还是旧值，拉回来会把刚点的选项闪回去
      if (dayLimitSavingRef.current) return;
      loadDayLimit();
    }, [loadDayLimit])
  );

  /**
   * 切换生词本学习目标：整包回传词库，只改 day_limit，其它字段不动。
   *
   * 乐观更新：点击后立刻把选中态（焦点）落到 UI，不等接口返回；请求后台跑，
   * 只有最后一次点击的返回值会写回界面，失败则回滚到点击前的值并提示。
   */
  const handleDayLimitChange = async (goal: number) => {
    if (dayLimit === goal) return;
    const prevLimit = dayLimit;
    const req = ++dayLimitReqRef.current;
    const isLatest = () => req === dayLimitReqRef.current;

    setDayLimit(goal); // ① 立刻给焦点反馈，不等网络
    dayLimitSavingRef.current = true;
    try {
      const saved = await saveNotebookDayLimit(goal);
      // 期间又点了别的档位时不覆盖新选择，只认最后一次的结果
      if (isLatest()) setDayLimit(saved);
    } catch (e: any) {
      if (isLatest()) setDayLimit(prevLimit);
      setDialog({
        title: '设置失败',
        message: e?.message || '生词本学习目标保存失败，请稍后重试',
        confirmText: '知道了',
        showCancel: false,
        onConfirm: () => setDialog(null),
      });
    } finally {
      if (isLatest()) dayLimitSavingRef.current = false;
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
        {/* 个人名片：深色底 + 鎏金点缀，既是身份区也是会员入口 */}
        <View style={styles.heroCard}>
          <View style={styles.heroGlowGold} />
          <View style={styles.heroGlowSoft} />

          <View style={styles.heroMain}>
            <View style={styles.avatarWrap}>
              <View style={[styles.avatarCircle, isVip && styles.avatarCircleVip]}>
                <Ionicons
                  name={isLoggedIn ? 'person' : 'log-in-outline'}
                  size={28}
                  color={isVip ? Colors.gold : '#FFFFFF'}
                />
              </View>
              {/* 会员身份：头像右下角挂一枚金色小钻石，一眼可辨 */}
              {isVip ? (
                <View style={styles.avatarVipBadge}>
                  <Ionicons name="diamond" size={10} color={Colors.textPrimary} />
                </View>
              ) : null}
            </View>

            <View style={styles.heroInfo}>
              <Text style={styles.heroName} numberOfLines={1} onPress={handleUserNameTap}>
                {isLoggedIn
                  ? user?.nickname || user?.loginName || maskMobile(user?.mobile) || '糍粑学员'
                  : '未登录'}
              </Text>
              <Text style={styles.heroSub} numberOfLines={1}>
                {isLoggedIn
                  ? user?.mobile
                    ? maskMobile(user.mobile)
                    : user?.email || '学习进度已开启多端同步'
                  : '登录后可同步词书与多端学习进度'}
              </Text>
            </View>
          </View>

          <View style={styles.heroActions}>
            {isLoggedIn ? (
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
            ) : (
              <Text style={styles.heroHint}>会员权益随账号同步</Text>
            )}

            {isLoggedIn ? (
              <TouchableOpacity
                style={styles.heroLogout}
                onPress={handleLogout}
                activeOpacity={0.8}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={styles.heroLogoutText}>退出登录</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={styles.heroLogin}
                onPress={() => navigation.navigate('Login')}
                activeOpacity={0.8}
              >
                <Text style={styles.heroLoginText}>登录 / 注册</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* 学习数据：连续打卡与已掌握单词并列，两个数字同一层级 */}
        <View style={styles.card}>
          <SectionBadge icon="stats-chart-outline" label="学习数据" color={Colors.primary} />

          <View style={styles.statRow}>
            <View style={styles.statItem}>
              <View style={styles.statItemTop}>
                <Text style={styles.statNum}>{stats.streakDays}</Text>
                <View
                  style={[styles.statBadge, stats.streakDays > 0 && styles.statBadgeActive]}
                >
                  <Ionicons
                    name="flame"
                    size={16}
                    color={stats.streakDays > 0 ? '#FFFFFF' : Colors.textMuted}
                  />
                </View>
              </View>
              <Text style={styles.statLabel}>连续打卡（天）</Text>
              <Text style={styles.statHint}>
                {stats.streakDays > 0 ? '保持住，别让火苗熄了' : '今天先学一个词吧'}
              </Text>
            </View>

            <View style={styles.statDivider} />

            <View style={styles.statItem}>
              <View style={styles.statItemTop}>
                <Text style={styles.statNum}>{stats.masteredCount}</Text>
                <View
                  style={[
                    styles.statBadge,
                    { backgroundColor: Colors.success + '1A' },
                  ]}
                >
                  <Ionicons name="checkmark-done-outline" size={16} color={Colors.success} />
                </View>
              </View>
              <Text style={styles.statLabel}>已掌握单词</Text>
              <Text style={styles.statHint}>
                {stats.masteredCount > 0 ? '每一步都算数' : '记住第一个词试试'}
              </Text>
            </View>
          </View>
        </View>

        {/* 生词本学习目标：对应生词本设置里的「每日添加新学习卡片数量」 */}
        <View style={styles.card}>
          <SectionBadge icon="flag-outline" label="生词本学习目标" color={Colors.coral} />
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
                  disabled={loadingDayLimit}
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
              editable={!loadingDayLimit}
            />
          </View>
        </View>

        {/* 发音设置 */}
        <View style={styles.card}>
          <SectionBadge icon="volume-high-outline" label="发音与朗读" color={Colors.pinwheelBlue} />

          {/* 口音 */}
          <View style={styles.settingRow}>
            <View style={styles.rowLeading}>
              <Ionicons name="globe-outline" size={18} color={Colors.primary} />
              <Text style={styles.settingLabel}>口音类型</Text>
            </View>
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
            <View style={styles.rowLeading}>
              <Ionicons name="volume-medium-outline" size={18} color={Colors.primary} />
              <View>
                <Text style={styles.settingLabel}>进入新词自动朗读</Text>
                <Text style={styles.settingDesc}>切换卡片时自动播放发音</Text>
              </View>
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
        {/*
          数据与存储（暂未开放，恢复时把注释打开即可）：
          <View style={styles.card}>
            <SectionBadge icon="server-outline" label="数据与隐私" color={Colors.textTertiary} />

            <TouchableOpacity style={styles.settingRow} onPress={handleExport} activeOpacity={0.7}>
              <View style={styles.rowLeading}>
                <Ionicons name="share-outline" size={20} color={Colors.primary} />
                <Text style={styles.settingLabel}>导出与备份学习记录</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.settingRow, styles.borderTop]}
              onPress={handleReset}
              activeOpacity={0.7}
            >
              <View style={styles.rowLeading}>
                <Ionicons name="trash-outline" size={20} color={Colors.pinwheelRed} />
                <Text style={[styles.settingLabel, { color: Colors.pinwheelRed }]}>
                  清空全部学习记录
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
            </TouchableOpacity>
          </View>
        */}

        {/* 关于：页脚留一枚小绿叶，和整站的「学习」调性收尾 */}
        <View style={styles.aboutWrap}>
          <View style={styles.aboutBadge}>
            <Ionicons name="leaf-outline" size={15} color={Colors.primary} />
          </View>
          <Text style={styles.aboutTitle}>糍粑看美剧学英语</Text>
          <Text style={styles.aboutSub}>CibaEnglishEpisode v1.0.0 · 纯粹的分类单词记忆工具</Text>
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
  // ── 个人名片：深色底 + 鎏金光晕，与普通白卡形成层次 ──
  heroCard: {
    backgroundColor: Colors.dark,
    borderRadius: 20,
    padding: 18,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(194,154,78,0.32)',
    overflow: 'hidden',
    shadowColor: Colors.dark,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.16,
    shadowRadius: 14,
    elevation: 5,
  },
  heroGlowGold: {
    position: 'absolute',
    right: -34,
    top: -46,
    width: 130,
    height: 130,
    borderRadius: 65,
    backgroundColor: 'rgba(194,154,78,0.22)',
  },
  heroGlowSoft: {
    position: 'absolute',
    left: -26,
    bottom: -58,
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  heroMain: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatarWrap: {
    width: 54,
    height: 54,
    marginRight: 14,
  },
  avatarCircle: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.24)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // 会员头像：金环 + 金色底，与普通用户区分开
  avatarCircleVip: {
    backgroundColor: 'rgba(194,154,78,0.24)',
    borderWidth: 2,
    borderColor: Colors.gold,
  },
  avatarVipBadge: {
    position: 'absolute',
    right: 10,
    bottom: -2,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: Colors.gold,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: Colors.dark,
    shadowColor: Colors.gold,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.5,
    shadowRadius: 4,
    elevation: 4,
  },
  heroInfo: {
    flex: 1,
  },
  heroName: {
    fontSize: 18,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  heroSub: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.66)',
    marginTop: 4,
  },
  heroActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 16,
  },
  heroHint: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.5)',
  },
  heroLogout: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  heroLogoutText: {
    fontSize: 12,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.92)',
  },
  heroLogin: {
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: Colors.gold,
  },
  heroLoginText: {
    fontSize: 13,
    fontWeight: '800',
    color: Colors.dark,
  },
  vipButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    gap: 4,
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
  // 未开通：金色描边 + 深底上的金雾，作为升级入口（hero 是深色卡，透明度要比普通卡高）
  vipButtonUpgrade: {
    borderWidth: 1,
    borderColor: Colors.gold + '99',
    backgroundColor: 'rgba(194,154,78,0.18)',
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
  // ── 通用白卡 + 块内的小指标块 ──
  card: {
    backgroundColor: Colors.card,
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 14,
  },
  // ── 学习数据：连续打卡 / 已掌握单词，两个大数字并列 ──
  statRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  statItem: {
    flex: 1,
  },
  // 数字在左、图标徽章靠右，两者同高对齐
  statItemTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  statNum: {
    fontSize: 30,
    fontWeight: '800',
    color: Colors.primary,
    letterSpacing: -0.5,
  },
  statBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Colors.surfaceSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // 有打卡天数时才点亮火焰，0 天时保持灰色不抢眼
  statBadgeActive: {
    backgroundColor: Colors.coral,
    shadowColor: Colors.coral,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 6,
    elevation: 3,
  },
  statLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginTop: 8,
  },
  statHint: {
    fontSize: 11,
    color: Colors.textMuted,
    marginTop: 2,
  },
  statDivider: {
    width: StyleSheet.hairlineWidth,
    backgroundColor: Colors.divider,
    marginHorizontal: 16,
  },
  // 行内的「图标 + 文案」组合（口音/导出等行都会用到）
  rowLeading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
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
  aboutWrap: {
    alignItems: 'center',
    paddingVertical: 24,
    gap: 6,
  },
  aboutBadge: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: Colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  aboutTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.textSecondary,
  },
  aboutSub: {
    fontSize: 11,
    color: Colors.textMuted,
  },
});