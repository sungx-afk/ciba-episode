import React, { useState, useEffect } from 'react';
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
  Image,
  Linking,
} from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { Colors } from '../../theme/colors';
import { AuthInput } from '../../components/AuthInput';
import { CountdownButton } from '../../components/CountdownButton';
import { AGREEMENT_URL, POLICY_URL } from '../../config/legal';
import { AuthApi } from '../../services/api';
import { useAuth } from '../../context/AuthContext';

type LoginTab = 'mobile' | 'password';

/**
 * 临时开关：第三方登录（微信 / Apple）在 UI 上先隐藏。
 * 只影响展示，登录逻辑与授权回调监听全部保留，
 * 需要重新露出按钮时把这个常量改回 true 即可。
 */
const SHOW_THIRD_PARTY_LOGIN = false;

export const LoginScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const { login } = useAuth();

  const [activeTab, setActiveTab] = useState<LoginTab>('mobile');

  // 表单状态
  const [mobile, setMobile] = useState('');
  const [smsCode, setSmsCode] = useState('');
  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');

  // 协议与加载状态（默认不勾选，由用户主动勾选）
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [socialLoading, setSocialLoading] = useState(false);

  // 监听微信授权成功后跳回 App 的深度链接 (Deep Link) 回调
  useEffect(() => {
    const handleUrl = async ({ url }: { url: string }) => {
      if (!url) return;
      // 提取回调 URL 中的授权 code，如 wx97f824fd700ab212://oauth?code=xxxx&state=ciba_auth
      const match = url.match(/[?&]code=([^&#]+)/);
      if (match && match[1]) {
        const authCode = decodeURIComponent(match[1]);
        setSocialLoading(true);
        try {
          const res = await AuthApi.wechatAppLogin({
            code: authCode,
            appid: 'wx97f824fd700ab212',
          });
          if (res && (res.result === 0 || res.result === 1) && res.user && res.token) {
            await login(res.user, res.token);
            navigation.goBack();
          } else {
            Alert.alert('微信登录失败', res?.msg || '微信授权校验失败，请使用手机验证码登录');
          }
        } catch (err: any) {
          Alert.alert('微信登录异常', err.message || '网络连接异常');
        } finally {
          setSocialLoading(false);
        }
      }
    };

    // 检查应用冷启动时的初始 URL
    Linking.getInitialURL().then((initialUrl) => {
      if (initialUrl) {
        handleUrl({ url: initialUrl });
      }
    });

    // 监听前台/后台跳转事件
    const subscription = Linking.addEventListener('url', handleUrl);
    return () => {
      subscription.remove();
    };
  }, [login, navigation]);

  // 格式化手机号输入 (3-4-4 分段显示)
  const handleMobileChange = (text: string) => {
    const cleaned = text.replace(/\D/g, '').slice(0, 11);
    setMobile(cleaned);
  };

  // 1. 发送手机验证码
  const handleSendSmsCode = async (): Promise<boolean> => {
    const trimmed = mobile.trim();
    if (!trimmed || !/^1[3-9]\d{9}$/.test(trimmed)) {
      Alert.alert('提示', '请输入有效的11位中国大陆手机号');
      return false;
    }

    try {
      const res = await AuthApi.sendMobileCode(trimmed, 'login');
      if (res && (res.result === 0 || res.result === 1)) {
        Alert.alert('发送成功', '验证码已发送至您的手机，请注意查收');
        return true;
      } else {
        Alert.alert('提示', res?.msg || '短信验证码服务响应失败，请稍后重试');
        return false;
      }
    } catch (err: any) {
      Alert.alert('发送异常', err.message || '网络连接超时');
      return false;
    }
  };

  // 2. 短信验证码登录/自动注册
  const handleMobileLogin = async () => {
    if (!agreeTerms) {
      Alert.alert('提示', '请先阅读并勾选《用户协议》与《隐私政策》');
      return;
    }
    const trimmedMobile = mobile.trim();
    const trimmedCode = smsCode.trim();

    if (!trimmedMobile || !/^1[3-9]\d{9}$/.test(trimmedMobile)) {
      Alert.alert('提示', '请输入正确的11位手机号');
      return;
    }
    if (!trimmedCode) {
      Alert.alert('提示', '请输入收到的验证码');
      return;
    }

    setSubmitting(true);
    try {
      const res = await AuthApi.mobileLogin(trimmedMobile, trimmedCode);
      if (res && (res.result === 0 || res.result === 1) && res.user && res.token) {
        await login(res.user, res.token);
        navigation.goBack();
      } else {
        Alert.alert('登录失败', res?.msg || '验证码错误或已过期');
      }
    } catch (err: any) {
      Alert.alert('登录失败', err.message || '网络连接异常');
    } finally {
      setSubmitting(false);
    }
  };

  // 3. 密码登录
  const handlePasswordLogin = async () => {
    if (!agreeTerms) {
      Alert.alert('提示', '请先阅读并勾选《用户协议》与《隐私政策》');
      return;
    }
    const trimmedAccount = account.trim();
    if (!trimmedAccount) {
      Alert.alert('提示', '请输入手机号或邮箱');
      return;
    }
    if (!password) {
      Alert.alert('提示', '请输入登录密码');
      return;
    }

    setSubmitting(true);
    try {
      const res = await AuthApi.emailLogin(trimmedAccount, password);
      if (res && (res.result === 0 || res.result === 1) && res.user && res.token) {
        await login(res.user, res.token);
        navigation.goBack();
      } else {
        Alert.alert('登录失败', res?.msg || '账号或密码不正确');
      }
    } catch (err: any) {
      Alert.alert('登录失败', err.message || '网络连接异常');
    } finally {
      setSubmitting(false);
    }
  };

  // 4. 微信授权登录
  const handleWechatLogin = async () => {
    if (!agreeTerms) {
      Alert.alert('提示', '请先阅读并勾选《用户协议》与《隐私政策》');
      return;
    }

    setSocialLoading(true);
    try {
      // 真实检测当前设备是否安装了微信客户端（已在 Info.plist 配置白名单）
      let canOpen = false;
      try {
        canOpen = await Linking.canOpenURL('weixin://');
      } catch (checkErr) {
        console.warn('canOpenURL weixin failed:', checkErr);
      }

      if (!canOpen) {
        // 尝试直接 openURL 避免部分机型策略限制
        try {
          await Linking.openURL('weixin://');
          return;
        } catch {
          Alert.alert(
            '未检测到微信',
            '您的设备尚未安装微信客户端，或当前系统未授权跳转。推荐使用手机验证码一键登录，无需密码，安全便捷。',
            [
              { text: '使用验证码登录', onPress: () => setActiveTab('mobile') },
              { text: '知道了', style: 'cancel' },
            ]
          );
          return;
        }
      }

      // 微信移动应用官方授权唤起协议（包含 AppID、授权作用域与防重放 state）
      const wechatAuthUrl = 'weixin://app/wx97f824fd700ab212/auth/?scope=snsapi_userinfo&state=ciba_auth';
      try {
        await Linking.openURL(wechatAuthUrl);
      } catch (authErr) {
        console.warn('wechat auth url open failed, fallback to app:', authErr);
        await Linking.openURL('weixin://');
      }
    } catch (err: any) {
      Alert.alert(
        '唤起微信提示',
        '未能打开微信客户端，推荐直接使用手机号验证码一键登录。',
        [
          { text: '使用手机号登录', onPress: () => setActiveTab('mobile') },
          { text: '知道了', style: 'cancel' },
        ]
      );
    } finally {
      setSocialLoading(false);
    }
  };

  // 5. Apple 授权原生真实登录
  const handleAppleLogin = async () => {
    if (!agreeTerms) {
      Alert.alert('提示', '请先阅读并勾选《用户协议》与《隐私政策》');
      return;
    }

    // 检查当前设备环境是否支持 Apple 登录
    try {
      const isAvailable = await AppleAuthentication.isAvailableAsync();
      if (!isAvailable) {
        Alert.alert(
          '提示',
          '当前设备或系统环境不支持通过 Apple 登录，建议使用手机号验证码一键登录',
          [
            { text: '使用验证码登录', onPress: () => setActiveTab('mobile') },
            { text: '知道了', style: 'cancel' },
          ]
        );
        return;
      }
    } catch {
      Alert.alert(
        '提示',
        '当前系统不支持 Apple 授权登录，建议使用手机验证码登录',
        [
          { text: '使用验证码登录', onPress: () => setActiveTab('mobile') },
          { text: '知道了', style: 'cancel' },
        ]
      );
      return;
    }

    setSocialLoading(true);
    try {
      // 真正拉起 iOS 系统的 Apple 授权原生窗口 (Face ID / 密码)
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });

      const appleUserId = credential.user;
      let fullName = 'Apple 学员';
      if (credential.fullName) {
        const namePart = `${credential.fullName.familyName || ''}${credential.fullName.givenName || ''}`.trim();
        if (namePart) fullName = namePart;
      }

      const res = await AuthApi.appleLogin({
        appleUserId,
        fullName,
        email: credential.email || undefined,
        identityToken: credential.identityToken || undefined,
      });

      if (res && (res.result === 0 || res.result === 1) && res.user && res.token) {
        await login(res.user, res.token);
        navigation.goBack();
      } else {
        Alert.alert('Apple 登录失败', res?.msg || 'Apple 授权凭证校验失败，请稍后重试');
      }
    } catch (err: any) {
      if (err?.code === 'ERR_REQUEST_CANCELED') {
        // 用户主动关闭或取消了 Apple 登录弹窗，无需提示报错
        return;
      }
      const errMsg = err?.message || '';
      // 针对 ASAuthorizationError / unknown reason (缺少 Entitlement 或 Apple 开发者后台未启用 Capability)
      if (
        errMsg.includes('unknown reason') ||
        errMsg.includes('ASAuthorizationError') ||
        err?.code === 'ERR_UNAVAILABLE'
      ) {
        Alert.alert(
          'Apple 登录提示',
          '当前安装包签名环境未分配 Apple 登录权限或暂不可用，建议直接使用手机号验证码一键登录。',
          [
            { text: '使用验证码登录', onPress: () => setActiveTab('mobile') },
            { text: '知道了', style: 'cancel' },
          ]
        );
      } else {
        Alert.alert('登录失败', errMsg || '调起 Apple 授权异常，请使用手机号验证码登录');
      }
    } finally {
      setSocialLoading(false);
    }
  };

  // 计算手机号分段显示格式
  const formatMobile = (raw: string) => {
    if (raw.length <= 3) return raw;
    if (raw.length <= 7) return `${raw.slice(0, 3)} ${raw.slice(3)}`;
    return `${raw.slice(0, 3)} ${raw.slice(3, 7)} ${raw.slice(7)}`;
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
          {/* 上半部核心交互群组 */}
          <View style={styles.topGroup}>
            {/* 顶部宽绰导航 Bar */}
            <View style={styles.navBar}>
              <TouchableOpacity
                style={styles.closeBtn}
                onPress={() => navigation.goBack()}
                activeOpacity={0.7}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              >
                <Ionicons name="close" size={20} color="#46534C" />
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.registerBadge}
                onPress={() => navigation.navigate('Register')}
                activeOpacity={0.75}
              >
                <Text style={styles.registerBadgeText}>免费注册</Text>
              </TouchableOpacity>
            </View>

            {/* 舒展的 Hero 欢迎插画区 */}
            <View style={styles.heroSection}>
              <View style={styles.heroTextCol}>
                <Text style={styles.heroTitle}>Hello!</Text>
                <Text style={styles.heroSubtitle}>糍粑分类背单词</Text>
                <Text style={styles.heroTagline}>意群联想记忆 · 高效突破核心词汇</Text>
              </View>

              <View style={styles.heroIllustrationContainer}>
                <Image
                  source={require('../../assets/login_hero.jpg')}
                  style={styles.heroImage}
                  resizeMode="cover"
                />
              </View>
            </View>

            {/* 浮层悬浮主卡片 (Floating Neo-Card) */}
            <View style={styles.floatingCard}>
              {/* 卡片顶部极简文字 Tab */}
              <View style={styles.cardTabRow}>
                <TouchableOpacity
                  style={styles.cardTabItem}
                  onPress={() => setActiveTab('mobile')}
                  activeOpacity={0.8}
                >
                  <Text
                    style={[
                      styles.cardTabText,
                      activeTab === 'mobile' && styles.cardTabTextActive,
                    ]}
                  >
                    验证码登录
                  </Text>
                  {activeTab === 'mobile' && <View style={styles.cardTabIndicator} />}
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.cardTabItem}
                  onPress={() => setActiveTab('password')}
                  activeOpacity={0.8}
                >
                  <Text
                    style={[
                      styles.cardTabText,
                      activeTab === 'password' && styles.cardTabTextActive,
                    ]}
                  >
                    密码登录
                  </Text>
                  {activeTab === 'password' && <View style={styles.cardTabIndicator} />}
                </TouchableOpacity>
              </View>

              {/* 表单输入区域 */}
              {activeTab === 'mobile' ? (
                <View style={styles.formBody}>
                  <AuthInput
                    placeholder="请输入手机号"
                    keyboardType="phone-pad"
                    maxLength={13}
                    iconName="phone-portrait-outline"
                    prefix="+86"
                    value={formatMobile(mobile)}
                    onChangeText={handleMobileChange}
                    onClear={() => setMobile('')}
                  />

                  <AuthInput
                    placeholder="请输入验证码"
                    keyboardType="number-pad"
                    maxLength={6}
                    iconName="shield-checkmark-outline"
                    value={smsCode}
                    onChangeText={setSmsCode}
                    rightAction={
                      <CountdownButton
                        onSend={handleSendSmsCode}
                        disabled={mobile.length !== 11}
                        text="获取验证码"
                      />
                    }
                  />

                  <View style={styles.cardSubActionRow}>
                    <TouchableOpacity
                      onPress={() => setActiveTab('password')}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.subActionText}>使用账号密码登录</Text>
                    </TouchableOpacity>
                    <Text style={styles.firstLoginTip}>*首次验证自动注册</Text>
                  </View>

                  {/* 登录按钮 */}
                  <TouchableOpacity
                    style={[styles.heroButton, submitting && styles.heroButtonDisabled]}
                    onPress={handleMobileLogin}
                    disabled={submitting}
                    activeOpacity={0.85}
                  >
                    {submitting ? (
                      <ActivityIndicator color="#FFFFFF" />
                    ) : (
                      <Text style={styles.heroButtonText}>登 录</Text>
                    )}
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={styles.formBody}>
                  <AuthInput
                    placeholder="手机号 / 账号"
                    keyboardType="email-address"
                    iconName="person-outline"
                    value={account}
                    onChangeText={setAccount}
                    onClear={() => setAccount('')}
                  />

                  <AuthInput
                    placeholder="请输入登录密码"
                    isPassword
                    iconName="lock-closed-outline"
                    value={password}
                    onChangeText={setPassword}
                  />

                  <View style={styles.cardSubActionRow}>
                    <TouchableOpacity
                      onPress={() => setActiveTab('mobile')}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.subActionText}>手机验证码登录</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      onPress={() => navigation.navigate('ForgotPassword')}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.subActionHighlight}>忘记密码？</Text>
                    </TouchableOpacity>
                  </View>

                  {/* 登录按钮 */}
                  <TouchableOpacity
                    style={[styles.heroButton, submitting && styles.heroButtonDisabled]}
                    onPress={handlePasswordLogin}
                    disabled={submitting}
                    activeOpacity={0.85}
                  >
                    {submitting ? (
                      <ActivityIndicator color="#FFFFFF" />
                    ) : (
                      <Text style={styles.heroButtonText}>登 录</Text>
                    )}
                  </TouchableOpacity>
                </View>
              )}

              {/* 用户协议与隐私政策：勾选区与两个协议链接各自独立可点 */}
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
                    color={agreeTerms ? Colors.primary : '#9AA79F'}
                  />
                  <Text style={[styles.termsText, styles.termsPrefix]}>
                    登录即代表您已阅读并同意
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

          {/* 下半部托底群组：第三方社交登录自然贴靠底部 */}
          <View style={styles.bottomGroup}>
            {SHOW_THIRD_PARTY_LOGIN ? (
              <>
                <View style={styles.socialDividerRow}>
                  <View style={styles.socialLine} />
                  <Text style={styles.socialDividerText}>第三方登录</Text>
                  <View style={styles.socialLine} />
                </View>

                <View style={styles.socialBtnGroup}>
                  {/* 微信登录 */}
                  <TouchableOpacity
                    style={[styles.socialCircleBtn, styles.wechatBg]}
                    onPress={handleWechatLogin}
                    activeOpacity={0.8}
                    disabled={socialLoading}
                  >
                    {socialLoading ? (
                      <ActivityIndicator size="small" color="#FFFFFF" />
                    ) : (
                      <Ionicons name="logo-wechat" size={25} color="#FFFFFF" />
                    )}
                  </TouchableOpacity>

                  {/* Apple 登录 (仅在 iOS 系统显示) */}
                  {Platform.OS === 'ios' && (
                    <TouchableOpacity
                      style={[styles.socialCircleBtn, styles.appleBg]}
                      onPress={handleAppleLogin}
                      activeOpacity={0.8}
                    >
                      <Ionicons name="logo-apple" size={24} color="#FFFFFF" />
                    </TouchableOpacity>
                  )}
                </View>
              </>
            ) : null}

            {/* 底部保障与安心说明 */}
            <Text style={styles.bottomSecurityText}>
              安全加密 · 跨端云同步
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
    backgroundColor: '#F5F4EF',
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
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  closeBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#ECEEE7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  registerBadge: {
    paddingHorizontal: 15,
    paddingVertical: 7,
    borderRadius: 18,
    backgroundColor: '#EAF1EC',
    borderWidth: 1,
    borderColor: '#C3CABC',
  },
  registerBadgeText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#3B6848',
  },
  heroSection: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 24,
    paddingHorizontal: 4,
  },
  heroTextCol: {
    flex: 1,
    paddingRight: 14,
  },
  heroTitle: {
    fontSize: 34,
    fontWeight: '800',
    color: '#1F2B24',
    letterSpacing: -0.6,
  },
  heroSubtitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#46534C',
    marginTop: 6,
  },
  heroTagline: {
    fontSize: 12,
    color: '#6B7A73',
    marginTop: 5,
    lineHeight: 17,
  },
  heroIllustrationContainer: {
    width: 112,
    height: 112,
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: '#EAF1EC',
    ...Platform.select({
      ios: {
        shadowColor: '#3B6848',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.16,
        shadowRadius: 10,
      },
      android: {
        elevation: 4,
      },
    }),
  },
  heroImage: {
    width: '100%',
    height: '100%',
  },
  floatingCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 30,
    paddingHorizontal: 22,
    paddingTop: 24,
    paddingBottom: 24,
    ...Platform.select({
      ios: {
        shadowColor: '#3B6848',
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
    color: '#9AA79F',
  },
  cardTabTextActive: {
    fontSize: 17,
    fontWeight: '800',
    color: '#1F2B24',
  },
  cardTabIndicator: {
    position: 'absolute',
    bottom: 0,
    width: 24,
    height: 3.5,
    borderRadius: 2,
    backgroundColor: Colors.primary,
  },
  formBody: {
    width: '100%',
  },
  cardSubActionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
    marginBottom: 20,
    paddingHorizontal: 4,
  },
  subActionText: {
    fontSize: 13,
    color: '#6B7A73',
    fontWeight: '500',
  },
  subActionHighlight: {
    fontSize: 13,
    color: Colors.primary,
    fontWeight: '600',
  },
  firstLoginTip: {
    fontSize: 11,
    color: '#9AA79F',
  },
  heroButton: {
    backgroundColor: Colors.primary,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
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
    marginTop: 20,
    paddingHorizontal: 4,
  },
  termsCheckArea: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  termsText: {
    fontSize: 12,
    color: '#6B7A73',
    lineHeight: 18,
  },
  termsPrefix: {
    marginLeft: 6,
  },
  termsLink: {
    fontSize: 12,
    lineHeight: 18,
    color: '#46534C',
    fontWeight: '600',
  },
  bottomGroup: {
    width: '100%',
    alignItems: 'center',
    marginTop: 28,
  },
  socialDividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '80%',
    marginBottom: 20,
  },
  socialLine: {
    flex: 1,
    height: 0.8,
    backgroundColor: '#E8EDE7',
  },
  socialDividerText: {
    paddingHorizontal: 14,
    fontSize: 12,
    color: '#9AA79F',
  },
  socialBtnGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  socialCircleBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 15,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.12,
        shadowRadius: 6,
      },
      android: {
        elevation: 3,
      },
    }),
  },
  wechatBg: {
    backgroundColor: '#07C160',
  },
  appleBg: {
    backgroundColor: '#000000',
  },
  emailBg: {
    backgroundColor: '#3B6848',
  },
  bottomSecurityText: {
    fontSize: 11,
    color: '#9AA79F',
  },
});
