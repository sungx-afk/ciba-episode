import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { Colors } from '../../theme/colors';
import { AuthInput } from '../../components/AuthInput';
import { CountdownButton } from '../../components/CountdownButton';
import { AGREEMENT_URL, POLICY_URL } from '../../config/legal';
import { AuthApi } from '../../services/api';
import { useAuth } from '../../context/AuthContext';

export const RegisterScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const { login } = useAuth();

  // 表单状态 (纯手机号注册)
  const [mobile, setMobile] = useState('');
  const [mobileCode, setMobileCode] = useState('');
  const [nickname, setNickname] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // 默认不勾选，由用户主动勾选
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // 格式化手机号
  const handleMobileChange = (text: string) => {
    const cleaned = text.replace(/\D/g, '').slice(0, 11);
    setMobile(cleaned);
  };

  const formatMobile = (raw: string) => {
    if (raw.length <= 3) return raw;
    if (raw.length <= 7) return `${raw.slice(0, 3)} ${raw.slice(3)}`;
    return `${raw.slice(0, 3)} ${raw.slice(3, 7)} ${raw.slice(7)}`;
  };

  // 发送手机验证码
  const handleSendMobileCode = async (): Promise<boolean> => {
    const trimmed = mobile.trim();
    if (!trimmed || !/^1[3-9]\d{9}$/.test(trimmed)) {
      Alert.alert('提示', '请输入有效的11位中国大陆手机号');
      return false;
    }

    try {
      const res = await AuthApi.sendMobileCode(trimmed, 'register');
      if (res && (res.result === 0 || res.result === 1)) {
        Alert.alert('发送成功', '验证码已发送至您的手机');
        return true;
      } else {
        Alert.alert('提示', res?.msg || '短信验证码发送失败');
        return false;
      }
    } catch (e: any) {
      Alert.alert('发送异常', e.message || '网络连接超时');
      return false;
    }
  };

  // 提交注册
  const handleRegister = async () => {
    if (!agreeTerms) {
      Alert.alert('提示', '请先阅读并勾选《用户协议》与《隐私政策》');
      return;
    }

    const trimmedMobile = mobile.trim();
    const trimmedCode = mobileCode.trim();
    if (!trimmedMobile || !trimmedCode) {
      Alert.alert('提示', '请填写手机号和收到的验证码');
      return;
    }

    if (password.length < 6) {
      Alert.alert('提示', '密码长度至少需要 6 位');
      return;
    }

    if (password !== confirmPassword) {
      Alert.alert('提示', '两次输入的密码不一致');
      return;
    }

    setSubmitting(true);
    try {
      const res = await AuthApi.registerByMobile({
        mobile: trimmedMobile,
        code: trimmedCode,
        password,
        nickname: nickname.trim() || undefined,
      });

      if (res && (res.result === 0 || res.result === 1) && res.user && res.token) {
        await login(res.user, res.token);
        navigation.popToTop();
      } else {
        Alert.alert('注册失败', res?.msg || '注册处理失败，请稍后重试');
      }
    } catch (err: any) {
      Alert.alert('注册失败', err.message || '网络连接异常');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          bounces={false}
        >
          {/* 上半部群组 */}
          <View style={styles.topGroup}>
            {/* 顶部导航 */}
            <View style={styles.navBar}>
              <TouchableOpacity
                style={styles.backBtn}
                onPress={() => navigation.goBack()}
                activeOpacity={0.7}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              >
                <Ionicons name="chevron-back" size={22} color="#35566A" />
              </TouchableOpacity>
              <Text style={styles.navTitle}>创建手机账号</Text>
              <View style={{ width: 38 }} />
            </View>

            {/* 顶部标语 */}
            <View style={styles.headerHero}>
              <Text style={styles.headerHeroTitle}>开启高效背词</Text>
              <Text style={styles.headerHeroSub}>
                手机号一键注册，多设备云端词库自动同步
              </Text>
            </View>

            {/* 浮层悬浮卡片 */}
            <View style={styles.floatingCard}>
              <AuthInput
                placeholder="请输入手机号码"
                keyboardType="phone-pad"
                maxLength={13}
                iconName="phone-portrait-outline"
                prefix="+86"
                value={formatMobile(mobile)}
                onChangeText={handleMobileChange}
                onClear={() => setMobile('')}
              />

              <AuthInput
                placeholder="请输入短信验证码"
                keyboardType="number-pad"
                maxLength={6}
                iconName="shield-checkmark-outline"
                value={mobileCode}
                onChangeText={setMobileCode}
                rightAction={
                  <CountdownButton
                    onSend={handleSendMobileCode}
                    disabled={mobile.length !== 11}
                    text="获取验证码"
                  />
                }
              />

              <AuthInput
                placeholder="学习昵称（选填）"
                iconName="happy-outline"
                value={nickname}
                onChangeText={setNickname}
                maxLength={20}
              />

              <AuthInput
                placeholder="设置登录密码（至少6位）"
                isPassword
                iconName="lock-closed-outline"
                value={password}
                onChangeText={setPassword}
              />

              <AuthInput
                placeholder="确认登录密码"
                isPassword
                iconName="checkmark-circle-outline"
                value={confirmPassword}
                onChangeText={setConfirmPassword}
              />

              {/* 主操作按钮 */}
              <TouchableOpacity
                style={[styles.heroButton, submitting && styles.heroButtonDisabled]}
                onPress={handleRegister}
                disabled={submitting}
                activeOpacity={0.85}
              >
                {submitting ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.heroButtonText}>立 即 注 册</Text>
                )}
              </TouchableOpacity>

              {/* 条款勾选：勾选区与两个协议链接各自独立可点 */}
              <View style={styles.termsBox}>
                <TouchableOpacity
                  style={styles.termsCheckArea}
                  onPress={() => setAgreeTerms((prev) => !prev)}
                  activeOpacity={0.7}
                  hitSlop={{ top: 8, bottom: 8, left: 6, right: 4 }}
                >
                  <Ionicons
                    name={agreeTerms ? 'checkmark-circle' : 'ellipse-outline'}
                    size={16}
                    color={agreeTerms ? Colors.primary : '#8BA5B5'}
                  />
                  <Text style={[styles.termsText, styles.termsPrefix]}>
                    注册即代表您已同意
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  activeOpacity={0.6}
                  hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
                  onPress={() =>
                    navigation.navigate('WebPage', { url: AGREEMENT_URL, title: '用户协议' })
                  }
                >
                  <Text style={styles.termsLink}>《用户协议》</Text>
                </TouchableOpacity>

                <Text style={styles.termsText}>与</Text>

                <TouchableOpacity
                  activeOpacity={0.6}
                  hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
                  onPress={() =>
                    navigation.navigate('WebPage', { url: POLICY_URL, title: '隐私政策' })
                  }
                >
                  <Text style={styles.termsLink}>《隐私政策》</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>

          {/* 底部群组：已有账号引导贴底 */}
          <View style={styles.bottomGroup}>
            <View style={styles.loginHintRow}>
              <Text style={styles.loginHintText}>已有糍粑账号？</Text>
              <TouchableOpacity onPress={() => navigation.goBack()} activeOpacity={0.7}>
                <Text style={styles.loginHintLink}>直接登录</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.bottomSecurityText}>
              安全加密传输 · 严格遵守隐私保护指引
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F8FBFC',
  },
  container: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'space-between',
    paddingHorizontal: 22,
    paddingTop: Platform.OS === 'ios' ? 12 : 20,
    paddingBottom: Platform.OS === 'ios' ? 28 : 24,
  },
  topGroup: {
    width: '100%',
  },
  navBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#EEF5F7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  navTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#1E3A4C',
  },
  headerHero: {
    marginBottom: 20,
    paddingHorizontal: 4,
  },
  headerHeroTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: '#1E3A4C',
    letterSpacing: -0.4,
  },
  headerHeroSub: {
    fontSize: 13,
    color: '#5A7A8A',
    marginTop: 6,
    lineHeight: 18,
  },
  floatingCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 30,
    paddingHorizontal: 22,
    paddingTop: 24,
    paddingBottom: 24,
    ...Platform.select({
      ios: {
        shadowColor: '#4A90A4',
        shadowOffset: { width: 0, height: 12 },
        shadowOpacity: 0.09,
        shadowRadius: 22,
      },
      android: {
        elevation: 6,
      },
    }),
  },
  cardTabRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 22,
    paddingHorizontal: 4,
  },
  cardTabItem: {
    marginRight: 26,
    alignItems: 'center',
    position: 'relative',
    paddingBottom: 7,
  },
  cardTabText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#8BA5B5',
  },
  cardTabTextActive: {
    fontSize: 17,
    fontWeight: '800',
    color: '#1E3A4C',
  },
  cardTabIndicator: {
    position: 'absolute',
    bottom: 0,
    width: 24,
    height: 3.5,
    borderRadius: 2,
    backgroundColor: Colors.primary,
  },
  heroButton: {
    backgroundColor: Colors.primary,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    ...Platform.select({
      ios: {
        shadowColor: Colors.primary,
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.35,
        shadowRadius: 12,
      },
      android: {
        elevation: 5,
      },
    }),
  },
  heroButtonDisabled: {
    opacity: 0.65,
  },
  heroButtonText: {
    fontSize: 17,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 3,
  },
  termsBox: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 18,
    paddingHorizontal: 4,
  },
  termsCheckArea: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  termsText: {
    fontSize: 12,
    color: '#5A7A8A',
    lineHeight: 18,
  },
  termsPrefix: {
    marginLeft: 6,
  },
  termsLink: {
    fontSize: 12,
    lineHeight: 18,
    color: '#35566A',
    fontWeight: '600',
  },
  bottomGroup: {
    width: '100%',
    alignItems: 'center',
    marginTop: 28,
  },
  loginHintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  loginHintText: {
    fontSize: 14,
    color: '#5A7A8A',
  },
  loginHintLink: {
    fontSize: 14,
    color: Colors.primary,
    fontWeight: '700',
    marginLeft: 5,
  },
  bottomSecurityText: {
    fontSize: 11,
    color: '#8BA5B5',
  },
});
