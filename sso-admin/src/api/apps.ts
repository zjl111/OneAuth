import { del, get, post, put, type PageData } from './request';

export interface OAuth2Client {
  id: string;
  client_id: string;
  client_secret?: string;
  client_name: string;
  client_type: string;
  protocol?: string;
  protocol_version?: string;
  description: string;

  // 通用
  logo_url: string;
  home_url: string;
  login_url?: string;
  health_check_url: string;
  is_active: boolean;
  is_builtin: boolean;

  // OAuth2 / OIDC
  redirect_uris: string[];
  grant_types: string[];
  response_types: string[];
  scope: string;
  subject_type?: string;
  require_pkce?: boolean;
  require_consent?: boolean;
  access_token_ttl?: number;
  refresh_token_ttl?: number;
  id_token_ttl?: number;
  issue_refresh_token?: boolean;

  // OIDC
  oidc_issuer?: string;
  oidc_audience?: string;
  oidc_id_token_signing_alg?: string;
  oidc_userinfo_response?: string;
  oidc_claims?: string[];

  // SAML 2.0
  saml_entity_id?: string;
  saml_acs_url?: string;
  saml_audience?: string;
  saml_issuer?: string;
  saml_binding?: string;
  saml_nameid_format?: string;
  saml_nameid_convert?: string;
  saml_signature_algorithm?: string;
  saml_digest_algorithm?: string;
  saml_encrypted?: boolean;
  saml_validity_seconds?: number;
  saml_certificate?: string;

  // CAS
  cas_service?: string;
  cas_callback_url?: string;
  cas_user_attribute?: string;
  cas_expires_seconds?: number;
  cas_return_attributes?: boolean;

  access_policy?: 'all' | 'assigned' | 'none';
  visible_in_portal?: boolean;
  allow_idp_initiated?: boolean;
  allow_sp_initiated?: boolean;
  grants?: Array<{ principal_type: string; principal_id: string; principal_name?: string }>;

  created_at: string;
  updated_at: string;
}

export const appsApi = {
  list: (params: Record<string, unknown>) => get<PageData<OAuth2Client>>('/apps', params),
  create: (data: Partial<OAuth2Client>) => post<OAuth2Client>('/apps', data),
  detail: (id: string) =>
    get<{
      client: OAuth2Client;
      grants: Array<{ principal_type: string; principal_id: string; principal_name?: string }>;
    }>(`/apps/${id}`),
  update: (id: string, data: Partial<OAuth2Client>) => put<OAuth2Client>(`/apps/${id}`, data),
  delete: (id: string) => del(`/apps/${id}`),
  batchDelete: (ids: string[]) => post<{ deleted: number; failed: string[] }>('/apps/batch-delete', { ids }),
  rotateSecret: (id: string) => post<{ client_secret: string }>(`/apps/${id}/rotate-secret`),
  toggleStatus: (id: string) => post<OAuth2Client>(`/apps/${id}/toggle-status`),
};
