import { api } from './api';
import { Word } from '../types';

/**
 * 后端 anki pack / note / card 模型
 */

export interface RemotePack {
  id: number;
  name: string;
  preview?: string;
  summary?: string;
  price?: number;
  card_count?: number;
  parent_id?: number;
  cat_id?: number;
  catId?: number;
  pack_type?: string;
  storeStatus?: number;
  status?: number;
  today_card_count?: number;
  today_learned_card_count?: number;
  remembered_card_count?: number;
  conf?: string;
  [key: string]: any;
}

export interface RemoteMenu {
  id: number;
  name: string;
  pid?: number;
  children?: RemoteMenu[];
  [key: string]: any;
}

export interface RemoteNote {
  id: number;
  name: string;
  data?: string; // JSON string
  mod_id?: string | number;
  package_id?: number;
  [key: string]: any;
}

export interface RemoteCard {
  id: number;
  package_id: number;
  type?: number; // 学习状态: 0 未学, 1/2/3 学习中, 4 已掌握
  menu_id?: number;
  note: RemoteNote;
  [key: string]: any;
}

/** note.data 解析后的结构 */
export interface NoteData {
  phonetic?: string;
  translation?: string;
  /** 词义辨析 / 用法区别 */
  word_difference?: string;
  /** 巧记联想 / 记忆技巧 */
  memory_method?: string;
  /** 场景例句 */
  sentences?: { english?: string; chinese?: string }[];
  ph_en_mp3?: string;
  ph_am_mp3?: string;
  [key: string]: any;
}

interface MarketPacksResponse {
  result: number;
  msg?: string;
  packs: RemotePack[];
  total?: number;
}

/** GET /anki/pack.json 响应 (我的词库 / 分类词库) */
interface PackListResponse {
  result: number;
  msg?: string;
  packs: RemotePack[];
  total?: number;
}

/** 拉取结果 */
export interface PackListResult {
  packs: RemotePack[];
  total: number;
}

export interface TodayWordsResult {
  words: Word[];
  total: number;
}

interface PackDetailResponse {
  result: number;
  msg?: string;
  pack: RemotePack;
}

interface LearnResponse {
  result: number;
  msg?: string;
  cards: RemoteCard[];
  total?: number;
  pack?: RemotePack;
  menu?: RemoteMenu[];
}

interface MenuResponse {
  result: number;
  msg?: string;
  menu: RemoteMenu[];
}

interface InstallResponse {
  result: number;
  msg?: string;
  pack?: RemotePack;
}

/**
 * 词库服务: 市场列表 / 安装 / 卡片加载 / 学习上报
 */
class PackLibrary {
  /** 英语词库分类 id (cibaen.com 上英语类目的 catId) */
  static readonly ENGLISH_CAT_ID = 4;
  static readonly STORE_APPROVED = 2;
  /** 分类背单词词库类型：只有该类型的词库才出现在「我的词库」中 */
  static readonly PACK_TYPE_QIAN_WEN_CAT = 'qian_wen_cat';

  /**
   * 我的词库: GET /anki/pack.json
   *  - parentId = 0 (不传) 时返回顶层词库，用于顶部切换
   *  - parentId = 父词库 id 时返回其下的分类词库
   */
  async fetchPackList(
    options: {
      start?: number;
      limit?: number;
      parentId?: number;
      /** 记住状态过滤: 0 未记住 / 1 进行中 / 2 已记住，数组会展开成 remember_type=0&remember_type=1 */
      rememberTypes?: number[];
    } = {}
  ): Promise<PackListResult> {
    const { start = 0, limit = 50, parentId, rememberTypes } = options;
    const query: Record<string, any> = { start, limit };
    if (parentId !== undefined && parentId !== null) {
      query.parentId = parentId;
    }
    if (rememberTypes && rememberTypes.length) {
      query.remember_type = rememberTypes;
    }
    const rsp = await api.get<PackListResponse>('/anki/pack.json', query);
    return { packs: rsp.packs || [], total: rsp.total || 0 };
  }

