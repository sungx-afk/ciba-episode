import { Platform, Linking } from 'react-native';

/**
 * App Store 内购（自动续期订阅）能力封装，基于 react-native-iap 12.x（StoreKit）。
 *
 * 为什么用 react-native-iap 而不是 expo-iap：
 *   expo-iap 现在只支持 Expo SDK 53+，而本项目是 SDK 52；且 expo-iap 依赖的
 *   openiap 这个 Swift pod 在 Xcode 15.3+ 下会编译失败
 *   （OpenIapStore.swift: error: reference to captured var 'self' in concurrently-executing code）。
 *   react-native-iap 12.16.4 不依赖 openiap，适配 SDK 52 / RN 0.76 / Xcode 15.4。
 *   等将来升级到 Expo SDK 53+ 再考虑迁移到 expo-iap。
 *
 * 使用前提：
 *  - 真机 + 自定义开发包（EAS Build / dev client），Expo Go 无法使用原生内购模块
 *  - App Store Connect 已创建订阅产品，产品 ID 由服务端 /pay/price_tags 下发
 *  - 沙箱测试账号：App Store Connect → 用户和访问 → 沙箱测试员
 *
 * 说明：这里用惰性 require 加载原生模块（不做静态 import），
 * 这样在 web / 非 iOS 平台不会触发原生模块初始化。
 */

/** App Store 的订阅管理页 */
const MANAGE_SUBSCRIPTION_URL = 'https://apps.apple.com/account/subscriptions';

export class IapError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'IapError';
    this.code = code;
  }
}

/** 用户取消支付（react-native-iap 的错误码） */
export const IAP_USER_CANCELLED = 'E_USER_CANCELLED';
/** 当前环境不支持内购 */
export const IAP_UNAVAILABLE = 'E_IAP_UNAVAILABLE';

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

export interface IapErrorInfo {
  code: string;
  message: string;
  /** 是否是用户主动取消支付 */
  userCancelled?: boolean;
}

let iapModule: any = null;
let connected = false;

/** 当前平台是否支持内购（目前只对接 iOS） */
export function isIapSupported(): boolean {
  return Platform.OS === 'ios';
}

function requireIap(): any {
  if (!isIapSupported()) {
    throw new IapError(IAP_UNAVAILABLE, '内购仅支持 iOS 客户端');
  }
  if (!iapModule) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    iapModule = require('react-native-iap');
  }
  return iapModule;
}

function mapProduct(p: any): IapProduct {
  return {
    productId: p?.productId || '',
    title: p?.title || '',
    description: p?.description || '',
    localizedPrice: p?.localizedPrice || '',
    // 拿不到币种时留空：默认成 CNY 会让上层误以为是人民币计价
    currency: p?.currency || '',
    price: typeof p?.price === 'string' ? Number(p.price) : Number(p?.price || 0) || 0,
  };
}

function mapPurchase(p: any): IapPurchase {
  return {
    productId: p?.productId || '',
    transactionId: p?.transactionId || p?.id,
    originalTransactionId: p?.originalTransactionIdentifierIOS || p?.transactionId,
    transactionReceipt: p?.transactionReceipt || '',
    transactionDate: p?.transactionDate,
    expirationDate: p?.expirationDateIOS,
    environment: p?.environmentIOS,
    raw: p,
  };
}

/** 建立与 App Store 的连接（可重复调用） */
export async function initIap(): Promise<void> {
  const Iap = requireIap();
  if (connected) return;
  await Iap.initConnection();
  connected = true;
}

/** 断开连接（离开页面时调用） */
export async function endIap(): Promise<void> {
  if (!connected) return;
  connected = false;
  try {
    await requireIap().endConnection();
  } catch {
    // 断开失败不影响页面
  }
}

/** 拉取自动续期订阅商品（取不到通常是产品 ID 未生效或协议未完成） */
export async function fetchSubscriptions(skus: string[]): Promise<IapProduct[]> {
  const Iap = requireIap();
  const list = await Iap.getSubscriptions({ skus });
  return ((list || []) as any[]).map(mapProduct).filter((p) => !!p.productId);
}

/**
 * 发起订阅购买。
 * 结果不会通过返回值给出，而是通过 onPurchaseUpdate / onPurchaseError 回调，
 * 这样即使 App 被切到后台支付也能收到结果。
 */
export async function buySubscription(sku: string, appAccountToken?: string): Promise<void> {
  const Iap = requireIap();
  await Iap.requestSubscription({
    sku,
    // 由业务侧在服务端核销后再结束事务，避免掉单
    andDangerouslyFinishTransactionAutomaticallyIOS: false,
    ...(appAccountToken ? { appAccountToken } : {}),
  });
}

/** 订阅购买成功回调，返回取消订阅的函数 */
export function onPurchaseUpdate(cb: (purchase: IapPurchase) => void): () => void {
  const Iap = requireIap();
  const sub = Iap.purchaseUpdatedListener((purchase: any) => {
    // 只处理已完成（purchased）的交易，pending（如需要家长批准）忽略
    if (purchase?.purchaseState && purchase.purchaseState !== 'purchased') return;
    if (!purchase?.productId) return;
    cb(mapPurchase(purchase));
  });
  return () => sub?.remove?.();
}

/** 订阅购买失败回调，返回取消订阅的函数 */
export function onPurchaseError(cb: (error: IapErrorInfo) => void): () => void {
  const Iap = requireIap();
  const sub = Iap.purchaseErrorListener((error: any) => {
    const code = String(error?.code ?? 'E_UNKNOWN');
    cb({
      code,
      message: error?.message || '购买失败，请稍后重试',
      userCancelled: code === IAP_USER_CANCELLED,
    });
  });
  return () => sub?.remove?.();
}

/** 是否是「用户取消支付」（这种错误不需要弹窗打扰用户） */
export function isUserCancelled(error: IapErrorInfo | any): boolean {
  return (
    !!error?.userCancelled ||
    String(error?.code ?? '') === IAP_USER_CANCELLED
  );
}

/** 结束事务：必须在服务端确认票据之后调用 */
export async function finishPurchase(purchase: IapPurchase): Promise<void> {
  if (!purchase?.raw) return;
  try {
    await requireIap().finishTransaction({ purchase: purchase.raw, isConsumable: false });
  } catch {
    // 结束失败可忽略，下次进入页面会再次补单
  }
}

/** 恢复当前 Apple ID 下可恢复的订单（用于「恢复购买」与补单） */
export async function fetchRestoreablePurchases(): Promise<IapPurchase[]> {
  const Iap = requireIap();
  const list = await Iap.getAvailablePurchases();
  return ((list || []) as any[]).map(mapPurchase).filter((p) => !!p.productId);
}

/** 打开 App Store 的订阅管理页，返回是否成功 */
export async function openManageSubscriptions(): Promise<boolean> {
  try {
    return await Linking.openURL(MANAGE_SUBSCRIPTION_URL).then(() => true);
  } catch {
    return false;
  }
}

/**
 * 是否沙箱交易。
 * 不能用 __DEV__ 判断：TestFlight / 正式包里用沙箱账号购买时 __DEV__ 也是 false，
 * 得看 StoreKit 返回的交易环境（拿不到时再退回 __DEV__）。
 */
export function isSandboxPurchase(purchase: IapPurchase): boolean {
  const env = (purchase?.environment || '').toLowerCase();
  if (env) return env === 'sandbox' || env === 'xcode';
  return __DEV__;
}

/**
 * 把用户 id 转成合法的 UUID 字符串。
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
