import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * 糍粑英语后端 API 客户端
 *
 * 后端响应统一规范:
 *  - result === 0       成功 (标准响应)
 *  - result === 1       部分接口返回 1 代表成功
 *  - result === -10001  token 失效 / 未登录
 *  - 其它非 0/1 值      业务错误，提示 msg
 *
 * 全局统一：
 *  - 基准路径: https://cibaen.com/api
 *  - 所有接口必须带 .json 后缀
 *  - 全局自动附带 query: plat=ios&app_id=ciba_ios_app
 */

export const BASE_URL = 'https://cibaen.com/api';
const APP_ID = 'ciba_ios_app';
const PLAT = 'ios';
/** 与 web / 小程序端保持一致的客户端版本号 */
const BUILD = '999999';

export const TOKEN_KEY = '@ciba_token';
export const USER_STORAGE_KEY = '@ciba_user_info';

export class APIError extends Error {
  result: number;
  constructor(result: number, msg: string) {
    super(msg || '网络请求失败');
    this.name = 'APIError';
    this.result = result;
  }
}

export const AUTH_EXPIRED_RESULT = -10001;

let tokenCache: string | null = null;

export async function getToken(): Promise<string> {
  if (tokenCache !== null) return tokenCache;
  const t = await AsyncStorage.getItem(TOKEN_KEY);
  tokenCache = t;
  return t || '';
}

export async function setToken(token: string | null) {
  tokenCache = token;
  if (token) {
    await AsyncStorage.setItem(TOKEN_KEY, token);
  } else {
    await AsyncStorage.removeItem(TOKEN_KEY);
  }
}

/**
 * 拆分路径与自带 query，并补齐 .json 后缀。
 *
 * ⚠️ 必须先把 `?` 后面的内容摘走，否则拼出来的 URL 会出现两个 `?`
 * （如 `/anki/pack/1.json?foo=bar?plat=ios`），后端会把整串当成 path 解析，
 * 既丢参数又和 add packId 这类路径对不上。
 */
function normalizePath(path: string): { path: string; query: string } {
  let p = path.startsWith('/') ? path : `/${path}`;
  let q = '';
  const qIdx = p.indexOf('?');
  if (qIdx >= 0) {
    q = p.slice(qIdx + 1);
    p = p.slice(0, qIdx);
  }
  if (!p.endsWith('.json')) {
    p = `${p}.json`;
  }
  return { path: p, query: q };
}

export function buildUrl(path: string, query?: Record<string, any>): string {
  const { path: normPath, query: pathQuery } = normalizePath(path);

  /** 同名参数保留多个值（后端需要 type=0&type=1&type=4），按出现顺序拼 */
  const pairs: Array<[string, string]> = [];
  const append = (key: string, value: any) => {
    if (value === undefined || value === null || value === '') return;
    if (Array.isArray(value)) {
      for (const item of value) append(key, item);
      return;
    }
    pairs.push([encodeURIComponent(key), encodeURIComponent(String(value))]);
  };
  const has = (key: string) => pairs.some(([k]) => k === key);

  // ① 路径自带 query（登录态经常这么透传），保持原顺序
  for (const seg of pathQuery.split('&')) {
    if (!seg) continue;
    const eq = seg.indexOf('=');
    if (eq < 0) continue;
    append(decodeURIComponent(seg.slice(0, eq)), decodeURIComponent(seg.slice(eq + 1)));
  }

  // ② 全局参数：plat/app_id/build/token 每个只允许出现一次，
  //    路径里已经带过就不再补，避免拼出 token=xxx&...&token=xxx
  if (!has('plat')) append('plat', PLAT);
  if (!has('app_id')) append('app_id', APP_ID);
  if (!has('build')) append('build', BUILD);
  if (tokenCache && !has('token')) append('token', tokenCache);

  // ③ 调用方 query：同样不允许覆盖上面四个全局参数
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if ((k === 'token' || k === 'plat' || k === 'app_id' || k === 'build') && has(k)) continue;
      append(k, v);
    }
  }

  const qs = pairs.map(([k, v]) => `${k}=${v}`).join('&');
  return `${BASE_URL}${normPath}${qs ? `?${qs}` : ''}`;
}

function buildFormBody(form?: Record<string, any>): string {
  if (!form) return '';
  return Object.entries(form)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
}

