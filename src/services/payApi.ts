import { APIError, api } from './api';

/**
 * 会员 / 支付相关后端接口
 *
 * 接口一览：
 *  - GET  /users/check/status.json        会员状态
 *  - GET  /pay/price_tags.json            价签（套餐）列表
 *  - POST /pay/ios/verify.json            App Store 交易核销并开通会员（已上线）
 */

export interface VipStatus {
  /** 1 表示付费会员 */
  isVip: boolean;
  /** 会员到期时间，如 2027-09-15 00:00:00 */
  endDate?: string;
  /** 已过期 */
  expired?: boolean;
  /** 试用到期时间 */
  trailDate?: string;
}

/**
 * 后端价签（/pay/price_tags）
 *
 * 实际返回示例：
 * {"num":1,"name":"连续包月 VIP","appleProductId":"com.yugusoft.CibaEnglish.category.monthly","id":101,"type":2}
 *
 * 注意：即便接口里带了 price 也**不要展示**，
 * 界面金额一律用 StoreKit 的 displayPrice（Guideline 2.1 / 3.1.1）。
 */
export interface PriceTag {
  id: number;
  /** 价签名，如「连续包年 VIP」（非价格文案，可以展示） */
  name?: string;
  /** App Store Connect 产品 ID，客户端直接用它去 StoreKit 取价 */
  appleProductId?: string;
  /** 0 年 1 季 2 月 3 日 */
  type: number;
  /** 时长基数，配合 type 得到实际周期 */
  num?: number;
  /** 服务端价格（仅后台统计用，禁止展示） */
  price?: number;
  discount?: number;
}

/** 上报给服务端做核销的参数 */
export interface AppleVerifyPayload {
  /**
   * 必填：StoreKit 2 的交易 ID（expo-iap 的 purchase.id）。
   * 后端拿它调 App Store Server API v2 的交易查询接口核销。
   */
  transaction_id: string;
  /** 购买的产品 ID，如 com.yugusoft.CibaEnglish.category.monthly */
  product_id?: string;
  /** 原始交易 ID（续期不变，服务端按它去重） */
  original_transaction_id?: string;
  /** 交易时间（毫秒时间戳） */
  transaction_date?: number;
  /** 是否沙箱交易（开发包为 true） */
  is_sandbox?: boolean;
  /** 后端价签 id，来自 /pay/price_tags */
  tag_id?: number;
  /** 传给 StoreKit 的 appAccountToken，服务端可用它关联用户 */
  app_account_token?: string;
  /** base64 票据，当前后端不需要（走交易查询），保留字段备用 */
  receipt?: string;
}

export interface AppleVerifyResult {
  /** 1 表示已经是会员 */
  vip?: number;
  /** 开通/续期后的到期时间 */
  end_date?: string;
  [key: string]: any;
}

export const PayApi = {
  /** 查询当前账号的会员状态 */
  async getVipStatus(): Promise<VipStatus> {
    const res = await api.get('/users/check/status');
    return {
      isVip: Number(res?.status) === 1,
      endDate: res?.end_date || undefined,
      expired: Number(res?.expired) === 1,
      trailDate: res?.trail_date || undefined,
    };
  },

  /**
   * 会员套餐（价签）列表，tag_version 可让后端按端区分价格；
   * type=episode 用于后端按产品线（episode App）下发对应的价签。
   */
  async listPriceTags(tagVersion = 'ios_v1'): Promise<PriceTag[]> {
    const res = await api.get('/pay/price_tags', { tag_version: tagVersion, type: 'episode' });
    return Array.isArray(res?.list) ? res.list : [];
  },

  /**
   * 把 App Store 交易交给服务端核销并开通会员（后端已上线）。
   *
   * 请求：POST https://cibaen.com/api/pay/ios/verify.json
   *       query 由 api.ts 统一附带 plat=ios&app_id=ciba_ios_app&build=999999&token=xxx
   *
   * ⚠️ 参数必须走 **form-urlencoded**（或 query string）：
   *    后端用 request.getParameter 读取，实测传 JSON body 时 transaction_id 取不到，
   *    会一直报「transaction_id不能为空」。
   *
   * 参数：
   *   transaction_id          必填，StoreKit 2 交易 ID（expo-iap 的 purchase.id）
   *   product_id              产品 ID，如 com.yugusoft.CibaEnglish.category.monthly
   *   original_transaction_id 原始交易 ID，续期不变，服务端按它去重
   *   transaction_date        交易时间（毫秒）
   *   is_sandbox              1 沙箱 / 0 生产
   *   tag_id                  价签 id（/pay/price_tags 返回的 id）
   *   app_account_token       StoreKit 的 appAccountToken，用于关联用户
   *
   * 后端行为（实测）：用 transaction_id 调 App Store Server API v2 的交易查询接口核销，
   * 因此**不需要 base64 票据**（App Store 共享密钥那套 verifyReceipt 流程用不上）。
   *
   * 返回：
   *   成功 { result: 0 或 1, vip: 1, end_date: 'yyyy-MM-dd HH:mm:ss' }
   *   失败 { result: 8, msg: '苹果内购核销失败: ...' }  -> api.ts 会抛 APIError
   *
   * ⚠️ 实测发现：参数缺失时后端返回的是 result: 1，而 api.ts 把 1 视为成功，
   *    所以这里强制校验 transaction_id 必传；建议后端后续把参数错误也返回非 0/1 的码。
   *
   * ⚠️ 更坑的是：result 0/1 只代表「接口通了」，不代表会员真的开通了。
   *    「苹果核销失败 / transaction_id 取不到」等场景下后端同样返回 result: 1，
   *    但 vip 与 end_date 都是空的；上层不看业务字段就会误报「购买/恢复成功」。
   *    所以这里必须再按业务字段补一次成功校验。
   */
  async verifyAppleReceipt(payload: AppleVerifyPayload): Promise<AppleVerifyResult> {
    if (!payload.transaction_id) {
      throw new APIError(-1, '缺少 transaction_id，无法核销支付凭证');
    }
    let res: AppleVerifyResult;
    try {
      res = await api.postForm<AppleVerifyResult>('/pay/ios/verify', {
        transaction_id: payload.transaction_id,
        product_id: payload.product_id,
        original_transaction_id: payload.original_transaction_id,
        transaction_date: payload.transaction_date,
        is_sandbox: payload.is_sandbox ? 1 : 0,
        tag_id: payload.tag_id,
        app_account_token: payload.app_account_token,
        receipt: payload.receipt,
      });
    } catch (e: any) {
      // 网关异常 / 返回非 JSON 时给一句能定位的提示
      if (e instanceof APIError && e.result === -1) {
        throw new APIError(-1, `${e.message}（请确认 POST /pay/ios/verify.json 可用）`);
      }
      throw e;
    }

    // 真正核销成功一定带 vip: 1 或 end_date，两者都没有说明会员并没有开通
    const vipFlag = res?.vip === undefined || res?.vip === null ? undefined : Number(res.vip);
    const endDate = res?.end_date ? String(res.end_date) : '';
    if (vipFlag !== 1 && !endDate) {
      const resultCode = typeof res?.result === 'number' ? res.result : -1;
      console.warn('[PayApi] verify 未开通会员', JSON.stringify(res));
      // result === 1 时被 api.ts 当成成功放行了，这里必须补抛给上层，否则界面会误报成功
      throw new APIError(
        resultCode,
        res?.msg || '苹果支付核销失败，会员未开通（服务端未返回有效期）'
      );
    }

    return res;
  },
};
