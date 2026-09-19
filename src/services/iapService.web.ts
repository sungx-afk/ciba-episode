/**
 * 内购能力的 Web 端实现（仅 web 打包生效，iOS 仍走 iapService.ts 的 StoreKit）。
 *
 * 用途：商店 / 审核截图是在 `expo start --web` 里渲染的，浏览器里没有 StoreKit，
 * 订阅页会退化成「—」占位符（见 iapConfig 的合规要求：禁止写死金额）。
 * 这里允许在截图时通过 window.__CIBA_SHOT_IAP__ 注入商品数据，
 * 让订阅页按真实版式渲染出金额与折扣。
 *
 * 只在注入了该变量时才「支持内购」，正常 Web 访问保持不支持，不会误触支付。
 *
 * ⚠️ 不要写 `export * from './iapService'`：web 打包时 './iapService' 会被解析回
 *    本文件（metro 对 web 平台优先取 *.web.ts），形成自引用，PurchaseScreen 用到的
 *    appAccountTokenFromUserId 等导出会变成 undefined，页面直接崩。
 *    因此这里把订阅页需要的导出全部本地实现一遍。
 */

export interface IapProduct {
  productId: string;
  title: string;
  description: string;
  /** StoreKit 返回的本地化价格文案，界面上的金额必须用它，禁止自行拼接 */
  localizedPrice: string;
  currency: string;
  /** 价格数值，如 78 */
  price: number;
}

export interface IapPurchase {
  productId: string;
  /** StoreKit 2 的交易 ID，服务端核销用它 */
  transactionId?: string;
  /** 原始交易 ID（订阅续期时保持不变，服务端去重要用它） */
  originalTransactionId?: string;
  /** base64 票据（备用） */
  transactionReceipt: string;
  /** 交易时间（毫秒） */
  transactionDate?: number;
  /** 本次交易对应的到期时间（毫秒） */
  expirationDate?: number;
  /** 交易环境：Production / Sandbox / Xcode，用来判断沙箱单 */
  environment?: string;
  /** 原始对象，finishTransaction 需要它 */
  raw: any;
}

interface MockProduct {
  title?: string;
  description?: string;
  localizedPrice: string;
  currency: string;
  price: number;
}

/** { [productId]: { localizedPrice, currency, price, title } } */
function mockProducts(): Record<string, MockProduct> | null {
  if (typeof window === 'undefined') return null;
  return (window as any).__CIBA_SHOT_IAP__ || null;
}

export function isIapSupported(): boolean {
  return !!mockProducts();
}

export async function initIap(): Promise<void> {
  if (!mockProducts()) throw new Error('内购仅支持 iOS 客户端');
}

export async function endIap(): Promise<void> {}

export async function fetchSubscriptions(skus: string[]): Promise<IapProduct[]> {
  const mock = mockProducts();
  if (!mock) return [];
  return skus
    .map((productId) => ({ productId, p: mock[productId] }))
    .filter((x) => !!x.p)
    .map(({ productId, p }) => ({
      productId,
      title: p.title || '',
      description: p.description || '',
      localizedPrice: p.localizedPrice,
      currency: p.currency,
      price: Number(p.price) || 0,
    }));
}

export async function buySubscription(): Promise<void> {
  throw new Error('Web 端仅供截图，不能发起支付');
}

export function onPurchaseUpdate(): () => void {
  return () => {};
}

export function onPurchaseError(): () => void {
  return () => {};
}

export async function fetchRestoreablePurchases(): Promise<IapPurchase[]> {
  return [];
}

export async function finishPurchase(): Promise<void> {}

/** Web 端没有订阅管理页可跳，直接返回失败，调用方会给出提示 */
export async function openManageSubscriptions(): Promise<boolean> {
  return false;
}

export function isSandboxPurchase(): boolean {
  return false;
}

export function isUserCancelled(error: any): boolean {
  return !!error?.userCancelled || String(error?.code ?? '').toLowerCase().includes('cancel');
}

/**
 * 把用户 id 转成合法的 UUID 字符串（与 iapService.ts 保持一致）。
 * iOS 的 appAccountToken 必须是 UUID，服务端拿到票据后可用它把交易和用户对应起来。
 */
export function appAccountTokenFromUserId(userId: string | number): string {
  const src = String(userId || '0');
  let hex = '';
  for (let i = 0; i < src.length; i++) {
    hex += src.charCodeAt(i).toString(16).padStart(2, '0');
  }
  const raw = (hex + '0'.repeat(32)).slice(0, 32);
  return [
    raw.slice(0, 8),
    raw.slice(8, 12),
    raw.slice(12, 16),
    raw.slice(16, 20),
    raw.slice(20, 32),
  ].join('-');
}
