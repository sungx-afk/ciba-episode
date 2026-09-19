import type { PriceTag } from '../services/payApi';

/**
 * iOS 内购（自动续期订阅）配置
 *
 * ⚠️ 合规要求（App Store Guideline 2.1 / 3.1.1）：
 *   这里**不允许**出现任何写死的金额文案（货币符号 + 数字），
 *   界面上展示的金额必须来自 StoreKit 返回的 displayPrice。
 *   因此下面的套餐只保留「周期」等非价格信息。
 *
 * 套餐列表（档位、名称、App Store 产品 ID、价签 id）统一由服务端
 * /pay/price_tags.json?tag_version=ios_v1 下发，见 priceTagToPlan。
 * 这里的 FALLBACK_PLANS 只在接口不可用时才兜底展示。
 */

export interface MemberPlan {
  /** 套餐标识：服务端价签用 tagId，兜底套餐用本地 id */
  id: string;
  /** App Store Connect 产品 ID（优先取服务端的 appleProductId） */
  sku: string;
  /** 周期文案（非价格信息，可以写） */
  label: string;
  /** 周期月数，用于排序 / 换算折扣比例 */
  months: number;
  /** 后端价签 id，上报票据时带给服务端 */
  tagId?: number;
  /** 服务端价签名（非价格文案），作为副标题展示 */
  tagName?: string;
}

/** 服务端价签 type：0 年 1 季 2 月 3 日 */
export function describeDuration(type: number, num: number): string {
  switch (type) {
    case 0:
      return `${num} 年`;
    case 1:
      return `${num} 个季度`;
    case 2:
      return `${num} 个月`;
    case 3:
      return `${num} 天`;
    default:
      return `${num} 期`;
  }
}

/** 价签折算成月数：0 年 1 季 2 月 3 日 */
export function tagMonths(type: number, num: number): number {
  switch (type) {
    case 0:
      return 12 * num;
    case 1:
      return 3 * num;
    case 2:
      return num;
    case 3:
      return num / 30;
    default:
      return num;
  }
}

/**
 * 服务端价签 -> 本地套餐。
 * 没有 appleProductId 时按周期回退到本地兜底套餐的 sku。
 */
export function priceTagToPlan(tag: PriceTag): MemberPlan | null {
  if (!tag) return null;
  const num = Number(tag.num || 1) || 1;
  const months = tagMonths(tag.type, num);
  const fallback = FALLBACK_PLANS.find((p) => p.months === months);
  const sku = tag.appleProductId || fallback?.sku;
  if (!sku) return null;
  return {
    id: String(tag.id),
    sku,
    label: describeDuration(tag.type, num),
    months,
    tagId: tag.id,
    tagName: tag.name,
  };
}

/**
 * 兜底套餐：仅在 /pay/price_tags 接口不可用时使用。
 * sku 与服务端下发的 appleProductId 保持一致。
 */
export const FALLBACK_PLANS: MemberPlan[] = [
  {
    id: 'yearly',
    sku: 'com.yugusoft.CibaEnglish.category.yearly',
    label: '1 年',
    months: 12,
    tagId: 102,
  },
  {
    id: 'monthly',
    sku: 'com.yugusoft.CibaEnglish.category.monthly',
    label: '1 个月',
    months: 1,
    tagId: 101,
  },
];

/** 兜底套餐的产品 ID 列表 */
export const FALLBACK_SKUS: string[] = FALLBACK_PLANS.map((p) => p.sku);

/** 请求服务端价签时使用的版本 */
export const PRICE_TAG_VERSION = 'ios_v1';