  /** 顶部切换用的顶层词库 (parentId = 0)，只保留 pack_type = qian_wen_cat */
  async fetchMyPacks(
    options: { start?: number; limit?: number } = {}
  ): Promise<PackListResult> {
    const { packs, total } = await this.fetchPackList({ ...options, parentId: 0 });
    const filtered = packs.filter(
      (p) => p.pack_type === PackLibrary.PACK_TYPE_QIAN_WEN_CAT
    );
    return { packs: filtered, total: filtered.length };
  }

  /** 某个父词库下的分类词库 (parentId = 父词库 id) */
  async fetchSubPacks(
    parentId: number,
    options: { start?: number; limit?: number; rememberTypes?: number[] } = {}
  ): Promise<PackListResult> {
    return this.fetchPackList({ ...options, parentId });
  }

  /**
   * 子词库全部单词列表（用于单词列表页）:
   * GET /anki/pack/{packId}/learn-by-menu.json?start=0&limit=100
   * 不带 type 参数时返回该词库下全部卡片
   */
  async fetchPackWords(
    packId: number,
    options: { start?: number; limit?: number; cat?: string; sub?: string } = {}
  ): Promise<TodayWordsResult> {
    const { start = 0, limit = 100, cat = '', sub = '' } = options;
    const rsp = await api.get<LearnResponse>(`/anki/pack/${packId}/learn-by-menu.json`, {
      start,
      limit,
    });
    const words = (rsp.cards || []).map((c) => this.mapCardToWord(c, cat, sub));
    return { words, total: rsp.total || 0 };
  }

  /**
   * 今日学习单词列表:
   * GET /anki/pack/{packId}/learn-by-menu.json?start=0&limit=50&type=0&type=1&type=2&type=3
   * types 为空数组时返回该词库下全部卡片
   */
  async fetchTodayWords(
    packId: number,
    options: {
      start?: number;
      limit?: number;
      types?: number[];
      cat?: string;
      sub?: string;
    } = {}
  ): Promise<TodayWordsResult> {
    const { start = 0, limit = 50, types = [0, 1, 2, 3], cat = '', sub = '' } = options;
    const rsp = await api.get<LearnResponse>(
      `/anki/pack/${packId}/learn-by-menu.json`,
      { start, limit, type: types }
    );
    const words = (rsp.cards || []).map((c) => this.mapCardToWord(c, cat, sub));
    return { words, total: rsp.total || 0 };
  }

  /**
   * 词库市场列表:
   * GET /anki/pack/in-store.json?start=0&limit=50&catId=4&storeStatus=2
   *     &sorters=[{"direction":"desc","column":"order_num"}]
   * 只保留 pack_type = qian_wen_cat 的分类背单词词库
   */
  async fetchMarketPacks(
    options: { start?: number; limit?: number; catId?: number; storeStatus?: number } = {}
  ): Promise<PackListResult> {
    const {
      start = 0,
      limit = 50,
      catId = PackLibrary.ENGLISH_CAT_ID,
      storeStatus = PackLibrary.STORE_APPROVED,
    } = options;
    const sorters = JSON.stringify([{ direction: 'desc', column: 'order_num' }]);
    const rsp = await api.get<MarketPacksResponse>('/anki/pack/in-store.json', {
      start,
      limit,
      catId,
      storeStatus,
      sorters,
    });
    const packs = (rsp.packs || []).filter(
      (p) => p.pack_type === PackLibrary.PACK_TYPE_QIAN_WEN_CAT
    );
    return { packs, total: packs.length };
  }

  /** 拉取词库详情 */
  async fetchPackDetail(packId: number): Promise<RemotePack> {
    const rsp = await api.get<PackDetailResponse>(`/anki/pack/${packId}.json`);
    return rsp.pack;
  }

