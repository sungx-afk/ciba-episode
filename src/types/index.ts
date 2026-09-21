export interface WordSentenceItem {
  english: string;
  chinese: string;
}

export interface Word {
  id: number;
  cat: string;
  sub: string;
  word: string;
  meaning: string;
  note: string;
  /** 远程 note id，删除卡片要按 note 删除（DELETE /anki/note/{id}.json） */
  noteId?: number;
  /** 远程词库 id，用于学习结果上报 */
  packageId?: number;
  /** 远程卡片学习状态：0 未学 / 1、2、3 学习中 / 4 已记住（已掌握） */
  type?: number;
  /** 音标（服务端卡片 note.data.phonetic） */
  phonetic?: string;
  /** 英式音标（生词本卡片 note.data 第 2 段） */
  phoneticEn?: string;
  /** 美式音标（生词本卡片 note.data 第 4 段） */
  phoneticAm?: string;
  /** 词频（COCA 词频，0 表示无数据） */
  frequence?: number;
  /** 该卡片累计复习次数（服务端 card.times） */
  times?: number;
  /** 词义辨析 / 用法区别（note.data.word_difference） */
  wordDifference?: string;
  /** 巧记联想 / 记忆技巧（note.data.memory_method） */
  memoryMethod?: string;
  /** 场景例句（note.data.sentences） */
  sentences?: WordSentenceItem[];
}

export type WordStatus = 'unlearned' | 'learning' | 'mastered';

export interface WordProgress {
  wordId: number;
  status: WordStatus;
  interval: number; // 间隔天数
  nextReviewTime: number; // 下次复习时间戳 (ms)
  lastReviewTime: number; // 上次学习时间戳
  reviewCount: number; // 复习次数
  lapseCount: number; // 遗忘次数
  isBookmarked: boolean; // 是否加入生词本
}

export interface ProgressState {
  progressMap: Record<number, WordProgress>;
  accent: 'en-US' | 'en-GB';
  autoPronounce: boolean;
  speechRate: number;
  lastActiveDate: string; // YYYY-MM-DD
  streakDays: number;
  todayLearnedIds: number[];
}

export interface LearningStats {
  totalWords: number;
  masteredCount: number;
  learningCount: number;
  unlearnedCount: number;
  dueTodayCount: number;
  todayLearnedCount: number;
  streakDays: number;
}
