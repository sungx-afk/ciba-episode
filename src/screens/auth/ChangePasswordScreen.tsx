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
import { AuthApi } from '../../services/api';

export const ChangePasswordScreen: React.FC = () => {
  const navigation = useNavigation<any>();

  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleChangePassword = async () => {
    if (!oldPassword) {
      Alert.alert('提示', '请输入当前使用的旧密码');
      return;
    }
    if (newPassword.length < 6) {
      Alert.alert('提示', '新密码长度至少需要 6 个字符');
      return;
    }
    if (newPassword === oldPassword) {
      Alert.alert('提示', '新密码不能与旧密码相同');
      return;
    }
    if (newPassword !== confirmPassword) {
      Alert.alert('提示', '两次输入的新密码不一致');
      return;
    }

    setSubmitting(true);
    try {
      const res = await AuthApi.changePassword({
        oldPassword,
        newPassword,
      });

      if (res && res.result === 1) {
        Alert.alert('修改成功', '您的登录密码已修改成功，请妥善保存。', [
          { text: '确定', onPress: () => navigation.goBack() },
        ]);
      } else {
        Alert.alert('修改失败', res?.msg || '原密码验证未通过，请检查后重试');
      }
    } catch (err: any) {
      Alert.alert('修改异常', err.message || '网络连接异常');
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
            <Ionicons name="chevron-back" size={22} color="#35566A" />
          </TouchableOpacity>
          <Text style={styles.navTitle}>修改密码</Text>
          <View style={{ width: 36 }} />
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.headerHero}>
            <Text style={styles.headerHeroTitle}>账户安全保障</Text>
            <Text style={styles.headerHeroSub}>
              定期更换安全密码，防止学习记录与生词本数据丢失
            </Text>
          </View>

          {/* 浮层悬浮卡片 */}
          <View style={styles.floatingCard}>
            <AuthInput
              label="当前旧密码"
              placeholder="请输入当前正在使用的密码"
              isPassword
              iconName="lock-closed-outline"
              value={oldPassword}
              onChangeText={setOldPassword}
            />

            <AuthInput
              label="设定新密码"
              placeholder="请输入新密码（至少6位）"
              isPassword
              iconName="key-outline"
              value={newPassword}
              onChangeText={setNewPassword}
            />

            <AuthInput
              label="确认新密码"
              placeholder="请再次输入新密码"
              isPassword
              iconName="checkmark-circle-outline"
              value={confirmPassword}
              onChangeText={setConfirmPassword}
            />

            <TouchableOpacity
              style={[styles.heroButton, submitting && styles.heroButtonDisabled]}
              onPress={handleChangePassword}
              disabled={submitting}
              activeOpacity={0.85}
            >
              {submitting ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.heroButtonText}>确 认 修 改</Text>
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
    backgroundColor: '#F8FBFC',
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
    backgroundColor: '#EEF5F7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  navTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#1E3A4C',
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
    color: '#1E3A4C',
    letterSpacing: -0.3,
  },
  headerHeroSub: {
    fontSize: 13,
    color: '#5A7A8A',
    marginTop: 4,
  },
  floatingCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 28,
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 24,
    ...Platform.select({
      ios: {
        shadowColor: '#4A90A4',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.08,
        shadowRadius: 20,
      },
      android: {
        elevation: 6,
      },
    }),
  },
  heroButton: {
    backgroundColor: Colors.primary,
    height: 50,
    borderRadius: 25,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 14,
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
