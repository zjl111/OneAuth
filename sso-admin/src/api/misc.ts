import { del, get, post, put, type PageData } from './request';

export interface Department {
  id: string;
  name: string;
  parent_id: string | null;
  sort_order: number;
  description: string;
  children?: Department[];
}

export interface Role {
  id: string;
  name: string;
  code: string;
  description: string;
  is_builtin: boolean;
  permissions?: Permission[];
}

export interface Permission {
  id: string;
  name: string;
  code: string;
  type: string;
  parent_id: string | null;
  path: string;
  icon: string;
  sort_order: number;
  children?: Permission[];
}

export interface LoginLog {
  id: number;
  username: string;
  ip_address: string;
  user_agent: string;
  status: string;
  message: string;
  created_at: string;
}

export interface OperationLog {
  id: number;
  username: string;
  action: string;
  resource_type: string;
  description: string;
  ip_address: string;
  status: number;
  created_at: string;
}

export interface AccessLog {
  id: number;
  username: string;
  client_id: string;
  client_name: string;
  ip_address: string;
  created_at: string;
}

export interface SystemConfig {
  id: string;
  category: string;
  key: string;
  value: string;
  description: string;
}

export interface IPRule {
  id: string;
  type: 'black' | 'white';
  ip: string;
  note: string;
  created_at: string;
}

export const orgApi = {
  tree: () => get<Department[]>('/departments/tree'),
  list: () => get<Department[]>('/departments'),
  create: (data: Partial<Department>) => post<Department>('/departments', data),
  update: (id: string, data: Partial<Department>) => put<Department>(`/departments/${id}`, data),
  delete: (id: string) => del(`/departments/${id}`),
};

export const roleApi = {
  list: () => get<Role[]>('/roles'),
  create: (data: Partial<Role>) => post<Role>('/roles', data),
  update: (id: string, data: Partial<Role>) => put<Role>(`/roles/${id}`, data),
  delete: (id: string) => del(`/roles/${id}`),
  setPermissions: (id: string, permission_ids: string[]) =>
    put(`/roles/${id}/permissions`, { permission_ids }),
  permTree: () => get<Permission[]>('/permissions/tree'),
};

export const logApi = {
  login: (params: Record<string, unknown>) => get<PageData<LoginLog>>('/logs/login', params),
  operation: (params: Record<string, unknown>) =>
    get<PageData<OperationLog>>('/logs/operation', params),
  access: (params: Record<string, unknown>) => get<PageData<AccessLog>>('/logs/access', params),
};

export const configApi = {
  list: () => get<SystemConfig[]>('/configs'),
  byCategory: (cat: string) => get<SystemConfig[]>(`/configs/${cat}`),
  set: (items: Array<{ category: string; key: string; value: string }>) => put('/configs', items),
  uploadLogo: '/api/v1/configs/upload-logo',
};

export const accessApi = {
  list: () => get<IPRule[]>('/access/ip'),
  create: (data: Partial<IPRule>) => post<IPRule>('/access/ip', data),
  delete: (id: string) => del(`/access/ip/${id}`),
};

export const dashboardApi = {
  stats: () =>
    get<{
      user_count: number;
      login_today: number;
      app_count: number;
      abnormal_count: number;
      uptime_percent: number;
      monitor_total: number;
      active_users: number;
      active_window_minutes: number;
    }>('/dashboard/stats'),
  loginTrends: (days = 30) =>
    get<Array<{ date: string; count: number }>>('/dashboard/login-trends', { days }),
  appDistribution: (days = 30) =>
    get<Array<{ client_id: string; client_name: string; count: number }>>(
      '/dashboard/app-distribution',
      { days }
    ),
  recentOperations: (limit = 5) =>
    get<Array<OperationLog>>('/dashboard/recent-operations', { limit }),
  loginMethods: (days = 30) =>
    get<Array<{ method: string; count: number }>>('/dashboard/login-methods', { days }),
};

export const portalApi = {
  apps: () =>
    get<
      Array<{
        id: string;
        client_id: string;
        name: string;
        description: string;
        logo_url: string;
        home_url: string;
        is_builtin: boolean;
        is_favorite: boolean;
        granted: boolean;
      }>
    >('/portal/apps'),
};

export interface OnlineSession {
  sid: string;
  user_id: string;
  username: string;
  is_staff: boolean;
  ip: string;
  ua: string;
  auth_time: string;
  created_at: string;
  expires_at: string;
}

export const sessionsApi = {
  list: () => get<OnlineSession[]>('/sessions'),
  count: () => get<{ count: number }>('/sessions/count'),
  kick: (sid: string) => del(`/sessions/${sid}`),
};

export const monitorApi = {
  list: () =>
    get<
      Array<{
        id: string;
        client_id: string;
        enabled: boolean;
        health_check_url: string;
        timeout_ms: number;
        degraded_ms: number;
        maintenance: boolean;
        current_status: string;
        last_response_ms: number;
        last_probed_at: string | null;
      }>
    >('/monitor/apps'),
  update: (clientId: string, data: Record<string, unknown>) =>
    put(`/monitor/apps/${clientId}/config`, data),
  probe: (clientId: string) => post(`/monitor/apps/${clientId}/probe`),
  setMaintenance: (clientId: string, on: boolean, note: string) =>
    post(`/monitor/apps/${clientId}/maintenance`, { on, note }),
  delete: (clientId: string) => del(`/monitor/apps/${clientId}`),
  batchDelete: (client_ids: string[]) => post('/monitor/apps/batch-delete', { client_ids }),
  global: () => get<{ total: number; abnormal: number }>('/monitor/global'),
};