export interface Envelope<T = any> {
  result: number;
  msg?: string;
  token?: string;
  user?: UserInfo;
  [key: string]: any;
}

/** JSON 请求体：对象或数组（批量接口如 learn/batch-log 直接传数组） */
export type RequestBody = Record<string, any> | Array<Record<string, any>>;

/** 通用底层请求方法 */
async function request<T = any>(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  options?: {
    query?: Record<string, any>;
    body?: RequestBody;
    encoding?: 'json' | 'form';
  }
): Promise<T> {
  // 确保 token 已读取
  await getToken();

  const url = buildUrl(path, options?.query);
  const headers: Record<string, string> = {
    Accept: 'application/json',
  };
  let body: string | undefined;

  if (method !== 'GET' && options?.body !== undefined) {
    if (options.encoding === 'form') {
      headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
      body = buildFormBody(options.body as Record<string, any>);
    } else {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(options.body);
    }
  }

  try {
    const res = await fetch(url, { method, headers, body });
    const text = await res.text();
    let env: any;
    try {
      env = JSON.parse(text);
    } catch (e) {
      throw new APIError(-1, `服务器响应异常 (HTTP ${res.status})`);
    }

    // 后端规范：result === 0 或 1 代表成功
    if (env.result !== 0 && env.result !== 1) {
      throw new APIError(env.result, env.msg || '操作失败');
    }
    return env as T;
  } catch (err: any) {
    if (err instanceof APIError) throw err;
    throw new APIError(-1, err.message || '网络连接超时，请检查网络');
  }
}

export const api = {
  get: <T = any>(path: string, query?: Record<string, any>) =>
    request<T>('GET', path, { query }),
  post: <T = any>(path: string, body?: RequestBody) =>
    request<T>('POST', path, { body, encoding: 'json' }),
  patch: <T = any>(path: string, body?: RequestBody) =>
    request<T>('PATCH', path, { body, encoding: 'json' }),
  postForm: <T = any>(path: string, body?: Record<string, any>) =>
    request<T>('POST', path, { body, encoding: 'form' }),
  del: <T = any>(path: string) =>
    request<T>('DELETE', path),
};

/**
 * ------------------------------------------------------------------
 * 用户与认证相关类型及 API
 * ------------------------------------------------------------------
 */

export interface UserInfo {
  id: number | string;
  nickname: string;
  loginName?: string;
  mobile?: string;
  email?: string;
  avatarUrl?: string;
  sex?: number;
  vip?: number;
  due?: string | number;
  token?: string;
  [key: string]: any;
}

export interface ApiResponse<T = any> {
  result: number;
  msg?: string;
  token?: string;
  user?: UserInfo;
  [key: string]: any;
}

