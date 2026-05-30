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

export const authApi = {
  login: (data: { username: string; password: string; remember?: boolean }) =>
    post<LoginResponse>('/auth/login', data),
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
  forgotPassword: (email: string) => post<{ message: string }>('/auth/forgot-password', { email }),
  verifyResetToken: (token: string) => get<{ email: string }>('/auth/reset-password/verify', { token }),
  resetPassword: (data: { token: string; new_password: string }) =>
    post('/auth/reset-password', data),
  uploadAvatarPath: '/api/v1/auth/avatar', // multipart 上传地址
};
