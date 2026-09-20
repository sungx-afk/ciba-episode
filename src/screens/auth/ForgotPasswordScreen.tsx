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
import { AuthApi } from '../../services/api';

type ResetMethod = 'mobile' | 'email';

export const ForgotPasswordScreen: React.FC = () => {
  const navigation = useNavigation<any>();

  const [method, setMethod] = useState<ResetMethod>('mobile');
  const [account, setAccount] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // 格式化手机号
  const handleAccountChange = (text: string) => {
    if (method === 'mobile') {
      const cleaned = text.replace(/\D/g, '').slice(0, 11);
      setAccount(cleaned);
    } else {
      setAccount(text);
    }
  };

  const formatAccount = (raw: string) => {
    if (method !== 'mobile') return raw;
    if (raw.length <= 3) return raw;
    if (raw.length <= 7) return `${raw.slice(0, 3)} ${raw.slice(3)}`;
    return `${raw.slice(0, 3)} ${raw.slice(3, 7)} ${raw.slice(7)}`;
  };

  // 发送重置验证码
  const handleSendCode = async (): Promise<boolean> => {
    const trimmed = account.trim();
    if (!trimmed) {
      Alert.alert('提示', method === 'mobile' ? '请输入手机号码' : '请输入电子邮箱');
      return false;
    }

    if (method === 'mobile') {
      if (!/^1[3-9]\d{9}$/.test(trimmed)) {
        Alert.alert('提示', '请输入有效的11位手机号');
        return false;
      }
      try {
        const res = await AuthApi.sendMobileCode(trimmed, 'reset_pwd');
        if (res && (res.result === 0 || res.result === 1)) {
          Alert.alert('发送成功', '验证码已发送至您的手机');
          return true;
        } else {
          Alert.alert('提示', res?.msg || '短信验证码发送失败');
          return false;
        }
      } catch (err: any) {
        Alert.alert('发送异常', err.message || '网络连接异常');
        return false;
      }
    } else {
      if (!/^\S+@\S+\.\S+$/.test(trimmed)) {
        Alert.alert('提示', '请输入有效的电子邮箱地址');
        return false;
      }
      try {
        const res = await AuthApi.sendEmailCode(trimmed, 'reset_pwd');
        if (res && (res.result === 0 || res.result === 1)) {
          Alert.alert('发送成功', '验证码已发送至您的邮箱');
          return true;
        } else {
          Alert.alert('提示', res?.msg || '邮箱验证码发送失败');
          return false;
        }
      } catch (err: any) {
        Alert.alert('发送异常', err.message || '网络连接异常');
        return false;
      }
    }
  };

  // 提交重置密码
  const handleResetPassword = async () => {
    const trimmedAccount = account.trim();
    const trimmedCode = code.trim();

    if (!trimmedAccount) {
      Alert.alert('提示', '请输入手机号或邮箱');
      return;
    }
    if (!trimmedCode) {
      Alert.alert('提示', '请输入收到的验证码');
      return;
    }
    if (newPassword.length < 6) {
      Alert.alert('提示', '新密码长度至少需要 6 个字符');
      return;
    }
    if (newPassword !== confirmPassword) {
      Alert.alert('提示', '两次输入的新密码不一致');
      return;
    }

    setSubmitting(true);
    try {
      const res = await AuthApi.resetPassword({
        account: trimmedAccount,
        code: trimmedCode,
        newPassword,
      });

      if (res && (res.result === 0 || res.result === 1)) {
        Alert.alert('重置成功', '您的登录密码已成功更新，请重新登录。', [
          {
            text: '去登录',
            onPress: () => navigation.navigate('Login'),
          },
        ]);
      } else {
        Alert.alert('重置失败', res?.msg || '重置密码失败，请核对验证码');
      }
    } catch (err: any) {
      Alert.alert('重置异常', err.message || '网络连接异常');
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
        {/* 顶部导航 */}
        <View style={styles.navBar}>
          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => navigation.goBack()}
            activeOpacity={0.7}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Ionicons name="chevron-back" size={22} color="#3C4A43" />
          </TouchableOpacity>
          <Text style={styles.navTitle}>找回密码</Text>
          <View style={{ width: 36 }} />
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.headerHero}>
            <Text style={styles.headerHeroTitle}>重置登录密码</Text>
            <Text style={styles.headerHeroSub}>
              验证您的安全身份后，即可重新设定登录密码
            </Text>
          </View>

          {/* 浮层悬浮卡片 */}
          <View style={styles.floatingCard}>
            <View style={styles.cardTabRow}>
              <TouchableOpacity
                style={styles.cardTabItem}
                onPress={() => {
                  setMethod('mobile');
                  setAccount('');
                  setCode('');
                }}
                activeOpacity={0.8}
              >
                <Text
                  style={[
                    styles.cardTabText,
                    method === 'mobile' && styles.cardTabTextActive,
                  ]}
                >
                  手机号找回
                </Text>
                {method === 'mobile' && <View style={styles.cardTabIndicator} />}
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.cardTabItem}
                onPress={() => {
                  setMethod('email');
                  setAccount('');
                  setCode('');
                }}
                activeOpacity={0.8}
              >
                <Text
                  style={[
                    styles.cardTabText,
                    method === 'email' && styles.cardTabTextActive,
                  ]}
                >
                  邮箱找回
                </Text>
                {method === 'email' && <View style={styles.cardTabIndicator} />}
              </TouchableOpacity>
            </View>

            <AuthInput
              placeholder={method === 'mobile' ? '请输入手机号码' : '请输入电子邮箱'}
              keyboardType={method === 'mobile' ? 'phone-pad' : 'email-address'}
              maxLength={method === 'mobile' ? 13 : undefined}
              prefix={method === 'mobile' ? '+86' : undefined}
              iconName={method === 'mobile' ? 'phone-portrait-outline' : 'mail-outline'}
              value={formatAccount(account)}
              onChangeText={handleAccountChange}
              onClear={() => setAccount('')}
            />

            <AuthInput
              placeholder="请输入6位验证码"
              keyboardType="number-pad"
              maxLength={6}
              iconName="shield-checkmark-outline"
              value={code}
              onChangeText={setCode}
              rightAction={
                <CountdownButton
                  onSend={handleSendCode}
                  disabled={!account.trim()}
                  text="获取验证码"
                />
              }
            />

            <AuthInput
              placeholder="设定新密码（至少6位）"
              isPassword
              iconName="lock-closed-outline"
              value={newPassword}
              onChangeText={setNewPassword}
            />

            <AuthInput
              placeholder="请再次确认新密码"
              isPassword
              iconName="checkmark-circle-outline"
              value={confirmPassword}
              onChangeText={setConfirmPassword}
            />

            <TouchableOpacity
              style={[styles.heroButton, submitting && styles.heroButtonDisabled]}
              onPress={handleResetPassword}
              disabled={submitting}
              activeOpacity={0.85}
            >
              {submitting ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.heroButtonText}>确 认 重 置</Text>
              )}
            </TouchableOpacity>
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
  navBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#EDEBE3',
    alignItems: 'center',
    justifyContent: 'center',
  },
  navTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#17231E',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 40,
  },
  headerHero: {
    marginBottom: 18,
    paddingHorizontal: 4,
  },
  headerHeroTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: '#17231E',
    letterSpacing: -0.3,
  },
  headerHeroSub: {
    fontSize: 13,
    color: '#63736B',
    marginTop: 4,
  },
  floatingCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 28,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 22,
    ...Platform.select({
      ios: {
        shadowColor: '#1B4B3F',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.08,
        shadowRadius: 20,
      },
      android: {
        elevation: 6,
      },
    }),
  },
  cardTabRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
    paddingHorizontal: 4,
  },
  cardTabItem: {
    marginRight: 24,
    alignItems: 'center',
    position: 'relative',
    paddingBottom: 6,
  },
  cardTabText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#93A199',
  },
  cardTabTextActive: {
    fontSize: 16,
    fontWeight: '800',
    color: '#17231E',
  },
  cardTabIndicator: {
    position: 'absolute',
    bottom: 0,
    width: 22,
    height: 3.5,
    borderRadius: 2,
    backgroundColor: Colors.primary,
  },
  heroButton: {
    backgroundColor: Colors.primary,
    height: 50,
    borderRadius: 25,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
    ...Platform.select({
      ios: {
        shadowColor: Colors.primary,
        shadowOffset: { width: 0, height: 5 },
        shadowOpacity: 0.35,
        shadowRadius: 10,
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
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 2,
  },
});
