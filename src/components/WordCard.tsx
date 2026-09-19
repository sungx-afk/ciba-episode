import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Word, WordProgress } from '../types';
import { Colors, getCategoryColor } from '../theme/colors';
import { pronounceWord } from '../utils/speech';

interface WordCardProps {
  word: Word;
  progress?: WordProgress;
  accent?: 'en-US' | 'en-GB';
  onPress?: () => void;
  onToggleBookmark?: () => void;
  /** 标记为「已记住」，仅未掌握的单词展示该按钮 */
  onMarkMastered?: () => void;
  showMeaning?: boolean;
  /** 是否显示右上角收藏图标（生词本内不需要） */
  showBookmark?: boolean;
}

export const WordCard: React.FC<WordCardProps> = ({
  word,
  progress,
  accent = 'en-US',
  onPress,
  onToggleBookmark,
  onMarkMastered,
  showMeaning = true,
  showBookmark = true,
}) => {
  const isBookmarked = progress?.isBookmarked || false;
  const isMastered = progress?.status === 'mastered';
  const catColor = getCategoryColor(word.cat);

  const handlePronounce = (e: any) => {
    e.stopPropagation?.();
    pronounceWord(word.word, { accent });
  };

  const handleBookmark = (e: any) => {
    e.stopPropagation?.();
    onToggleBookmark?.();
  };

  const handleMarkMastered = (e: any) => {
    e.stopPropagation?.();
    onMarkMastered?.();
  };

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={styles.topRow}>
        <View style={styles.wordInfo}>
          <Text style={styles.wordText}>{word.word}</Text>
          <TouchableOpacity
            style={styles.pronounceBtn}
            onPress={handlePronounce}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="volume-medium-outline" size={18} color={Colors.primary} />
          </TouchableOpacity>
        </View>

        <View style={styles.actions}>
          {isMastered ? (
            <View style={styles.masteredBadge}>
              <Ionicons name="checkmark-circle" size={14} color={Colors.success} />
              <Text style={styles.masteredText}>已掌握</Text>
            </View>
          ) : null}

          {!isMastered && onMarkMastered ? (
            <TouchableOpacity
              style={styles.markBtn}
              onPress={handleMarkMastered}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityLabel="标记为已记住"
              activeOpacity={0.7}
            >
              <Ionicons name="checkmark" size={12} color={Colors.success} />
              <Text style={styles.markBtnText}>记住</Text>
            </TouchableOpacity>
          ) : null}

          {showBookmark && onToggleBookmark ? (
            <TouchableOpacity
              style={styles.bookmarkBtn}
              onPress={handleBookmark}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons
                name={isBookmarked ? 'bookmark' : 'bookmark-outline'}
                size={20}
                color={isBookmarked ? Colors.primary : Colors.textMuted}
              />
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      {/* 意群标签：cat / sub 都为空时整行不渲染 */}
      {word.cat || word.sub ? (
        <View style={styles.tagsRow}>
          {word.cat ? (
            <View style={[styles.catTag, { backgroundColor: catColor + '18' }]}>
              <View style={[styles.catDot, { backgroundColor: catColor }]} />
              <Text style={[styles.catText, { color: catColor }]} numberOfLines={1}>
                {word.cat}
              </Text>
            </View>
          ) : null}
          {word.sub ? (
            <View style={styles.subTag}>
              <Text style={styles.subText} numberOfLines={1}>
                {word.sub}
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {/* 释义 */}
      {showMeaning ? (
        <Text style={styles.meaningText} numberOfLines={2}>
          {word.meaning}
        </Text>
      ) : null}

      {/* 助记/例句 preview */}
      {word.note ? (
        <Text style={styles.noteText} numberOfLines={1}>
          {word.note.replace(/\n/g, ' ')}
        </Text>
      ) : null}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.card,
    borderRadius: 14,
    padding: 16,
    marginVertical: 6,
    marginHorizontal: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  wordInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  wordText: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.textPrimary,
    letterSpacing: 0.3,
  },
  pronounceBtn: {
    marginLeft: 8,
    padding: 4,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  masteredBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.success + '15',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    marginRight: 8,
  },
  masteredText: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.success,
    marginLeft: 3,
  },
  markBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: Colors.success + '15',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
    marginRight: 8,
  },
  markBtnText: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.success,
  },
  bookmarkBtn: {
    padding: 4,
  },
  tagsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    gap: 6,
    flexWrap: 'wrap',
    rowGap: 6,
  },
  catTag: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    flexShrink: 1,
    maxWidth: '100%',
  },
  catDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 5,
    flexShrink: 0,
  },
  catText: {
    fontSize: 11,
    fontWeight: '600',
    flexShrink: 1,
  },
  subTag: {
    backgroundColor: Colors.divider,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    flexShrink: 1,
    maxWidth: '100%',
  },
  subText: {
    fontSize: 11,
    color: Colors.textSecondary,
    flexShrink: 1,
  },
  meaningText: {
    fontSize: 15,
    color: Colors.textPrimary,
    marginTop: 8,
    lineHeight: 22,
  },
  noteText: {
    fontSize: 12,
    color: Colors.textMuted,
    marginTop: 6,
  },
});
