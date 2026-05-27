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
        // 已经在首页/未登录公共页 → 不再重定向，避免循环
        const onPublicPage =
          location.pathname === '/' ||
          location.pathname.startsWith('/oauth/login') ||
          location.pathname.startsWith('/oauth/forgot-password') ||
          location.pathname.startsWith('/oauth/reset-password');
        if (!onPublicPage) {
          redirectToLogin(location.pathname + location.search);
        }
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
    if (status && status !== 401) {
      message.error(msg);
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
