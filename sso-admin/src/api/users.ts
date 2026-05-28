import { del, get, post, put, type PageData } from './request';

export interface User {
  id: string;
  username: string;
  nickname: string;
  email: string | null;
  phone: string | null;
  avatar: string;
  position?: string;
  gender?: string;
  employee_no?: string;
  domain_account?: string;
  user_type?: 'internal' | 'external' | string;
  hire_status?: 'active' | 'resigned' | string;
  sort_order?: number;
  department_id: string | null;
  department?: { id: string; name: string };
  is_active: boolean;
  is_staff: boolean;
  is_locked: boolean;
  last_login: string | null;
  created_at: string;
  roles: Array<{ id: string; code: string; name: string }>;
}

export const usersApi = {
  list: (params: Record<string, unknown>) => get<PageData<User>>('/users', params),
  create: (data: Partial<User> & { password: string; role_ids?: string[] }) =>
    post<User>('/users', data),
  detail: (id: string) => get<User>(`/users/${id}`),
  update: (id: string, data: Partial<User> & { role_ids?: string[] }) =>
    put<User>(`/users/${id}`, data),
  delete: (id: string) => del(`/users/${id}`),
  resetPassword: (id: string, new_password: string) =>
    post(`/users/${id}/reset-password`, { new_password }),
  lock: (id: string, lock: boolean) => post(`/users/${id}/lock`, { lock }),
  setRoles: (id: string, role_ids: string[]) => put(`/users/${id}/roles`, { role_ids }),
};
