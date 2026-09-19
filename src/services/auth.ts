import { api, setToken, getToken, APIError, AUTH_EXPIRED_RESULT } from './api';

/**
 * 远程用户信息 (后端 /users/my.json 返回的 user 对象)
 */
export interface RemoteUser {
  id?: number;
  loginName?: string;
  nickname?: string;
  avatar?: string;
  email?: string;
  phone?: string;
  [key: string]: any;
}

interface LoginResponse {
  result: number;
  msg?: string;
  token: string;
  user: RemoteUser;
}

interface UserMyResponse {
  result: number;
  msg?: string;
  user: RemoteUser;
}

/**
 * 认证服务: 登录 / 用户信息 / 登出 / token 持久化
 */
class AuthService {
  private userCache: RemoteUser | null = null;

  get currentUser(): RemoteUser | null {
    return this.userCache;
  }

  get isLoggedIn(): boolean {
    return !!this.userCache;
  }

  /** 从本地恢复 token，并尝试拉取用户信息 */
  async restore(): Promise<RemoteUser | null> {
    const token = await getToken();
    if (!token) return null;
    try {
      return await this.fetchMe();
    } catch {
      await this.logout();
      return null;
    }
  }

  /** 邮箱 / 账号 + 密码登录 */
  async login(loginName: string, password: string): Promise<RemoteUser> {
    const rsp = await api.post<LoginResponse>('/users/login.json', {
      loginName,
      password,
    });
    if (!rsp.token) throw new APIError(-1, rsp.msg || '登录失败');
    await setToken(rsp.token);
    this.userCache = rsp.user || null;
    return rsp.user;
  }

  /** 拉取当前登录用户信息 */
  async fetchMe(): Promise<RemoteUser> {
    const rsp = await api.get<UserMyResponse>('/users/my.json');
    this.userCache = rsp.user || null;
    return rsp.user;
  }

  async logout() {
    this.userCache = null;
    await setToken(null);
  }
}

export const authService = new AuthService();
