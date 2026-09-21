import { api, APIError } from './api';
import { Word, WordSentenceItem } from '../types';

/**
 * 生词本列表获取（两步）
 *   1) /anki/pack/flag/default_movie_pack       -> 默认词库 id（缓存一次）
 *   2) /anki/pack/{packId}/learn-by-menu.json   -> 分页拿卡片
 */

export const BOOKMARK_PAGE_SIZE = 20;

/**
 * 生词本页面的三个分组：按服务端卡片 type 过滤。
 *  - 学习中：type = 0 未学 / 1、2、3 学习中
 *  - 已记住：type = 4
 *  - 全部：不带 type，服务端返回该词库下全部卡片
 */
export const BOOKMARK_LEARNING_TYPES = [0, 1, 2, 3];
export const BOOKMARK_MASTERED_TYPES = [4];
/** 复习待办：学过（1/2/3）但还没记住的卡片 */
export const BOOKMARK_REVIEW_TODO_TYPES = [1, 2, 3];

/** 首页「今日学习-生词本」开始背词时一次拉取的数量（与 web 端一致） */
export const NOTEBOOK_STUDY_LIMIT = 50;

const PACK_FLAG_PATH = '/anki/pack/flag/default_movie_pack';
const SORTERS = JSON.stringify([{ direction: 'desc', column: 'id' }]);
const MOVIE_TO_CARD_PATH = '/anki/movie2card';

/**
 * 把单词加进服务端生词本（默认「电影词库」）
 * POST /anki/movie2card.json  wordName=xxx&englishCaption=xxx
 *
 * 注意：后端每次调用都会新建一条 note + card，只支持新增、**没有删除接口**，
 * 所以「取消收藏」不能反过来调它，只能改本地状态。
 * 非会员词库满 100 张时后端会抛会员错误，由调用方提示用户。
 */
export async function addWordToBookmark(wordName: string, englishCaption?: string): Promise<void> {
  const name = String(wordName || '').trim();
  if (!name) {
    throw new APIError(-1, '单词为空，无法加入生词本');
  }
  await api.postForm(MOVIE_TO_CARD_PATH, {
    wordName: name,
    englishCaption: (englishCaption || '').trim() || name,
  });
}

export interface FetchBookmarkedParams {
  start?: number;
  limit?: number;
  /** 卡片状态过滤，数组会展开成 type=0&type=1...；不传表示该词库下全部卡片 */
  types?: number[];
}

export interface BookmarkedWordPage {
  words: Word[];
  total: number;
  hasMore: boolean;
}

let cachedPackId = 0;

/** 切换账号后调用：默认词库 id 是按账号的，必须失效重取 */
export function clearBookmarkPackCache() {
  cachedPackId = 0;
}

/** 1. 取默认词库 id */
export async function fetchDefaultMoviePackId(force = false): Promise<number> {
  if (!force && cachedPackId) return cachedPackId;

  const rsp = await api.get<any>(PACK_FLAG_PATH);
  const packId = Number(rsp?.pack?.id ?? rsp?.packId ?? rsp?.id ?? rsp?.referenceId);

  if (!Number.isFinite(packId) || packId <= 0) {
    throw new APIError(-1, '未获取到默认词库');
  }
  cachedPackId = packId;
  return packId;
}

/**
 * 卡片 -> Word
 * note.data 以 \u001F 分隔，字段顺序对齐后端 AnkiUtils.word2AnkiMovie：
 *   0 单词｜1 英音标｜2 英音音频｜3 美音标｜4 美音音频｜5 图片｜6 中文释义｜7 例句｜8 词频
 */
