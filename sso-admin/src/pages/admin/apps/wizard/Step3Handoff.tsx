import { Alert, Descriptions, Input, Tag, Typography, App as AntdApp } from 'antd';
import { CheckCircleFilled, CopyOutlined, InfoCircleOutlined } from '@ant-design/icons';
import type { OAuth2Client } from '@/api/apps';
import { FAMILY_LABEL, PROTOCOL_VERSIONS, fmtSeconds, type ProtoFamily } from './types';

// 带复制按钮的只读 KV 行
function HandoffRow({
  label,
  value,
  password,
}: {
  label: string;
  value: string;
  password?: boolean;
}) {
  const { message } = AntdApp.useApp();
  const copyIcon = (
    <CopyOutlined
      style={{ cursor: 'pointer', color: '#94a3b8' }}
      onClick={() => {
        navigator.clipboard.writeText(value || '');
        message.success('已复制');
      }}
    />
  );
  return (
    <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10, gap: 10 }}>
      <div style={{ width: 160, color: '#64748b', fontSize: 13, flexShrink: 0 }}>{label}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        {password ? (
          <Input.Password value={value || ''} readOnly visibilityToggle addonAfter={copyIcon} />
        ) : (
          <Input value={value || ''} readOnly addonAfter={copyIcon} />
        )}
      </div>
    </div>
  );
}

