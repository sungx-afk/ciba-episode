import React, { useState } from 'react';
import {
  View,
  TextInput,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInputProps,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../theme/colors';

interface AuthInputProps extends TextInputProps {
  label?: string;
  iconName?: keyof typeof Ionicons.glyphMap;
  isPassword?: boolean;
  error?: string;
  prefix?: string;
  rightAction?: React.ReactNode;
  onClear?: () => void;
}

export const AuthInput: React.FC<AuthInputProps> = ({
  label,
  iconName,
  isPassword = false,
  error,
  prefix,
  rightAction,
  value,
  onClear,
  style,
  ...rest
}) => {
  const [isFocused, setIsFocused] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  return (
    <View style={styles.container}>
      {label && <Text style={styles.label}>{label}</Text>}
      <View
        style={[
          styles.inputWrapper,
          isFocused && styles.inputWrapperFocused,
          !!error && styles.inputWrapperError,
        ]}
      >
        {iconName && (
          <Ionicons
            name={iconName}
            size={19}
            color={isFocused ? Colors.primary : '#8BA5B5'}
            style={styles.leftIcon}
          />
        )}

        {prefix && (
          <View style={styles.prefixContainer}>
            <Text style={styles.prefixText}>{prefix}</Text>
            <View style={styles.prefixDivider} />
          </View>
        )}

        <TextInput
          style={[styles.input, style]}
          placeholderTextColor="#8BA5B5"
          secureTextEntry={isPassword && !showPassword}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          value={value}
          autoCapitalize="none"
          {...rest}
        />

        {/* 密码明暗文切换 */}
        {isPassword && (
          <TouchableOpacity
            style={styles.actionBtn}
            onPress={() => setShowPassword(!showPassword)}
            activeOpacity={0.7}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons
              name={showPassword ? 'eye-outline' : 'eye-off-outline'}
              size={19}
              color="#8BA5B5"
            />
          </TouchableOpacity>
        )}

        {/* 清除按钮 */}
        {!isPassword && !!value && onClear && (
          <TouchableOpacity
            style={styles.actionBtn}
            onPress={onClear}
            activeOpacity={0.7}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="close-circle" size={17} color="#8BA5B5" />
          </TouchableOpacity>
        )}

        {/* 右侧插槽操作（如验证码按钮） */}
        {rightAction && <View style={styles.rightActionSlot}>{rightAction}</View>}
      </View>
      {!!error && <Text style={styles.errorText}>{error}</Text>}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginBottom: 14,
    width: '100%',
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: '#35566A',
    marginBottom: 6,
    marginLeft: 4,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EEF5F7',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'transparent',
    paddingHorizontal: 16,
    height: 52,
  },
  inputWrapperFocused: {
    backgroundColor: '#FFFFFF',
    borderColor: '#B7D3DB',
    ...Platform.select({
      ios: {
        shadowColor: Colors.primary,
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.12,
        shadowRadius: 8,
      },
      android: {
        elevation: 2,
      },
    }),
  },
  inputWrapperError: {
    borderColor: '#F8D4CB',
    backgroundColor: '#FDF3F1',
  },
  leftIcon: {
    marginRight: 10,
  },
  prefixContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 8,
  },
  prefixText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#35566A',
  },
  prefixDivider: {
    width: 1,
    height: 14,
    backgroundColor: '#C3D9E1',
    marginLeft: 8,
  },
  input: {
    flex: 1,
    minWidth: 0,
    fontSize: 16,
    color: '#1E3A4C',
    height: '100%',
    paddingVertical: 0,
    fontWeight: '500',
  },
  actionBtn: {
    padding: 4,
    marginLeft: 6,
  },
  rightActionSlot: {
    marginLeft: 8,
    flexShrink: 0,
  },
  errorText: {
    fontSize: 12,
    color: '#E76F51',
    marginTop: 4,
    marginLeft: 6,
  },
});
