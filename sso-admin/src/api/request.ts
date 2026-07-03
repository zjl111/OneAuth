import axios, { type AxiosResponse } from 'axios';
import { message } from 'antd';
import { useAuthStore } from '@/store/authStore';

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

/** 判断当前是否在公共页（登录/找回密码等），公共页不需要跳转 */
function isOnPublicPage(): boolean {
  return (
    location.pathname === '/' ||
    location.pathname.startsWith('/oauth/login') ||
    location.pathname.startsWith('/oauth/forgot-password') ||
    location.pathname.startsWith('/oauth/reset-password') ||
    location.pathname.startsWith('/status')
  );
}

function isAuthLoginRequest(url?: string): boolean {
  if (!url) return false;
  return url.includes('/auth/login');
}

/** 清除登录态并强制跳转到登录页 */
function bounceToLogin() {
  useAuthStore.getState().clear();
  if (isOnPublicPage()) return;
  // 一次性闸门：防止并发 401 反复触发跳转
  if ((window as any).__authBouncing) return;
  (window as any).__authBouncing = true;
  // 用硬跳转确保 SPA 路由不会拦截
  window.location.href = '/';
}

request.interceptors.response.use(
  (response) => response,
  async (error) => {
    const status = error?.response?.status;
    const originalRequest = error.config || {};
    const url = originalRequest.url as string | undefined;

    if (isAuthLoginRequest(url)) {
      return Promise.reject(error);
    }

    if (status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;
      const rt = useAuthStore.getState().refreshToken;

      // 没有 refresh token → 直接跳转登录
      if (!rt) {
        bounceToLogin();
        return Promise.reject(error);
      }

      // 有 refresh token → 尝试刷新
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
        // 刷新失败（refresh token 也过期了）→ 跳转登录
        bounceToLogin();
        return Promise.reject(error);
      }
      // 刷新成功 → 重试原请求
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
