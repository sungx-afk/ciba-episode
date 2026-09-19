import React, { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../theme/colors';
import { registerToastListener, ToastPayload } from '../utils/toast';

/** 显示时长 */
const DURATION = 1800;

/** 挂在 App 根部的 Toast 容器 */
export const ToastHost: React.FC = () => {
  const [payload, setPayload] = useState<ToastPayload | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(-10)).current;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    registerToastListener((next) => {
      if (timerRef.current) clearTimeout(timerRef.current);

      setPayload(next);
      opacity.setValue(0);
      translateY.setValue(-10);
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }),
        Animated.timing(translateY, { toValue: 0, duration: 180, useNativeDriver: true }),
      ]).start();

      timerRef.current = setTimeout(() => {
        Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: true }).start(() =>
          setPayload(null)
        );
      }, DURATION);
    });

    return () => {
      registerToastListener(null);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [opacity, translateY]);

  if (!payload) return null;

  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.wrap, { opacity, transform: [{ translateY }] }]}
    >
      <View style={styles.pill}>
        <Ionicons
          name={payload.type === 'success' ? 'checkmark-circle' : 'information-circle'}
          size={16}
          color="#FFFFFF"
        />
        <Text style={styles.text} numberOfLines={1}>
          {payload.message}
        </Text>
      </View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    top: 118,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 9999,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    maxWidth: '85%',
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 20,
    backgroundColor: Colors.dark,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 10,
    elevation: 6,
  },
  text: {
    flexShrink: 1,
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});