export default function Step3Handoff({
  family,
  isOIDC,
  isNewly,
  summary,
  submitted,
  discovery,
}: {
  family: ProtoFamily;
  isOIDC: boolean;
  isNewly: boolean;          // 新建模式刚拿到后端 secret，可见
  summary: any;
  submitted: OAuth2Client | null;
  discovery: Record<string, any> | null;
}) {
  const isOAuth = family === 'oidc' || family === 'oauth2';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Alert
        type="success"
        showIcon
        icon={<CheckCircleFilled />}
        message="配置已生成，以下信息请提供给应用侧进行 SSO 接入配置"
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,2fr) minmax(0,1fr)', gap: 16 }}>
        {/* 应用信息 */}
        <div style={{ border: '1px solid #eef0f5', borderRadius: 12, padding: '20px 24px', background: '#fff' }}>
          <div style={{ fontWeight: 600, color: '#1d2c5b', marginBottom: 14 }}>应用信息</div>
          <Descriptions column={2} size="small" colon labelStyle={{ color: '#64748b', width: 90 }}>
            <Descriptions.Item label="协议类型">{FAMILY_LABEL[family]}</Descriptions.Item>
            <Descriptions.Item label="应用入口">
              {summary.login_url || '—'}
            </Descriptions.Item>
            <Descriptions.Item label="协议版本">
              {PROTOCOL_VERSIONS[family].find((x) => x.value === summary.protocol_version)?.label}
            </Descriptions.Item>
            <Descriptions.Item label="状态">
              {summary.is_active ? <Tag color="green">启用</Tag> : <Tag>禁用</Tag>}
            </Descriptions.Item>
            <Descriptions.Item label="应用名称">{summary.client_name}</Descriptions.Item>
            <Descriptions.Item label="描述">{summary.description || '—'}</Descriptions.Item>
          </Descriptions>
        </div>

        {/* 接入说明 */}
        <div style={{ border: '1px solid #bfdbfe', borderRadius: 12, padding: '20px 24px', background: '#eff6ff' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#1d4ed8', fontWeight: 600, marginBottom: 12 }}>
            <InfoCircleOutlined /> 接入说明
          </div>
          <ul style={{ paddingLeft: 18, margin: 0, color: '#475569', fontSize: 13, lineHeight: 1.8 }}>
            {isOAuth && (
              <>
                <li>应用侧请将客户端 ID、客户端密钥和回调地址配置到认证设置中</li>
                <li>如启用 HTTPS，请确保回调地址与应用配置完全一致</li>
              </>
            )}
            {family === 'saml' && (
              <>
                <li>应用侧需将下方 Entity ID、ACS URL 配置到 SP 元数据</li>
                <li>如需加密 Assertion，请向应用侧提供 IdP 签名证书</li>
              </>
            )}
            {family === 'cas' && (
              <>
                <li>应用侧需将服务地址 (service) 加入 CAS 客户端配置</li>
                <li>CAS Ticket 默认 5 分钟过期，可在管理端调整</li>
              </>
            )}
            <li>可通过下方按钮复制全部配置或下载 JSON 提供给实施人员</li>
          </ul>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: isOAuth ? 'minmax(0,1fr) minmax(0,1fr)' : 'minmax(0,1fr)', gap: 16 }}>
        {/* 客户端接入配置（提供给应用侧） */}
        <div style={{ border: '1px solid #eef0f5', borderRadius: 12, padding: '20px 24px', background: '#fff' }}>
          <div style={{ fontWeight: 600, color: '#1d2c5b', marginBottom: 14 }}>
            {isOAuth ? '客户端接入配置（提供给应用侧）' : `${FAMILY_LABEL[family]} 接入配置`}
          </div>

          {isOAuth && (
            <>
              <HandoffRow label="客户端 ID" value={submitted?.client_id || ''} />
              <HandoffRow
                label="客户端密钥"
                value={isNewly ? (submitted?.client_secret || '') : '••••••••（已加密保存，仅创建时显示一次，请通过"轮换密钥"获取新密钥）'}
                password={isNewly}
              />
              <HandoffRow label="客户端认证方式" value="Client Secret Post" />
              <HandoffRow label="回调地址 / Redirect URI" value={(summary.redirect_uris || []).join('\n')} />
              <HandoffRow label="Scope" value={(summary.scope || []).join(' ')} />
              <HandoffRow label="PKCE" value={summary.require_pkce ? '启用' : '未启用'} />
              <HandoffRow label="用户标识字段" value={summary.subject_type || ''} />
              {isOIDC && (
                <HandoffRow label="ID Token 签名算法" value={summary.oidc_id_token_signing_alg || 'RS256'} />
              )}
              <HandoffRow label="Access Token 有效期" value={fmtSeconds(summary.access_token_ttl)} />
              {isOIDC && (
                <HandoffRow label="ID Token 有效期" value={fmtSeconds(summary.id_token_ttl)} />
              )}
              <HandoffRow
                label="Refresh Token 有效期"
                value={summary.issue_refresh_token ? fmtSeconds(summary.refresh_token_ttl) : '未签发 Refresh Token'}
              />
            </>
          )}

          {family === 'saml' && (
            <>
              <HandoffRow label="SP Entity ID" value={summary.saml_entity_id || ''} />
              <HandoffRow label="ACS URL" value={summary.saml_acs_url || ''} />
              <HandoffRow label="Audience" value={summary.saml_audience || summary.saml_entity_id || ''} />
              <HandoffRow label="IdP Issuer" value={summary.saml_issuer || ''} />
              <HandoffRow label="Binding" value={summary.saml_binding || ''} />
              <HandoffRow label="NameID Format" value={summary.saml_nameid_format || ''} />
              <HandoffRow label="NameID 转换" value={summary.saml_nameid_convert || ''} />
              <HandoffRow label="签名算法" value={summary.saml_signature_algorithm || ''} />
              <HandoffRow label="摘要算法" value={summary.saml_digest_algorithm || ''} />
              <HandoffRow label="加密 Assertion" value={summary.saml_encrypted ? '是' : '否'} />
              <HandoffRow label="断言有效期" value={fmtSeconds(summary.saml_validity_seconds)} />
            </>
          )}

          {family === 'cas' && (
            <>
              <HandoffRow label="服务地址 (service)" value={summary.cas_service || ''} />
              <HandoffRow label="回调地址" value={summary.cas_callback_url || summary.cas_service || ''} />
              <HandoffRow label="用户标识字段" value={summary.cas_user_attribute || ''} />
              <HandoffRow label="Ticket 有效期" value={fmtSeconds(summary.cas_expires_seconds)} />
            </>
          )}
        </div>

        {/* OIDC 端点信息（仅 OIDC/OAuth2） */}
        {isOAuth && (
          <div style={{ border: '1px solid #eef0f5', borderRadius: 12, padding: '20px 24px', background: '#fff' }}>
            <div style={{ fontWeight: 600, color: '#1d2c5b', marginBottom: 14 }}>
              {isOIDC ? 'OIDC 端点信息' : 'OAuth 2.0 端点信息'}
            </div>
            {discovery ? (
              <>
                <HandoffRow label="Issuer / 端点地址" value={discovery.issuer || ''} />
                <HandoffRow label="授权端点地址" value={discovery.authorization_endpoint || ''} />
                <HandoffRow label="Token 端点地址" value={discovery.token_endpoint || ''} />
                {discovery.userinfo_endpoint && (
                  <HandoffRow label="用户信息端点地址" value={discovery.userinfo_endpoint} />
                )}
                {discovery.jwks_uri && (
                  <HandoffRow label="JWKS 端点地址" value={discovery.jwks_uri} />
                )}
                {discovery.end_session_endpoint && (
                  <HandoffRow label="注销会话端点地址" value={discovery.end_session_endpoint} />
                )}
                {isOIDC && (
                  <HandoffRow
                    label="Discovery"
                    value={(discovery.issuer || '') + '/.well-known/openid-configuration'}
                  />
                )}
              </>
            ) : (
              <Typography.Text type="secondary">正在加载端点信息…</Typography.Text>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
