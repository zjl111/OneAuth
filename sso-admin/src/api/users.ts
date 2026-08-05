import request, { del, get, post, put, type PageData } from './request';

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
  lock_reason?: string;
  last_login: string | null;
  created_at: string;
  roles: Array<{ id: string; code: string; name: string }>;
  groups: Array<{ id: string; name: string }>;
}

export interface ImportRowError {
  row: number;
  username: string;
  reason: string;
}

export interface ImportExisting {
  row: number;
  username: string;
  nickname: string;
  email: string;
  phone: string;
}

export interface ImportUsersResult {
  total: number;
  success: number;
  failed: number;
  errors: ImportRowError[];
  existing?: ImportExisting[];
}

export const usersApi = {
  list: (params: Record<string, unknown>) => get<PageData<User>>('/users', params),
  create: (data: Partial<User> & { password: string; role_ids?: string[] }) =>
    post<User>('/users', data),
  detail: (id: string) => get<User>(`/users/${id}`),
  update: (id: string, data: Partial<User> & { role_ids?: string[] }) =>
    put<User>(`/users/${id}`, data),
  delete: (id: string) => del(`/users/${id}`),
  batchDelete: (ids: string[]) =>
    post<{ deleted: number; failed: string[] }>('/users/batch-delete', { ids }),
  resetPassword: (id: string, new_password: string) =>
    post(`/users/${id}/reset-password`, { new_password }),
  lock: (id: string, lock: boolean) => post(`/users/${id}/lock`, { lock }),
  setRoles: (id: string, role_ids: string[]) => put(`/users/${id}/roles`, { role_ids }),
  setGroups: (id: string, group_ids: string[]) => put(`/users/${id}/groups`, { group_ids }),
  // 批量导入：multipart 上传 .csv / .xlsx；走 axios 实例自动带 Authorization
  importFile: async (file: File, mode: 'create' | 'update' = 'create'): Promise<ImportUsersResult> => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('mode', mode);
    const r = await request.post('/users/import', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 120000,
    });
    return r.data.data;
  },
  // 批量更新已存在的用户
  updateExisting: (users: ImportExisting[]) =>
    post<{ updated: number; failed: number; errors: ImportRowError[] }>('/users/import/update-existing', { users }),
  // 模板下载地址（公开端点，浏览器直接 a[href] 即可下载）
  templateURL: (format: 'xlsx' | 'csv' = 'xlsx') =>
    `/api/v1/users/import/template${format === 'csv' ? '?format=csv' : ''}`,
};
