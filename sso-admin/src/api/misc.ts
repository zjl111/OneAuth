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
  province?: string;
  city?: string;
  isp?: string;
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

export interface UserGroup {
  id: string;
  name: string;
  description: string;
  created_at: string;
  member_count?: number;
}

export interface AppPermApp {
  id: string;
  client_id: string;
  client_name: string;
  logo_url: string;
  is_builtin: boolean;
  is_active: boolean;
  granted: boolean;
  grant_total: number;
  grant_users: number;
  grant_roles: number;
  grant_groups: number;
}

export interface AppGrant {
  id: string;
  client_id: string;
  principal_type: 'user' | 'role' | 'group';
  principal_id: string;
  principal_name: string;
  created_at: string;
}

export const appPermApi = {
  listApps: () => get<AppPermApp[]>('/app-perms/apps'),
  listGrants: (clientId: string) => get<AppGrant[]>(`/app-perms/apps/${clientId}/grants`),
  setGrants: (clientId: string, grants: Array<{ principal_type: string; principal_id: string }>) =>
    put(`/app-perms/apps/${clientId}/grants`, { grants }),
};

export const userGroupApi = {
  list: () => get<UserGroup[]>('/user-groups'),
  create: (data: { name: string; description?: string }) => post<UserGroup>('/user-groups', data),
  update: (id: string, data: { name: string; description?: string }) =>
    put<UserGroup>(`/user-groups/${id}`, data),
  delete: (id: string) => del(`/user-groups/${id}`),
  members: (id: string) =>
    get<Array<{ id: string; username: string; nickname: string; email: string | null; avatar: string }>>(
      `/user-groups/${id}/members`
    ),
  setMembers: (id: string, user_ids: string[]) => put(`/user-groups/${id}/members`, { user_ids }),
};

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

export interface LoginRule {
  id: string;
  name: string;
  priority: number;
  enabled: boolean;
  user_scope: 'all' | 'specific';
  user_ids: string[];
  ips: string[];
  time_mask: string;
  action: 'accept' | 'deny';
  created_at: string;
  updated_at: string;
}

export const loginRuleApi = {
  list: () => get<LoginRule[]>('/access/login-rules'),
  create: (data: Partial<LoginRule>) => post<LoginRule>('/access/login-rules', data),
  update: (id: string, data: Partial<LoginRule>) => put<LoginRule>(`/access/login-rules/${id}`, data),
  delete: (id: string) => del(`/access/login-rules/${id}`),
  toggle: (id: string) => post<{ enabled: boolean }>(`/access/login-rules/${id}/toggle`),
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
  regionTop10: (days = 30) =>
    get<Array<{ province: string; count: number }>>('/dashboard/region-top10', { days }),
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
