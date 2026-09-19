import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

/**
 * 解析区块的彩色小标题，与 ciba-pc 单词研读页（CardPreview.vue）的分区标题一致：
 * 图标 + 12px 粗体标签，颜色按区块语义区分。
 */
interface SectionBadgeProps {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  color: string;
}

export const SectionBadge: React.FC<SectionBadgeProps> = ({ icon, label, color }) => (
  <View style={styles.sectionBadge}>
    <Ionicons name={icon} size={13} color={color} />
    <Text style={[styles.sectionBadgeText, { color }]}>{label}</Text>
  </View>
);

const styles = StyleSheet.create({
  sectionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 8,
  },
  sectionBadgeText: {
    fontSize: 12,
    fontWeight: '700',
  },
});
