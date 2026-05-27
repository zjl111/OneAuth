import { del, get, post, put, type PageData } from './request';

export interface OAuth2Client {
  id: string;
  client_id: string;
  client_secret?: string;
  client_name: string;
  client_type: string;
  description: string;
  redirect_uris: string[];
  grant_types: string[];
  response_types: string[];
  scope: string;
  logo_url: string;
  home_url: string;
  health_check_url: string;
  is_active: boolean;
  is_builtin: boolean;
  created_at: string;
  updated_at: string;
}

export const appsApi = {
  list: (params: Record<string, unknown>) => get<PageData<OAuth2Client>>('/apps', params),
  create: (data: Partial<OAuth2Client>) => post<OAuth2Client>('/apps', data),
  detail: (id: string) => get<OAuth2Client>(`/apps/${id}`),
  update: (id: string, data: Partial<OAuth2Client>) => put<OAuth2Client>(`/apps/${id}`, data),
  delete: (id: string) => del(`/apps/${id}`),
  rotateSecret: (id: string) => post<{ client_secret: string }>(`/apps/${id}/rotate-secret`),
  toggleStatus: (id: string) => post<OAuth2Client>(`/apps/${id}/toggle-status`),
};