  /** 拉取词库目录 (分类菜单) */
  async fetchPackMenus(packId: number): Promise<RemoteMenu[]> {
    try {
      const rsp = await api.get<MenuResponse>(`/anki/pack/${packId}/menu.json`);
      return rsp.menu || [];
    } catch {
      return [];
    }
  }

  /** 拉取词库卡片 (分页) */
  async fetchPackCards(
    packId: number,
    options: { start?: number; limit?: number; menuId?: number } = {}
  ): Promise<{ cards: RemoteCard[]; total: number }> {
    const { start = 0, limit = 200, menuId } = options;
    const path = menuId
      ? `/anki/pack/${packId}/learn-by-menu.json`
      : `/anki/pack/${packId}/learn.json`;
    const query: Record<string, any> = { start, limit };
    if (menuId) query.menuId = menuId;
    const rsp = await api.get<LearnResponse>(path, query);
    return { cards: rsp.cards || [], total: rsp.total || 0 };
  }

  /** 安装市场词库到我的词库 (前端用 qs.stringify 以 form-urlencoded 提交) */
  async installPack(sourceId: number, name: string): Promise<RemotePack | undefined> {
    const rsp = await api.postForm<InstallResponse>('/anki/pack/install.json', {
      sourceId,
      name,
    });
    return rsp.pack;
  }

  /**
   * 删除我的词库:
   * POST /anki/pack/{packId}.json  body: _method=DELETE (form-urlencoded)
   */
  async deletePack(packId: number): Promise<void> {
    await api.postForm(`/anki/pack/${packId}.json`, { _method: 'DELETE' });
  }

  /** 批量上报的单次条数上限，避免请求体过大 */
  private static readonly BATCH_LOG_CHUNK = 100;

  /** 上报学习结果 (type: 0=重来 1=困难 2=一般 3=容易 4=已掌握) */
  async markNoteRead(packageId: number, cardId: number, type: number): Promise<void> {
    try {
      // 前端用 qs.stringify 以 form-urlencoded 提交
      await api.postForm(`/anki/pack/${packageId}/learn/log.json`, {
        cardId,
        type,
        _method: 'PATCH',
      });
    } catch (e) {
      // 上报失败不阻断本地学习
      console.warn('markNoteRead failed', e);
    }
  }

  /**
   * 批量上报学习结果：
   * POST /anki/pack/{packageId}/learn/batch-log.json
   * body (JSON 数组): [{ "cardId": 1001, "type": 4 }, { "cardId": 1002, "type": 4 }]
   *
   * 一次标记整列表时会比较多，按 100 条一批发，保证请求体可控。
   * 与单条上报不同，这里会把失败抛给调用方：批量标记要让用户知道到底有没有成功。
   */
  async markNotesRead(
    packageId: number,
    items: { cardId: number; type: number }[]
  ): Promise<void> {
    if (!items.length) return;
    for (let i = 0; i < items.length; i += PackLibrary.BATCH_LOG_CHUNK) {
      await api.post(
        `/anki/pack/${packageId}/learn/batch-log`,
        items.slice(i, i + PackLibrary.BATCH_LOG_CHUNK)
      );
    }
  }

