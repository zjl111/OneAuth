import { get, post, put } from './request';

export interface UserInfo {
  id: string;
  username: string;
  nickname: string;
  email: string;
  phone?: string;
  avatar: string;
  position?: string;
  is_staff: boolean;
  is_active: boolean;
  roles: string[];
}

export interface LoginResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user: UserInfo;
  permissions: string[];
}

export interface CaptchaStatusResponse {
  enabled: boolean;
  required: boolean;
  threshold: number;
  failed_attempts?: number;
  remaining_attempts?: number;
  locked?: boolean;
  lock_minutes?: number;
  lock_until?: string;
}

export const authApi = {
  login: (data: { username: string; password: string; remember?: boolean; captcha_ticket?: string }) =>
    post<LoginResponse>('/auth/login', data),
  captchaStatus: (username: string) =>
    get<CaptchaStatusResponse>('/auth/captcha/status', { username }),
  syncSsoSession: () => post('/auth/sso-session'),
  logout: () => post('/auth/logout'),
  refresh: (refresh_token: string) =>
    post<{ access_token: string; refresh_token: string; expires_in: number }>('/auth/refresh', {
      refresh_token,
    }),
  profile: () => get<{ user: UserInfo; permissions: string[] }>('/auth/profile'),
  updateProfile: (data: { nickname?: string; email?: string; position?: string; avatar?: string }) =>
    put<{ user: UserInfo; permissions: string[] }>('/auth/profile', data),
  changePassword: (data: { old_password: string; new_password: string }) =>
    post('/auth/change-password', data),
  // 企业微信登录是否启用
  getWeComStatus: () => get<{ enabled: boolean }>('/auth/wecom/status'),
  // 个人企业微信绑定（自服务）
  getWeComBinding: () => get<{ wecom_userid: string }>('/profile/wecom'),
  bindWeCom: (wecom_userid: string) => put<{ wecom_userid: string }>('/profile/wecom', { wecom_userid }),
  forgotPassword: (email: string) => post<{ message: string }>('/auth/forgot-password', { email }),
  verifyResetToken: (token: string) => get<{ email: string }>('/auth/reset-password/verify', { token }),
  resetPassword: (data: { token: string; new_password: string }) =>
    post('/auth/reset-password', data),
  uploadAvatarPath: '/api/v1/auth/avatar', // multipart 上传地址
};
