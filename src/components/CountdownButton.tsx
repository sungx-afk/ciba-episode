import React, { useState, useEffect, useRef } from 'react';
import {
  TouchableOpacity,
  Text,
  StyleSheet,
  ActivityIndicator,
  ViewStyle,
  TextStyle,
  Platform,
} from 'react-native';
import { Colors } from '../theme/colors';

interface CountdownButtonProps {
  onSend: () => Promise<boolean>;
  duration?: number;
  text?: string;
  style?: ViewStyle;
  textStyle?: TextStyle;
  disabled?: boolean;
}

export const CountdownButton: React.FC<CountdownButtonProps> = ({
  onSend,
  duration = 60,
  text = '获取验证码',
  style,
  textStyle,
  disabled = false,
}) => {
  const [seconds, setSeconds] = useState(0);
  const [loading, setLoading] = useState(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (seconds > 0) {
      timerRef.current = setTimeout(() => {
        setSeconds((prev) => prev - 1);
      }, 1000);
    } else if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [seconds]);

  const handlePress = async () => {
    if (seconds > 0 || loading || disabled) return;
    setLoading(true);
    try {
      const success = await onSend();
      if (success) {
        setSeconds(duration);
      }
    } catch (err) {
      console.warn('发送验证码异常', err);
    } finally {
      setLoading(false);
    }
  };

  const isCounting = seconds > 0;
  const isDisabled = disabled || isCounting || loading;

  return (
    <TouchableOpacity
      style={[
        styles.button,
        isDisabled && styles.buttonDisabled,
        style,
      ]}
      onPress={handlePress}
      disabled={isDisabled}
      activeOpacity={0.75}
    >
      {loading ? (
        <ActivityIndicator size="small" color={Colors.primary} />
      ) : (
        <Text
          style={[
            styles.text,
            isDisabled && styles.textDisabled,
            textStyle,
          ]}
        >
          {isCounting ? `${seconds}s` : text}
        </Text>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  button: {
    flexShrink: 0,
    paddingHorizontal: 10,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#EAF1EC',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 80,
    ...Platform.select({
      ios: {
        shadowColor: Colors.primary,
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.1,
        shadowRadius: 2,
      },
    }),
  },
  buttonDisabled: {
    backgroundColor: '#E8EDE7',
  },
  text: {
    fontSize: 12,
    fontWeight: '700',
    color: '#3B6848',
  },
  textDisabled: {
    color: '#9AA79F',
    fontWeight: '500',
  },
});
