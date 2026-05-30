// 协议家族（== backend.protocol 字段值）
export type Proto = 'oidc' | 'oauth2' | 'saml' | 'cas' | 'link';
export type ProtoFamily = Proto;

export const FAMILY_LABEL: Record<ProtoFamily, string> = {
  oidc:   'OpenID Connect',
  oauth2: 'OAuth 2.0',
  saml:   'SAML 2.0',
  cas:    'CAS',
  link:   '登录页跳转',
};

// 每个协议家族下可选的版本
export const PROTOCOL_VERSIONS: Record<ProtoFamily, { value: string; label: string }[]> = {
  oidc: [
    { value: 'OpenID_Connect_v1.0', label: 'OpenID Connect 1.0' },
  ],
  oauth2: [
    { value: 'OAuth_v2.0', label: 'OAuth v2.0' },
    { value: 'OAuth_v2.1', label: 'OAuth v2.1' },
  ],
  saml: [
    { value: 'SAML_v2.0', label: 'SAML 2.0' },
  ],
  cas: [
    { value: 'CAS_v3.0',      label: 'CAS 3.0' },
    { value: 'CAS_v2.0',      label: 'CAS 2.0' },
    { value: 'CAS_v1.0',      label: 'CAS 1.0' },
    { value: 'CAS_SAML_v1.1', label: 'CAS SAML 1.1' },
  ],
  link: [
    { value: '登录页跳转', label: '登录页跳转' },
  ],
};

export function defaultProtocolVersion(f: ProtoFamily) {
  return PROTOCOL_VERSIONS[f][0].value;
}

export const ALL_OIDC_CLAIMS = ['name', 'email', 'phone', 'roles', 'is_staff', 'department', 'position'];

// 各家族在 Step2 需要校验的字段
export const STEP2_FIELDS: Record<ProtoFamily, string[]> = {
  oauth2: [
    'redirect_uris', 'grant_types', 'subject_type', 'scope',
    'require_consent', 'require_pkce', 'access_token_ttl', 'refresh_token_ttl',
  ],
  oidc: [
    'redirect_uris', 'grant_types', 'subject_type', 'scope',
    'require_consent', 'require_pkce', 'access_token_ttl', 'refresh_token_ttl',
  ],
  saml: [
    'saml_entity_id', 'saml_acs_url', 'saml_binding', 'saml_nameid_format',
    'saml_signature_algorithm', 'saml_digest_algorithm', 'saml_validity_seconds',
  ],
  cas: ['cas_service', 'cas_user_attribute', 'cas_expires_seconds'],
  link: [], // 登录页跳转应用不需要协议配置，Step1 即完成全部表单
};

export type WizardValues = {
  client_name: string;
  protocol: Proto;
  protocol_version: string;
  logo_url?: string;
  login_url?: string;
  is_active: boolean;
  description?: string;

  redirect_uris?: string[];
  grant_types?: string[];
  subject_type?: string;
  scope?: string[];
  require_consent?: boolean;
  require_pkce?: boolean;
  access_token_ttl?: number;
  refresh_token_ttl?: number;
  id_token_ttl?: number;
  issue_refresh_token?: boolean;

  oidc_issuer?: string;
  oidc_audience?: string;
  oidc_id_token_signing_alg?: string;
  oidc_userinfo_response?: string;
  oidc_claims?: string[];

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

  cas_service?: string;
  cas_callback_url?: string;
  cas_user_attribute?: string;
  cas_expires_seconds?: number;
};

export const USERINFO_LABEL: Record<string, string> = {
  NORMAL: '普通 JSON',
  SIGNING: '签名 JWT',
  ENCRYPTION: '加密 JWT',
  SIGNING_ENCRYPTION: '签名并加密 JWT',
};

export function fmtSeconds(n?: number): string {
  if (!n) return '—';
  if (n % 86400 === 0) return `${n} 秒 (${n / 86400} 天)`;
  if (n % 3600 === 0) return `${n} 秒 (${n / 3600} 小时)`;
  if (n % 60 === 0) return `${n} 秒 (${n / 60} 分钟)`;
  return `${n} 秒`;
}