  /**
   * 把远程卡片转换为本地 Word 模型
   *  - word    <- note.name
   *  - meaning <- note.data.translation
   *  - note    <- 音标 + 助记 + 例句 + 辨析 (从 note.data 提取)
   */
  mapCardToWord(card: RemoteCard, cat = '', sub = ''): Word {
    const note = card.note || ({} as RemoteNote);
    let noteData: NoteData = {};
    if (note.data) {
      try {
        noteData = JSON.parse(note.data);
      } catch {
        // ignore
      }
    }

    const parts: string[] = [];
    if (noteData.phonetic) {
      parts.push(`[${noteData.phonetic}]`);
    }

    const pushText = (label: string, value: any) => {
      if (typeof value === 'string' && value.trim()) {
        parts.push(`${label}: ${value.trim()}`);
      }
    };

    pushText('助记', (noteData as any).memory_method);
    pushText('辨析', (noteData as any).word_difference);

    const sentences = (noteData as any).sentences;
    if (Array.isArray(sentences) && sentences.length) {
      const lines = sentences
        .filter((s: any) => s && (s.english || s.chinese))
        .map((s: any) => `• ${s.english || ''}${s.chinese ? `  ${s.chinese}` : ''}`);
      if (lines.length) {
        parts.push(`例句:\n${lines.join('\n')}`);
      }
    }

    // 其余标量字段兜底展示
    const extra = Object.entries(noteData)
      .filter(
        ([k]) =>
          ![
            'phonetic',
            'translation',
            'word',
            'memory_method',
            'word_difference',
            'sentences',
            'ph_en',
            'ph_am',
            'ph_en_mp3',
            'ph_am_mp3',
            'audio',
          ].includes(k)
      )
      .filter(([, v]) => typeof v === 'string' || typeof v === 'number')
      .map(([k, v]) => `${k}: ${v}`);
    if (extra.length) {
      parts.push(extra.join('\n'));
    }

    const sentenceList = Array.isArray(noteData.sentences)
      ? noteData.sentences
          .filter((s: any) => s && (s.english || s.chinese))
          .map((s: any) => ({
            english: String(s.english || '').trim(),
            chinese: String(s.chinese || '').trim(),
          }))
      : [];

    return {
      id: card.id,
      word: note.name || (card as any).name || '',
      meaning: noteData.translation || '',
      note: parts.join('\n'),
      cat,
      sub,
      packageId: card.package_id,
      // 服务端学习状态：0 未学 / 1、2、3 学习中 / 4 已记住
      type: typeof card.type === 'number' ? card.type : undefined,
      // 深度解析字段：背诵页按分区展示（词义辨析 / 巧记联想 / 场景例句）
      phonetic: String(noteData.phonetic || '').trim(),
      wordDifference: String((noteData as any).word_difference || '').trim(),
      memoryMethod: String((noteData as any).memory_method || '').trim(),
      sentences: sentenceList,
    };
  }

  /**
   * 加载整个词库的所有单词，按目录分类。
   * 策略: 先拉目录，再按目录拉卡片；若目录为空则直接拉全部卡片。
   */
  async loadWordsFromPack(packId: number): Promise<Word[]> {
    const menus = await this.fetchPackMenus(packId);
    const words: Word[] = [];

    if (menus.length > 0) {
      // 扁平化目录树，记录每个目录的父级名称
      const flatMenus: { id: number; name: string; parentName: string }[] = [];
      const walk = (list: RemoteMenu[], parentName = '') => {
        for (const m of list) {
          flatMenus.push({ id: m.id, name: m.name, parentName });
          if (m.children && m.children.length) {
            walk(m.children, m.name);
          }
        }
      };
      walk(menus);

      for (const m of flatMenus) {
        const cat = m.parentName || m.name;
        const sub = m.parentName ? m.name : '';
        let start = 0;
        // 每个目录最多拉 500 条，避免超大目录卡死
        for (let i = 0; i < 10; i++) {
          const { cards, total } = await this.fetchPackCards(packId, {
            start,
            limit: 200,
            menuId: m.id,
          });
          for (const c of cards) {
            words.push(this.mapCardToWord(c, cat, sub));
          }
          start += cards.length;
          if (cards.length === 0 || start >= total) break;
        }
      }
    } else {
      // 没有目录，直接拉全部卡片
      let start = 0;
      for (let i = 0; i < 20; i++) {
        const { cards, total } = await this.fetchPackCards(packId, { start, limit: 200 });
        for (const c of cards) {
          words.push(this.mapCardToWord(c, '全部', ''));
        }
        start += cards.length;
        if (cards.length === 0 || start >= total) break;
      }
    }

    // 去重 (按 card id)
    const seen = new Set<number>();
    return words.filter((w) => {
      if (seen.has(w.id)) return false;
      seen.add(w.id);
      return true;
    });
  }
}

export const packLibrary = new PackLibrary();
