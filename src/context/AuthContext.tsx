import React, { createContext, useContext, useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { UserInfo, AuthApi, setToken as setApiToken } from '../services/api';

interface AuthContextType {
  user: UserInfo | null;
  token: string | null;
  isLoading: boolean;
  isLoggedIn: boolean;
  login: (user: UserInfo, token: string) => Promise<void>;
  logout: () => Promise<void>;
  updateUser: (updatedFields: Partial<UserInfo>) => Promise<void>;
  refreshUserInfo: () => Promise<void>;
}

const TOKEN_KEY = '@ciba_auth_token';
const USER_KEY = '@ciba_user_info';

const AuthContext = createContext<AuthContextType>({
  user: null,
  token: null,
  isLoading: true,
  isLoggedIn: false,
  login: async () => {},
  logout: async () => {},
  updateUser: async () => {},
  refreshUserInfo: async () => {},
});

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<UserInfo | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // 初始化从本地缓存读取登录状态
  useEffect(() => {
    const loadStorage = async () => {
      try {
        const storedToken = await AsyncStorage.getItem(TOKEN_KEY);
        const storedUser = await AsyncStorage.getItem(USER_KEY);
        if (storedToken && storedUser) {
          setToken(storedToken);
          await setApiToken(storedToken);
          setUser(JSON.parse(storedUser));
        }
      } catch (e) {
        console.warn('读取本地登录凭证失败', e);
      } finally {
        setIsLoading(false);
      }
    };
    loadStorage();
  }, []);

  // 登录或注册成功后保存状态
  const login = async (newUser: UserInfo, newToken: string) => {
    try {
      setUser(newUser);
      setToken(newToken);
      await setApiToken(newToken);
      await AsyncStorage.setItem(TOKEN_KEY, newToken);
      await AsyncStorage.setItem('@ciba_token', newToken);
      await AsyncStorage.setItem(USER_KEY, JSON.stringify(newUser));
      await AsyncStorage.setItem('@ciba_user_info', JSON.stringify(newUser));
    } catch (e) {
      console.warn('保存登录态失败', e);
    }
  };

  // 退出登录
  const logout = async () => {
    try {
      setUser(null);
      setToken(null);
      await setApiToken(null);
      await AsyncStorage.removeItem(TOKEN_KEY);
      await AsyncStorage.removeItem('@ciba_token');
      await AsyncStorage.removeItem(USER_KEY);
      await AsyncStorage.removeItem('@ciba_user_info');
    } catch (e) {
      console.warn('清空登录态失败', e);
    }
  };

  // 局部更新用户信息
  const updateUser = async (updatedFields: Partial<UserInfo>) => {
    if (!user) return;
    const merged = { ...user, ...updatedFields };
    setUser(merged);
    await AsyncStorage.setItem(USER_KEY, JSON.stringify(merged));
  };

  // 从服务端拉取最新用户信息
  const refreshUserInfo = async () => {
    if (!token) return;
    try {
      const res = await AuthApi.getMyInfo();
      if (res && (res.result === 0 || res.result === 1) && res.user) {
        setUser(res.user);
        await AsyncStorage.setItem(USER_KEY, JSON.stringify(res.user));
      }
    } catch (e) {
      console.warn('拉取最新用户信息失败', e);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isLoading,
        isLoggedIn: !!user && !!token,
        login,
        logout,
        updateUser,
        refreshUserInfo,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
