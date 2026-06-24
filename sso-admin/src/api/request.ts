import axios, { type AxiosResponse } from 'axios';
import { message } from 'antd';
import { useAuthStore } from '@/store/authStore';
import { redirectToLogin } from '@/utils/redirect';

const request = axios.create({
  baseURL: '/api/v1',
  timeout: 15000,
  withCredentials: true,
});

request.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  // 写操作（POST/PUT/PATCH/DELETE）= 用户主动行为；后端据此刷新 last_active_at。
  // GET（包括 status overview、dashboard 等被动轮询）不带，不会"假活跃"导致永远不掉线。
  // refresh 自身是被动的，也不带。
  const method = (config.method || 'get').toLowerCase();
  if (method !== 'get' && method !== 'head' && !config.url?.includes('/auth/refresh')) {
    config.headers['X-User-Action'] = '1';
  }
  return config;
});

let refreshing: Promise<string | null> | null = null;

request.interceptors.response.use(
  (response) => response,
  async (error) => {
    const status = error?.response?.status;
    const originalRequest = error.config || {};

    if (status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;
      const rt = useAuthStore.getState().refreshToken;
      const bounce = () => {
        useAuthStore.getState().clear();
        // 已经在公共页 → 不重定向，避免循环
        const onPublicPage =
          location.pathname === '/' ||
          location.pathname.startsWith('/oauth/login') ||
          location.pathname.startsWith('/oauth/forgot-password') ||
          location.pathname.startsWith('/oauth/reset-password');
        if (onPublicPage) return;
        // 防止并发 401 反复触发跳转（一次性闸门，每个 SPA 实例只允许跳一次）
        if ((window as any).__authBouncing) return;
        (window as any).__authBouncing = true;
        // CAS / OAuth logout 之后回跳门户但 session 已失效会导致死循环，
        // 这里只回首页（带 return_to），首页 useEffect 判定 isAuthenticated=false 后会弹登录框
        redirectToLogin(location.pathname + location.search);
      };
      if (!rt) {
        bounce();
        return Promise.reject(error);
      }
      if (!refreshing) {
        refreshing = useAuthStore
          .getState()
          .refresh()
          .catch(() => null)
          .finally(() => {
            refreshing = null;
          });
      }
      const newToken = await refreshing;
      if (!newToken) {
        bounce();
        return Promise.reject(error);
      }
      originalRequest.headers.Authorization = `Bearer ${newToken}`;
      return request(originalRequest);
    }

    const msg = error?.response?.data?.message || error.message || '请求失败';
    const code = error?.response?.data?.code;
    if (status && status !== 401) {
      // captcha_required (4090) 是登录页要 catch 处理的"半成功"信号，不要弹全局 toast
      if (code !== 4090) {
        message.error(msg);
      }
    }
    return Promise.reject(error);
  }
);

export interface ApiResponse<T = unknown> {
  code: number;
  message: string;
  data: T;
}

export interface PageData<T> {
  total: number;
  items: T[];
}

export async function get<T = unknown>(url: string, params?: Record<string, unknown>): Promise<T> {
  const r: AxiosResponse<ApiResponse<T>> = await request.get(url, { params });
  return r.data.data;
}

export async function post<T = unknown>(url: string, body?: unknown): Promise<T> {
  const r: AxiosResponse<ApiResponse<T>> = await request.post(url, body);
  return r.data.data;
}

export async function put<T = unknown>(url: string, body?: unknown): Promise<T> {
  const r: AxiosResponse<ApiResponse<T>> = await request.put(url, body);
  return r.data.data;
}

export async function del<T = unknown>(url: string): Promise<T> {
  const r: AxiosResponse<ApiResponse<T>> = await request.delete(url);
  return r.data.data;
}

export default request;