function cardToWord(card: any): Word {
  const note = card?.note || {};
  const f = String(note.data || '').split('\u001f');
  const wordName = String(note.name || card?.name || f[0] || '').trim();

  const phoneticEn = String(f[1] || '').trim();
  const phoneticAm = String(f[3] || '').trim();
  const phonetic = [phoneticEn && `英 /${phoneticEn}/`, phoneticAm && `美 /${phoneticAm}/`]
    .filter(Boolean)
    .join('  ');
  const meaning = (f[6] || '').replace(/\t*<br\s*\/?>/g, '\n').trim();
  const frequence = Number(f[8]) || 0;
  const times = Number(card?.times) || 0;

  // 例句：后端按「英文<br/>中文<br/>」逐个片段拼接，行首可能带 [sound:xxx]
  const exampleLines = String(f[7] || '')
    .replace(/\[sound:[^\]]+\]/g, '')
    .split(/<br\s*\/?>/i)
    .map((s) =>
      s
        .replace(/\s*\n\s*/g, ' ')
        .replace(/^[\s'"]+/, '')
        .replace(/[\s'"]+$/, '')
        .trim()
    )
    .filter(Boolean);

  const examples: string[] = [];
  const sentences: WordSentenceItem[] = [];
  for (let i = 0; i < exampleLines.length; i += 1) {
    const english = exampleLines[i];
    const next = exampleLines[i + 1];
    const chinese = next && /[\u4e00-\u9fa5]/.test(next) ? next : '';
    if (chinese) i += 1;
    // 收藏单词时没传 englishCaption，后端会把单词本身当例句存下来，
    // 这种「例句 == 单词」的脏数据要丢掉，否则卡片末尾会重复出现单词名
    if (english.toLowerCase() === wordName.toLowerCase()) continue;
    examples.push(chinese ? `${english}  ${chinese}` : english);
    sentences.push({ english, chinese });
  }

  const packageId = Number(card?.package_id) || Number(card?.packageId) || 0;
  const noteId = Number(note?.id ?? card?.note_id) || 0;

  return {
    id: Number(card?.id ?? note.id),
    ...(noteId ? { noteId } : {}),
    word: wordName,
    meaning,
    note: [phonetic, ...examples.map((e) => `· ${e}`)].filter(Boolean).join('\n'),
    cat: '',
    sub: '',
    phonetic,
    phoneticEn,
    phoneticAm,
    frequence,
    times,
    sentences,
    // 服务端学习状态：0 未学 / 1、2、3 学习中 / 4 已记住，列表据此分组展示
    type: typeof card?.type === 'number' ? card.type : undefined,
    // 学习结果需要按卡片所属词库上报，否则会落到当前选中的其它词库
    ...(packageId ? { packageId } : {}),
  };
}

/** 2. 分页拿生词本列表（types 为空表示不过滤） */
export async function fetchBookmarkedWords(
  params: FetchBookmarkedParams = {}
): Promise<BookmarkedWordPage> {
  const { start = 0, limit = BOOKMARK_PAGE_SIZE, types } = params;

  const packId = await fetchDefaultMoviePackId();
  const query: Record<string, any> = { start, limit, sorters: SORTERS };
  if (types && types.length) query.type = types;

  const rsp = await api.get<any>(`/anki/pack/${packId}/learn-by-menu.json`, query);

  const cards: any[] = Array.isArray(rsp?.cards) ? rsp.cards : [];
  const words = cards.map(cardToWord).filter((w) => w.word && w.id);
  const total = Number(rsp?.total) || start + words.length;

  return { words, total, hasMore: start + words.length < total };
}

/** 已缓存的生词本词库 id（学习结果上报要用），未取过时为 0 */
export function getCachedBookmarkPackId(): number {
  return cachedPackId;
}

export interface NotebookStats {
  packId: number;
  name: string;
  /** 每日学习目标：词库详情 conf.pack_btns_setting.day_limit */
  dayLimit: number;
  /** 今日已学习的生词数量（服务端 today_learned_card_count） */
  learnedToday: number;
  /** 生词本里的全部单词数量（card_count） */
  totalWords: number;
  /** 已记住的单词数量（服务端 remembered_card_count） */
  rememberedCount: number;
  /** 还没记住的单词数量 = 总数量 - 已记住 */
  notRemembered: number;
}

/** 从词库 conf 里解析每日学习目标：conf 是 JSON 字符串，day_limit 在 pack_btns_setting 下 */
function parseDayLimit(conf: unknown): number {
  let parsed: any = conf;
  if (typeof conf === 'string') {
    try {
      parsed = JSON.parse(conf);
    } catch {
      return 0;
    }
  }
  const raw = parsed?.pack_btns_setting?.day_limit ?? parsed?.day_limit;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * 首页「今日学习-生词本」卡片的三个统计数字:
 *   学习    <- conf.pack_btns_setting.day_limit（每日学习目标）
 *   已学习  <- today_learned_card_count（今日已学的生词数）
 *   未记住  <- card_count - remembered_card_count（展示成「未记住/总数量」）
 */
export async function fetchNotebookStats(force = false): Promise<NotebookStats> {
  const packId = await fetchDefaultMoviePackId(force);
  const rsp = await api.get<any>(`/anki/pack/${packId}.json`);
  const pack = rsp?.pack || {};
  const totalWords = Number(pack.card_count) || 0;
  const rememberedCount = Number(pack.remembered_card_count) || 0;

  return {
    packId,
    name: pack.name || '生词本',
    dayLimit: parseDayLimit(pack.conf),
    learnedToday: Number(pack.today_learned_card_count) || 0,
    totalWords,
    rememberedCount: Math.min(rememberedCount, totalWords),
    notRemembered: Math.max(0, totalWords - rememberedCount),
  };
}

/**
 * 首页「开始背词」的生词队列:
 * GET /anki/pack/{packId}/learn.json?start=0&limit=50&sorters=[{"direction":"desc","column":"id"}]
 * 由服务端按到期时间给出今日待学卡片，取回后直接进生词本复习页。
 */
export async function fetchNotebookStudyWords(
  options: { start?: number; limit?: number } = {}
): Promise<{ words: Word[]; packId: number }> {
  const { start = 0, limit = NOTEBOOK_STUDY_LIMIT } = options;
  const packId = await fetchDefaultMoviePackId();

  const rsp = await api.get<any>(`/anki/pack/${packId}/learn.json`, {
    start,
    limit,
    sorters: SORTERS,
  });

  const cards: any[] = Array.isArray(rsp?.cards) ? rsp.cards : [];
  const words = cards.map(cardToWord).filter((w) => w.word && w.id);
  return { words, packId };
}

/**
 * 生词本复习的评分 -> 服务端 type。
 * 与「分类词库背词页」的 SRS 评分（again/hard/good/easy）是两套东西：
 * 生词本复习只把用户选的档位原样上报，不参与分类词库的记忆算法。
 */
export const BOOKMARK_REVIEW_TYPE = {
  hard: 0, // 困难
  normal: 1, // 一般
  easy: 3, // 容易
  remembered: 4, // 已记住
} as const;

export type BookmarkGrade = keyof typeof BOOKMARK_REVIEW_TYPE;

/**
 * 上报生词本复习结果：只报给生词本词库（默认电影词库），
 * 不写本地 SRS 进度、不影响分类词库的掌握数统计。
 */
export async function reportBookmarkReview(wordId: number, type: number): Promise<void> {
  const packId = await fetchDefaultMoviePackId();
  // 直接上报：失败要抛给调用方提示用户（packLibrary.markNoteRead 会吞掉异常）
  await api.postForm(`/anki/pack/${packId}/learn/log.json`, {
    cardId: wordId,
    type,
    _method: 'PATCH',
  });
}

/**
 * 删除生词卡片：DELETE /anki/note/{noteId}.json
 * 与背诵页的「删除卡片」一致——按 note 删除，该 note 下的卡片一并移除。
 */
export async function deleteBookmarkNote(noteId: number): Promise<void> {
  if (!noteId) throw new APIError(-1, '缺少卡片信息，无法删除');
  await api.del(`/anki/note/${noteId}.json`);
}

/** 一天毫秒数，档位间隔用 */
const DAY_MS = 24 * 60 * 60 * 1000;

/** 单个复习档位（对应 pack.conf.pack_btns_setting.btns 的一项） */
export interface PackBtnSetting {
  /** 1 困难 / 2 一般 / 3 容易 / 4 已记住 */
  id: number;
  name: string;
  /** 间隔毫秒数：delay = 天数 * 一天 */
  delay: number;
  /** 间隔天数，web 端 conf 里与 delay 同时存一份 */
  day?: number | string;
}

export interface PackBtnsSetting {
  /** 每日添加新学习卡片数量 */
  day_limit: number;
  alert_time?: string;
  btns: PackBtnSetting[];
}

/** 与 web / 小程序一致的默认档位：困难 1 天 / 一般 3 天 / 容易 7 天 / 已记住立即 */
export const DEFAULT_PACK_BTNS_SETTING: PackBtnsSetting = {
  day_limit: 60,
  alert_time: '',
  btns: [
    { id: 1, name: '困难', delay: DAY_MS, day: 1 },
    { id: 2, name: '一般', delay: 3 * DAY_MS, day: 3 },
    { id: 3, name: '容易', delay: 7 * DAY_MS, day: 7 },
    { id: 4, name: '已记住', delay: 0, day: 0 },
  ],
};

/** 毫秒 -> 天数（设置面板里展示「N 天后出现」） */
export function delayToDays(delay: number): number {
  const days = Math.round((Number(delay) || 0) / DAY_MS);
  return days > 0 ? days : 0;
}

/** 天数 -> 毫秒 */
export function daysToDelay(days: number): number {
  const n = Number(days);
  return (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0) * DAY_MS;
}

/** 解析词库 conf（JSON 字符串）里的档位设置，缺字段用默认值补齐 */
export function parsePackBtnsSetting(conf: unknown): PackBtnsSetting {
  let parsed: any = conf;
  if (typeof conf === 'string') {
    try {
      parsed = JSON.parse(conf);
    } catch {
      parsed = null;
    }
  }
  const raw = parsed?.pack_btns_setting;
  if (!raw || !Array.isArray(raw.btns)) {
    return { ...DEFAULT_PACK_BTNS_SETTING, btns: DEFAULT_PACK_BTNS_SETTING.btns.map((b) => ({ ...b })) };
  }
  const btns = DEFAULT_PACK_BTNS_SETTING.btns.map((def) => {
    const hit = raw.btns.find((b: any) => Number(b?.id) === def.id);
    if (!hit) return { ...def };
    const delay = Number(hit.delay);
    const day = Number(hit.day);
    return {
      id: def.id,
      name: String(hit.name || def.name),
      delay: Number.isFinite(delay) && delay >= 0 ? delay : def.delay,
      day: Number.isFinite(day) && day >= 0 ? day : delayToDays(delay),
    };
  });
  const dayLimit = Number(raw.day_limit);
  return {
    day_limit:
      Number.isFinite(dayLimit) && dayLimit > 0 ? dayLimit : DEFAULT_PACK_BTNS_SETTING.day_limit,
    alert_time: raw.alert_time || '',
    btns,
  };
}

/** 把词库 conf（JSON 字符串）解析成对象，解析失败返回空对象 */
export function parsePackConf(conf: unknown): Record<string, any> {
  if (conf && typeof conf === 'object') return conf as Record<string, any>;
  if (typeof conf !== 'string' || !conf) return {};
  try {
    const parsed = JSON.parse(conf);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * 取词库详情：GET /anki/pack/{id}.json
 * 档位设置存在 pack.conf 里，保存时服务端要求回传整个词库对象，
 * 所以这里把 pack 整份留下来，PATCH 时再带上。
 */
export async function fetchBookmarkPackDetail(packId?: number): Promise<Record<string, any>> {
  const id = packId || (await fetchDefaultMoviePackId());
  const rsp = await api.get<any>(`/anki/pack/${id}.json`);
  const pack = rsp?.pack;
  return pack && typeof pack === 'object' ? { ...pack } : { id };
}

/**
 * 保存词库设置：PATCH /anki/pack/{id}.json
 * 必须回传整个词库对象（conf 里只改 pack_btns_setting），
 * 与 web 端 modifyPackage(this.pack) 一致；只传 id + conf 服务端会缺字段。
 */
export async function saveBookmarkPackDetail(pack: Record<string, any>): Promise<void> {
  const id = Number(pack?.id) || 0;
  if (!id) throw new APIError(-1, '词库信息不完整，无法保存设置');
  await api.patch(`/anki/pack/${id}.json`, pack);
}

/** 生词本「每日添加新学习卡片数量」的快捷档位，除此之外还可以填任意正整数 */
export const NOTEBOOK_DAY_LIMIT_OPTIONS = [20, 30, 50];
/** 每日学习目标的上限，避免填出离谱的数字 */
export const NOTEBOOK_DAY_LIMIT_MAX = 999;

/**
 * 读生词本每日学习目标：conf.pack_btns_setting.day_limit。
 * 与首页「今日学习-生词本」的「学习目标」、生词本学习页设置里的
 * 「每日添加新学习卡片数量」是同一个字段。
 */
export async function fetchNotebookDayLimit(): Promise<number> {
  const pack = await fetchBookmarkPackDetail();
  return parseDayLimit(parsePackConf(pack.conf));
}

/**
 * 保存生词本每日学习目标（每日添加新学习卡片数量）。
 * 先取最新词库详情再整包 PATCH，只改 conf.pack_btns_setting.day_limit，
 * conf 里的复习档位 btns、alert_time 以及 pack 的其它字段都原样带回，避免丢数据。
 */
export async function saveNotebookDayLimit(dayLimit: number): Promise<number> {
  const next = Math.max(1, Math.floor(Number(dayLimit) || 0));
  const pack = await fetchBookmarkPackDetail();
  const conf = parsePackConf(pack.conf);
  const prevSetting =
    conf.pack_btns_setting && typeof conf.pack_btns_setting === 'object' ? conf.pack_btns_setting : {};
  const nextConf = {
    ...conf,
    pack_btns_setting: { ...prevSetting, day_limit: next },
  };
  await saveBookmarkPackDetail({ ...pack, conf: JSON.stringify(nextConf) });
  return next;
}
