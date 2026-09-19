import { Word } from '../types';

/**
 * 单词的「深度解析」字段。
 * 服务端卡片的 note.data 是 JSON（phonetic / word_difference / memory_method / sentences），
 * 本地词库 words.json 里则是 note 文本的【记】【例】【辨】标记，
 * 这里统一成结构化数据，供背诵卡片分区展示。
 */

export interface WordSentence {
  english: string;
  chinese: string;
}

export interface WordExtras {
  /** 音标 */
  phonetic: string;
  /** 词义辨析 / 用法区别 */
  wordDifference: string;
  /** 巧记联想 / 记忆技巧 */
  memoryMethod: string;
  /** 场景例句 */
  sentences: WordSentence[];
}

function append(base: string, add: string): string {
  if (!add) return base;
  if (!base) return add;
  return `${base}\n${add}`;
}

/** 解析场景例句：服务端口语格式是 「• English 中文」 */
function parseBulletSentence(text: string): WordSentence {
  const body = text.replace(/^[•·]\s*/, '').trim();
  const match = body.match(/^(.*?\S)\s{2,}(.+)$/);
  if (match) return { english: match[1].trim(), chinese: match[2].trim() };
  // 只有一个 / 分隔的中英混排时，退回整句作为英文
  return { english: body, chinese: '' };
}

export function getWordExtras(word: Word): WordExtras {
  const result: WordExtras = {
    phonetic: (word.phonetic || '').trim(),
    wordDifference: (word.wordDifference || '').trim(),
    memoryMethod: (word.memoryMethod || '').trim(),
    sentences: Array.isArray(word.sentences)
      ? word.sentences
          .filter((s) => s && (s.english || s.chinese))
          .map((s) => ({ english: s.english || '', chinese: s.chinese || '' }))
      : [],
  };

  const note = word.note || '';
  if (!note) return result;

  for (const rawLine of note.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;

    // 本地词库：【记】/【例】/【辨】 这类带书名号标记的段落
    const bracket = line.match(/^【([^】]{1,8})】\s*(.*)$/);
    if (bracket) {
      const [, tag, content] = bracket;
      if (/记|巧|忆/.test(tag)) {
        result.memoryMethod = append(result.memoryMethod, content.trim());
      } else if (/辨|近|反|区|用/.test(tag)) {
        result.wordDifference = append(result.wordDifference, content.trim());
      } else if (/例|句/.test(tag)) {
        result.sentences.push({ english: content.trim(), chinese: '' });
      }
      continue;
    }

    // 服务端拼接文本：助记: xxx / 辨析: xxx
    const labeled = line.match(/^(助记|记忆|巧记|辨析|词义辨析|用法)\s*[:：]\s*(.+)$/);
    if (labeled) {
      const [, tag, content] = labeled;
      if (/辨析|用法/.test(tag)) {
        result.wordDifference = append(result.wordDifference, content.trim());
      } else {
        result.memoryMethod = append(result.memoryMethod, content.trim());
      }
      continue;
    }

    if (/^[•·]\s*/.test(line)) {
      result.sentences.push(parseBulletSentence(line));
      continue;
    }

    // 音标：[ɡleɪd] / 美 /ɡleɪd/ 英 /ɡleɪd/
    if (!result.phonetic && (/^\[[^\]]+\]$/.test(line) || /^(美|英)?\s*\/[^/]{1,40}\//.test(line))) {
      result.phonetic = line;
    }
  }

  return result;
}
