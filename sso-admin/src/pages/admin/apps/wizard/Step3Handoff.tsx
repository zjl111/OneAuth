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

const codeStyle: React.CSSProperties = {
  background: '#dbeafe',
  color: '#1d4ed8',
  padding: '0 6px',
  borderRadius: 4,
  fontSize: 12,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
};

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
  const showRightPanel = isOAuth || family === 'cas' || family === 'saml';
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
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

        {/* 接入指南 */}
        <div style={{ border: '1px solid #bfdbfe', borderRadius: 12, padding: '20px 24px', background: '#eff6ff' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#1d4ed8', fontWeight: 600, marginBottom: 12 }}>
            <InfoCircleOutlined /> 接入指南
          </div>
          <ol style={{ paddingLeft: 22, margin: 0, color: '#475569', fontSize: 13, lineHeight: 1.85 }}>
            {isOAuth && (
              <>
                <li>
                  <b>配置应用侧（Client）</b>：请将右侧的 <b>客户端 ID</b>、<b>客户端密钥</b>、
                  以及 {isOIDC ? 'Discovery / Issuer 端点' : '授权 / Token 端点'} 复制并提供给应用侧，让他们配置到对应的系统中。
                </li>
                <li>
                  <b>回调地址必须一致</b>：应用侧使用的 redirect_uri 必须与左侧"回调地址 / Redirect URI"列表完全匹配，
                  HTTPS 与末尾斜杠都不能差。
                </li>
                <li>
                  <b>用户字段映射</b>：OneAuth 在 access_token / id_token 中下发的字段为
                  <code style={codeStyle}> sub / preferred_username / name / email / phone_number / department</code>，
                  应用侧根据这些字段匹配自己的用户表。
                </li>
                <li>
                  <b>快速交付</b>：可通过下方按钮一键复制全部配置或下载 JSON，直接发给实施人员。
                </li>
              </>
            )}
            {family === 'saml' && (
              <>
                <li>
                  <b>配置应用侧（SP）</b>：请将下方的 <b>IdP Metadata URL</b> 复制并提供给应用侧，让他们配置到对应的系统中。
                </li>
                <li>
                  <b>安全证书</b>：如需加密传输，请在第 2 步打开"加密断言"，并向应用侧索要 SP 公钥证书配置到本系统。
                </li>
                <li>
                  <b>字段映射</b>：OneAuth 在 SAML Assertion 中签发的属性为
                  <code style={codeStyle}> username / email / mobile / nickname / department / employee_no / is_staff</code>，
                  应用侧将这些 Attribute Name 映射到自己的用户字段即可。
                </li>
                <li>
                  <b>快速交付</b>：可通过下方按钮一键复制全部配置或下载 JSON，直接发给实施人员。
                </li>
              </>
            )}
            {family === 'cas' && (
              <>
                <li>
                  <b>配置应用侧（CAS Client）</b>：请将下方的 <b>CAS Server URL</b>（OneAuth 提供）填入应用 CAS 客户端的"服务器地址"，
                  并把应用自己的回调 URL 在 OneAuth 这边填到"服务地址"白名单。
                </li>
                <li>
                  <b>验票端点</b>：CAS 客户端会自动从 Server URL 拼出 <code style={codeStyle}>/p3/serviceValidate</code>，
                  无需单独配置；如客户端要求显式填写，使用下方"验票端点 (V3)"。
                </li>
                <li>
                  <b>用户属性</b>：第 2 步开启"返回用户属性"后，CAS V3 验票响应会带
                  <code style={codeStyle}> username / email / mobile / department</code> 等属性，应用侧读取后映射到自己用户表。
                </li>
                <li>
                  <b>快速交付</b>：可通过下方按钮一键复制全部配置或下载 JSON，直接发给实施人员。
                </li>
              </>
            )}
            {family === 'link' && (
              <>
                <li>
                  <b>非单点登录应用</b>：用户在门户点击该应用图标会直接跳转到上方"应用入口"地址，OneAuth 不参与登录态传递。
                </li>
                <li>
                  <b>登录鉴权</b>：应用方自行处理登录与会话；门户图标右下角会显示锁形标识，提醒用户这是非 SSO 应用。
                </li>
                <li>
                  <b>访问审计</b>：用户每次点击进入仍会写入"应用访问日志"，便于审计和热门应用统计。
                </li>
              </>
            )}
          </ol>
        </div>
      </div>

      {/* link 应用没有客户端 / 端点配置，到此为止 */}
      {family === 'link' ? null : (

      <div style={{ display: 'grid', gridTemplateColumns: showRightPanel ? 'minmax(0,1fr) minmax(0,1fr)' : 'minmax(0,1fr)', gap: 16 }}>
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
              <HandoffRow
                label="用户标识字段"
                value={
                  ({ original: '用户名', email: '邮箱', mobile: '手机号', user_id: '用户 UUID' } as Record<string, string>)[
                    summary.saml_nameid_convert
                  ] || summary.saml_nameid_convert || ''
                }
              />
              <HandoffRow label="签名算法" value={summary.saml_signature_algorithm || ''} />
              <HandoffRow label="摘要算法" value={summary.saml_digest_algorithm || ''} />
              <HandoffRow label="加密断言" value={summary.saml_encrypted ? '是' : '否'} />
              <HandoffRow label="断言有效期" value={fmtSeconds(summary.saml_validity_seconds)} />
            </>
          )}

          {family === 'cas' && (
            <>
              <HandoffRow label="用户标识字段" value={summary.cas_user_attribute || ''} />
              <HandoffRow label="Ticket 有效期" value={fmtSeconds(summary.cas_expires_seconds)} />
              <HandoffRow label="返回用户属性" value={summary.cas_return_attributes === false ? '禁用' : '启用'} />
            </>
          )}
        </div>

        {/* SAML 端点信息（OneAuth 作为 IdP 暴露给 SP 的端点） */}
        {family === 'saml' && (
          <div style={{ border: '1px solid #eef0f5', borderRadius: 12, padding: '20px 24px', background: '#fff' }}>
            <div style={{ fontWeight: 600, color: '#1d2c5b', marginBottom: 14 }}>
              SAML 端点信息（OneAuth 提供）
            </div>
            <HandoffRow label="IdP Metadata URL" value={`${origin}/saml/metadata`} />
            <HandoffRow label="IdP Entity ID" value={origin} />
            <HandoffRow label="SSO URL (HTTP-Redirect)" value={`${origin}/saml/sso`} />
            <HandoffRow label="SSO URL (HTTP-POST)" value={`${origin}/saml/sso`} />
            <HandoffRow label="SLO URL" value={`${origin}/saml/slo`} />
            <HandoffRow label="协议版本" value="SAML 2.0" />
          </div>
        )}

        {/* CAS 端点信息（OneAuth 自身提供的 CAS 端点，给对端应用填进它们的客户端配置） */}
        {family === 'cas' && (
          <div style={{ border: '1px solid #eef0f5', borderRadius: 12, padding: '20px 24px', background: '#fff' }}>
            <div style={{ fontWeight: 600, color: '#1d2c5b', marginBottom: 14 }}>
              CAS 端点信息（OneAuth 提供）
            </div>
            <HandoffRow label="服务地址 (Server URL)" value={`${origin}/cas`} />
            <HandoffRow label="登录入口" value={`${origin}/cas/login`} />
            <HandoffRow label="单点登出" value={`${origin}/cas/logout`} />
            <HandoffRow label="验票端点 (V2)" value={`${origin}/cas/serviceValidate`} />
            <HandoffRow label="验票端点 (V3)" value={`${origin}/cas/p3/serviceValidate`} />
            <HandoffRow label="代理验票 (V2)" value={`${origin}/cas/proxyValidate`} />
            <HandoffRow label="协议版本" value={
              ({ 'CAS_v3.0': 'CAS 3.0', 'CAS_v2.0': 'CAS 2.0', 'CAS_v1.0': 'CAS 1.0', 'CAS_SAML_v1.1': 'CAS SAML 1.1' } as Record<string, string>)[summary.protocol_version] || 'CAS 3.0'
            } />
          </div>
        )}

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
      )}
    </div>
  );
}