/** 包装给各界面调用的 AuthApi (返回 ApiResponse 对象，不抛出异常以便界面友好提示) */
export const AuthApi = {
  // 1. 发送短信验证码 (阿里云短信)
  sendMobileCode: async (mobile: string, scene = 'login'): Promise<ApiResponse> => {
    try {
      const res = await request<ApiResponse>('POST', '/verify_code/mobile/send.json', {
        query: { mobile, scene },
      });
      return { result: 0, msg: res.msg || '验证码发送成功' };
    } catch (err: any) {
      return { result: err.result ?? -1, msg: err.message || '短信验证码发送失败' };
    }
  },

  // 2. 发送邮箱验证码 (阿里云邮件)
  sendEmailCode: async (email: string, scene = 'register'): Promise<ApiResponse> => {
    try {
      const res = await request<ApiResponse>('POST', '/verify_code/email/code.json', {
        query: { email, scene },
      });
      return { result: 0, msg: res.msg || '邮箱验证码发送成功' };
    } catch (err: any) {
      return { result: err.result ?? -1, msg: err.message || '邮箱验证码发送失败' };
    }
  },

  // 3. 短信+验证码动态登录 (免密快速登录/自动建号)
  mobileLogin: async (mobile: string, code: string): Promise<ApiResponse> => {
    try {
      const res = await request<ApiResponse>('POST', '/users/mobile/login.json', {
        body: { mobile, code, plat: PLAT },
      });
      return res;
    } catch (err: any) {
      return { result: err.result ?? -1, msg: err.message || '登录失败' };
    }
  },

  // 4. 手机号注册
  registerByMobile: async (params: {
    mobile: string;
    code: string;
    password: string;
    nickname?: string;
  }): Promise<ApiResponse> => {
    try {
      const res = await request<ApiResponse>('POST', '/users/register/mobile.json', {
        body: { ...params, plat: PLAT },
      });
      return res;
    } catch (err: any) {
      return { result: err.result ?? -1, msg: err.message || '注册失败' };
    }
  },

  // 5. 邮箱注册
  registerByEmail: async (params: {
    email: string;
    code: string;
    password: string;
    nickname?: string;
  }): Promise<ApiResponse> => {
    try {
      const res = await request<ApiResponse>('POST', '/users/register/email.json', {
        body: { ...params, plat: PLAT },
      });
      return res;
    } catch (err: any) {
      return { result: err.result ?? -1, msg: err.message || '注册失败' };
    }
  },

  // 6. 账号/邮箱/手机号 + 密码登录
  emailLogin: async (account: string, password: string): Promise<ApiResponse> => {
    try {
      const res = await request<ApiResponse>('POST', '/users/login.json', {
        body: { loginName: account, password, plat: PLAT },
      });
      return res;
    } catch (err: any) {
      return { result: err.result ?? -1, msg: err.message || '账号或密码不正确' };
    }
  },

  // 7. 微信客户端授权登录 (真实接入后端 /users/oauth2/wechat/app/login.json)
  wechatAppLogin: async (wechatParams: {
    code?: string;
    appid?: string;
    openid?: string;
    nickname?: string;
    headimgurl?: string;
    sex?: number;
  }): Promise<ApiResponse> => {
    try {
      const body: Record<string, any> = {
        plat: PLAT,
        appid: wechatParams.appid || 'wx97f824fd700ab212',
      };
      if (wechatParams.code) {
        body.code = wechatParams.code;
      }
      if (wechatParams.openid) {
        body.openid = wechatParams.openid;
      }
      if (wechatParams.nickname) {
        body.nickname = wechatParams.nickname;
      }
      if (wechatParams.headimgurl) {
        body.headimgurl = wechatParams.headimgurl;
      }
      if (wechatParams.sex !== undefined) {
        body.sex = wechatParams.sex;
      }

      const res = await request<ApiResponse>('POST', '/users/oauth2/wechat/app/login.json', {
        body,
      });
      return res;
    } catch (err: any) {
      return { result: err.result ?? -1, msg: err.message || '微信授权登录失败' };
    }
  },

  // 8. Apple 极速授权登录 (调用免密码快捷用户通道)
  appleLogin: async (appleParams: {
    appleUserId: string;
    email?: string;
    fullName?: string;
    identityToken?: string;
  }): Promise<ApiResponse> => {
    try {
      // 通过微信/第三方统一接入通道为 Apple 用户注册或登录
      const res = await request<ApiResponse>('POST', '/users/oauth2/wechat/app/login.json', {
        body: {
          openid: `apple_${appleParams.appleUserId}`,
          nickname: appleParams.fullName || 'Apple用户',
          plat: PLAT,
          identity_token: appleParams.identityToken,
        },
      });
      return res;
    } catch (err: any) {
      return { result: err.result ?? -1, msg: err.message || 'Apple 登录失败' };
    }
  },

  // 9. 找回/重置密码
  resetPassword: async (params: {
    account: string;
    code: string;
    newPassword: string;
  }): Promise<ApiResponse> => {
    try {
      const res = await request<ApiResponse>('POST', '/users/password/reset.json', {
        body: params,
      });
      return res;
    } catch (err: any) {
      return { result: err.result ?? -1, msg: err.message || '重置密码失败' };
    }
  },

  // 10. 修改密码
  changePassword: async (params: {
    oldPassword?: string;
    newPassword: string;
  }): Promise<ApiResponse> => {
    try {
      const res = await request<ApiResponse>('POST', '/users/password/update.json', {
        body: params,
      });
      return res;
    } catch (err: any) {
      return { result: err.result ?? -1, msg: err.message || '修改密码失败' };
    }
  },

  // 11. 获取当前登录用户信息
  getMyInfo: async (): Promise<ApiResponse> => {
    try {
      const res = await request<ApiResponse>('GET', '/users/my.json');
      return res;
    } catch (err: any) {
      return { result: err.result ?? -1, msg: err.message || '获取用户信息失败' };
    }
  },
};
