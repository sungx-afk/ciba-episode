import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../theme/colors';

/** 顶部背景渐隐的横条数量：12 段在 72dp 高的条里已经看不出条带 */
const FADE_STEPS = 12;
/** 渐隐从背景 30% 高度处开始，到最底部完全变成页面底色 */
const FADE_START = 0.3;
const FADE_BANDS = Array.from({ length: FADE_STEPS }, (_, i) => {
  const span = 1 - FADE_START;
  const from = FADE_START + span * (i / FADE_STEPS);
  const to = FADE_START + span * ((i + 1) / FADE_STEPS);
  return {
    key: `header-fade-${i}`,
    top: `${(from * 100).toFixed(4)}%` as `${number}%`,
    height: `${((to - from) * 100).toFixed(4)}%` as `${number}%`,
    opacity: Math.pow((i + 0.5) / FADE_STEPS, 1.15),
  };
});

interface HeaderProps {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  rightAction?: {
    icon: keyof typeof Ionicons.glyphMap;
    onPress: () => void;
    /** 实心主操作样式：给「添加」这类唯一主入口用，默认 false（只显示线性图标） */
    filled?: boolean;
    /** 实心样式下跟在图标后面的文字，如「添加」 */
    label?: string;
  };
}

/**
 * 通用顶部栏：与首页头图同源的山水背景打底，
 * 压一层米白柔光保证文字可读，下缘再渐隐溶进页面底色（不留硬边）。
 */
export const Header: React.FC<HeaderProps> = ({ title, subtitle, onBack, rightAction }) => {
  return (
    <View style={styles.container}>
      {/* 山水背景：铺满 + 柔光 + 底部渐隐 */}
      <View style={styles.backdrop} pointerEvents="none">
        <Image
          source={require('../assets/header-study.jpg')}
          style={styles.backdropImage}
          resizeMode="cover"
        />
        <View style={styles.backdropVeil} />
        <View style={styles.backdropFade}>
          {FADE_BANDS.map((band) => (
            <View
              key={band.key}
              style={[
                styles.backdropBand,
                { top: band.top, height: band.height, opacity: band.opacity },
              ]}
            />
          ))}
        </View>
      </View>

      <View style={styles.left}>
        {onBack ? (
          <TouchableOpacity style={styles.backButton} onPress={onBack} activeOpacity={0.7}>
            <Ionicons name="chevron-back" size={24} color={Colors.textPrimary} />
          </TouchableOpacity>
        ) : null}
        <View style={styles.titleWrap}>
          <Text style={styles.title} numberOfLines={1} ellipsizeMode="tail">
            {title}
          </Text>
          {subtitle ? (
            <Text style={styles.subtitle} numberOfLines={1} ellipsizeMode="tail">
              {subtitle}
            </Text>
          ) : null}
        </View>
      </View>
      {rightAction ? (
        rightAction.filled ? (
          <TouchableOpacity
            style={styles.rightButtonFilled}
            onPress={rightAction.onPress}
            activeOpacity={0.85}
          >
            <Ionicons name={rightAction.icon} size={18} color="#FFFFFF" />
            {rightAction.label ? (
              <Text style={styles.rightButtonLabel}>{rightAction.label}</Text>
            ) : null}
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={styles.rightButton}
            onPress={rightAction.onPress}
            activeOpacity={0.7}
          >
            <Ionicons name={rightAction.icon} size={22} color={Colors.primary} />
          </TouchableOpacity>
        )
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    height: 72,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    backgroundColor: Colors.background,
    overflow: 'hidden',
  },
  // 背景层：图片裁切、柔光、渐隐都收在这一层里，避免污染内容布局
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    overflow: 'hidden',
  },
  // 显式给宽高：Web 上只给 left/right 会退化成图片原始像素尺寸
  backdropImage: {
    width: '100%',
    height: '100%',
  },
  // 米白柔光：压住画面保证标题可读；新头图本身很亮，0.45 足够且能留住画面
  backdropVeil: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(248,247,242,0.45)',
  },
  backdropFade: {
    ...StyleSheet.absoluteFillObject,
  },
  backdropBand: {
    position: 'absolute',
    left: 0,
    right: 0,
    backgroundColor: Colors.background,
  },
  left: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    minWidth: 0,
  },
  backButton: {
    marginRight: 8,
    padding: 4,
    flexShrink: 0,
  },
  // flex:1 + minWidth:0 保证长标题只在自身区域内省略，不会挤走右侧图标
  titleWrap: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  subtitle: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  rightButton: {
    padding: 6,
    flexShrink: 0,
  },
  // 实心胶囊：主色底 + 白图标，比线性图标更能被当作「添加」入口
  rightButtonFilled: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 18,
    backgroundColor: Colors.primary,
    flexShrink: 0,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.28,
    shadowRadius: 6,
    elevation: 3,
  },
  rightButtonLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
