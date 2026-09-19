import React, { useMemo } from 'react';
import { StyleProp, Text, TextStyle, View, StyleSheet } from 'react-native';

/**
 * 渲染后端返回的富文本片段。
 *
 * 服务端 word_difference / memory_method / summary 里可能带 <b>、<br>、<p> 等标签，
 * 直接塞进 <Text> 会把标签原文显示出来。这里把它们拆成「行」：
 *   - <b>xxx</b> / <strong>xxx</strong>  →  单独一行，加粗
 *   - <br> / <p>                          →  换行
 *   - 其余标签                            →  剥离
 */

export interface RichLine {
  text: string;
  bold: boolean;
}

const BOLD_TAG = /<(b|strong)[^>]*>([\s\S]*?)<\/\1>/gi;

/** 把富文本拆成带加粗标记的行 */
export function parseRichLines(raw: string): RichLine[] {
  if (!raw) return [];

  const source = String(raw)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?p[^>]*>/gi, '\n');

  const lines: RichLine[] = [];
  const pushBlock = (block: string, bold: boolean) => {
    if (!block) return;
    for (const rawLine of block.split('\n')) {
      const line = rawLine
        .replace(/<[^>]*>/g, '')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        // HTML 缩进会带来多余空白，压缩成单个空格
        .replace(/\s{2,}/g, ' ')
        .trim();
      if (line) lines.push({ text: line, bold });
    }
  };

  BOLD_TAG.lastIndex = 0;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = BOLD_TAG.exec(source)) !== null) {
    pushBlock(source.slice(lastIndex, match.index), false);
    pushBlock(match[2], true);
    lastIndex = BOLD_TAG.lastIndex;
  }
  pushBlock(source.slice(lastIndex), false);

  return lines;
}

interface RichTextProps {
  text: string;
  style?: StyleProp<TextStyle>;
  boldStyle?: StyleProp<TextStyle>;
}

export const RichText: React.FC<RichTextProps> = ({ text, style, boldStyle }) => {
  const lines = useMemo(() => parseRichLines(text), [text]);

  if (!lines.length) return null;

  return (
    <View style={styles.wrap}>
      {lines.map((line, index) => (
        <Text key={index} style={[style, line.bold && styles.bold, line.bold && boldStyle]}>
          {line.text}
        </Text>
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    gap: 4,
  },
  bold: {
    fontWeight: '800',
  },
});
