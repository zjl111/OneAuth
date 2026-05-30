import type { OAuth2Client } from '@/api/apps';
import { FAMILY_LABEL, PROTOCOL_VERSIONS, USERINFO_LABEL, fmtSeconds, type ProtoFamily } from './types';

// 收集供应用端使用的整套配置（用于复制 / 下载）
export function collectHandoff(
  family: ProtoFamily,
  isOIDC: boolean,
  submitted: OAuth2Client | null,
  v: any,
  discovery: Record<string, any> | null,
): Record<string, any> {
  const base: Record<string, any> = {
    应用名称: v.client_name,
    协议版本:
      PROTOCOL_VERSIONS[family].find((x) => x.value === v.protocol_version)?.label
      || FAMILY_LABEL[family],
    应用入口: v.login_url,
  };

  if (family === 'oidc' || family === 'oauth2') {
    Object.assign(base, {
      客户端ID: submitted?.client_id || '—',
      客户端密钥: submitted?.client_secret || '（已加密保存，仅创建时显示一次）',
      客户端认证方式: 'Client Secret Post',
      回调地址: (v.redirect_uris || []).join(', '),
      作用域: (v.scope || []).join(' '),
      用户标识字段: v.subject_type,
      PKCE: v.require_pkce ? '启用' : '未启用',
      许可确认: v.require_consent ? '强制' : '自动',
      授权方式: (v.grant_types || []).join(', '),
      AccessToken有效期: fmtSeconds(v.access_token_ttl),
      签发RefreshToken: v.issue_refresh_token ? '是' : '否',
      ...(v.issue_refresh_token ? { RefreshToken有效期: fmtSeconds(v.refresh_token_ttl) } : {}),
    });
    if (isOIDC) {
      Object.assign(base, {
        IDToken有效期: fmtSeconds(v.id_token_ttl),
        IDToken签名算法: v.oidc_id_token_signing_alg,
        UserInfo响应格式: USERINFO_LABEL[v.oidc_userinfo_response || 'NORMAL'] || v.oidc_userinfo_response,
        ...(v.oidc_issuer ? { Issuer覆盖: v.oidc_issuer } : {}),
        ...(v.oidc_audience ? { Audience覆盖: v.oidc_audience } : {}),
      });
    }
    if (discovery) {
      Object.assign(base, {
        Issuer: discovery.issuer,
        授权端点: discovery.authorization_endpoint,
        Token端点: discovery.token_endpoint,
        JWKS端点: discovery.jwks_uri,
        UserInfo端点: discovery.userinfo_endpoint,
        ...(discovery.end_session_endpoint ? { 注销会话端点: discovery.end_session_endpoint } : {}),
        Discovery地址: discovery.issuer + '/.well-known/openid-configuration',
      });
    }
  } else if (family === 'saml') {
    Object.assign(base, {
      EntityID_SP: v.saml_entity_id,
      ACS_URL: v.saml_acs_url,
      Audience: v.saml_audience || v.saml_entity_id,
      Issuer_IdP: v.saml_issuer,
      Binding: v.saml_binding,
      NameIDFormat: v.saml_nameid_format,
      用户标识字段:
        ({ original: '用户名', email: '邮箱', mobile: '手机号', user_id: '用户 UUID' } as Record<string, string>)[
          v.saml_nameid_convert
        ] || v.saml_nameid_convert,
      签名算法: v.saml_signature_algorithm,
      摘要算法: v.saml_digest_algorithm,
      加密断言: v.saml_encrypted ? '是' : '否',
      断言有效期: fmtSeconds(v.saml_validity_seconds),
    });
  } else if (family === 'cas') {
    Object.assign(base, {
      服务地址: v.cas_service,
      回调地址: v.cas_callback_url || v.cas_service,
      用户标识字段: v.cas_user_attribute,
      Ticket有效期: fmtSeconds(v.cas_expires_seconds),
    });
  }
  return base;
}

export async function copyHandoffText(
  family: ProtoFamily,
  isOIDC: boolean,
  submitted: OAuth2Client | null,
  v: any,
  discovery: Record<string, any> | null,
  message: any,
) {
  const obj = collectHandoff(family, isOIDC, submitted, v, discovery);
  const lines = Object.entries(obj).map(([k, val]) => `${k}: ${val ?? '—'}`);
  try {
    await navigator.clipboard.writeText(lines.join('\n'));
    message.success('已复制全部配置到剪贴板');
  } catch {
    message.error('复制失败');
  }
}

export function downloadHandoffJSON(
  family: ProtoFamily,
  submitted: OAuth2Client | null,
  v: any,
  discovery: Record<string, any> | null,
) {
  const obj = collectHandoff(family, family === 'oidc', submitted, v, discovery);
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${v.client_name || 'sso-app'}-${family}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
