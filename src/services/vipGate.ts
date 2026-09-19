import { PayApi } from './payApi';
import { fetchBookmarkedWords } from './bookmarkApi';

/**
 * 免费用户的使用额度限制（命中任意一条就需要升级会员）：
 *   - 已记住单词达到 20 个
 *   - 生词本单词超过 20 个
 *   - 注册时间超过 3 天（user.createDate）
 *
 * 会员状态与生词本数量都做短时缓存，避免每次点击都发请求；
 * 加入生词本、支付成功等会改变结果的场景调用 clearVipGateCache() 失效缓存。
 */

export const FREE_MASTERED_LIMIT = 20;
export const FREE_BOOKMARK_LIMIT = 20;
export const FREE_TRIAL_DAYS = 3;

export type VipBlockReason = 'mastered' | 'bookmark' | 'trial';

export interface VipGateResult {
  /** true 表示被限制，需要升级会员 */
  blocked: boolean;
  reason?: VipBlockReason;
  message?: string;
}

interface GateCache {
  at: number;
  isVip: boolean;
  bookmarkTotal: number | null;
}

const CACHE_TTL = 60 * 1000;
let cache: GateCache | null = null;

/** 会员状态或生词本数量变化后调用 */
export function clearVipGateCache() {
  cache = null;
}

/** createDate 可能是毫秒或秒级时间戳 */
function toTimestamp(value: unknown): number {
  const n = Number(value);
  if (!n) return 0;
  return n < 1e12 ? n * 1000 : n;
}

async function loadGateCache(): Promise<GateCache> {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_TTL) return cache;
  let isVip = false;
  try {
    const status = await PayApi.getVipStatus();
    isVip = !!status.isVip && !status.expired;
  } catch {
    isVip = false;
  }
  cache = { at: now, isVip, bookmarkTotal: null };
  return cache;
}

export async function checkVipGate(params: {
  /** 用户信息里的 vip 字段（1 表示会员），能省掉一次会员状态请求 */
  userVip?: number | string | null;
  /** 本地已记住的单词数 */
  masteredCount: number;
  /** 用户注册时间（user.createDate） */
  createDate?: number | string | null;
}): Promise<VipGateResult> {
  // 用户资料上已标记会员，直接放行
  if (Number(params.userVip) === 1) return { blocked: false };

  const state = await loadGateCache();
  if (state.isVip) return { blocked: false };

  // ① 已记住单词达到上限
  if (params.masteredCount >= FREE_MASTERED_LIMIT) {
    return {
      blocked: true,
      reason: 'mastered',
      message: `免费版最多记住 ${FREE_MASTERED_LIMIT} 个单词，升级 VIP 会员后可继续无限学习。`,
    };
  }

  // ② 生词本数量超过上限（需要请求，放在后面按需执行）
  let total = state.bookmarkTotal;
  if (total == null) {
    try {
      const rsp = await fetchBookmarkedWords({ start: 0, limit: 1 });
      total = Number(rsp?.total) || 0;
      if (cache) cache.bookmarkTotal = total;
    } catch {
      total = 0;
    }
  }
  if (total > FREE_BOOKMARK_LIMIT) {
    return {
      blocked: true,
      reason: 'bookmark',
      message: `生词本最多收藏 ${FREE_BOOKMARK_LIMIT} 个单词，升级 VIP 会员后可继续使用。`,
    };
  }

  // ③ 注册超过 3 天
  const created = toTimestamp(params.createDate);
  if (created > 0 && Date.now() - created > FREE_TRIAL_DAYS * 24 * 60 * 60 * 1000) {
    return {
      blocked: true,
      reason: 'trial',
      message: `新用户免费体验（${FREE_TRIAL_DAYS} 天）已结束，升级 VIP 会员后可继续使用。`,
    };
  }

  return { blocked: false };
}
