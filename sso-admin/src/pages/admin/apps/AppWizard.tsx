import { useEffect, useMemo, useState } from 'react';
import {
  Form,
  Input,
  Select,
  Switch,
  Steps,
  Button,
  Upload,
  Radio,
  InputNumber,
  Descriptions,
  Tag,
  App as AntdApp,
} from 'antd';
import { UploadOutlined, RedoOutlined } from '@ant-design/icons';
import { useAuthStore } from '@/store/authStore';
import type { OAuth2Client } from '@/api/apps';
import './wizard.css';

// 协议家族（== backend.protocol 字段值）
export type Proto = 'oidc' | 'oauth2' | 'saml' | 'cas';
export type ProtoFamily = Proto;

const FAMILY_LABEL: Record<ProtoFamily, string> = {
  oidc:   'OpenID Connect',
  oauth2: 'OAuth 2.0',
  saml:   'SAML 2.0',
  cas:    'CAS',
};

// 每个协议家族下可选的版本
const PROTOCOL_VERSIONS: Record<ProtoFamily, { value: string; label: string }[]> = {
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
};

function defaultProtocolVersion(f: ProtoFamily) {
  return PROTOCOL_VERSIONS[f][0].value;
}

// 各家族在 Step2 需要校验的字段
const STEP2_FIELDS: Record<ProtoFamily, string[]> = {
  oauth2: [
    'redirect_uris', 'grant_types', 'subject_type', 'scope',
    'require_consent', 'require_pkce', 'access_token_ttl', 'refresh_token_ttl',
  ],
  oidc: [
    'redirect_uris', 'grant_types', 'subject_type', 'scope',
    'require_consent', 'require_pkce', 'access_token_ttl', 'refresh_token_ttl',
    'oidc_id_token_signing_alg', 'oidc_userinfo_response',
  ],
  saml: [
    'saml_entity_id', 'saml_acs_url', 'saml_binding', 'saml_nameid_format',
    'saml_signature_algorithm', 'saml_digest_algorithm', 'saml_validity_seconds',
  ],
  cas: ['cas_service', 'cas_user_attribute', 'cas_expires_seconds'],
};

function genId() {
  return Array.from({ length: 18 }, () => Math.floor(Math.random() * 10)).join('');
}
function genSecret() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length: 48 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

type WizardValues = {
  // step1 基本信息（共用）
  client_id: string;
  client_secret_preview: string;
  client_name: string;
  protocol: Proto;
  protocol_version: string;
  logo_url?: string;
  login_url?: string;
  is_active: boolean;
  description?: string;

  // OAuth2 / OIDC
  redirect_uris?: string[];
  grant_types?: string[];
  subject_type?: string;
  scope?: string[];
  require_consent?: boolean;
  require_pkce?: boolean;
  access_token_ttl?: number;
  refresh_token_ttl?: number;

  // OIDC
  oidc_issuer?: string;
  oidc_audience?: string;
  oidc_id_token_signing_alg?: string;
  oidc_userinfo_response?: string;

  // SAML
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
};

export default function AppWizard({
  open,
  family,
  editing,
  onClose,
  onSubmit,
}: {
  open: boolean;
  family: ProtoFamily;
  editing: OAuth2Client | null;
  onClose: () => void;
  onSubmit: (values: any) => Promise<void>;
}) {
  const { message } = AntdApp.useApp();
  const accessToken = useAuthStore((s) => s.accessToken);
  const [step, setStep] = useState(0);
  const [form] = Form.useForm<WizardValues>();
  const [saving, setSaving] = useState(false);
  const logoUrl = Form.useWatch('logo_url', form);
  const isOIDC = family === 'oidc';

  useEffect(() => {
    if (!open) return;
    setStep(0);
    if (editing) {
      const p = ((editing.protocol as Proto) || family) as Proto;
      const editVersion = editing.protocol_version || defaultProtocolVersion(p);
      form.setFieldsValue({
        client_id: editing.client_id,
        client_secret_preview: '••••••••（已加密保存）',
        client_name: editing.client_name,
        protocol: p,
        protocol_version: editVersion,
        logo_url: editing.logo_url,
        login_url: editing.login_url || editing.home_url,
        is_active: editing.is_active,
        description: editing.description,

        redirect_uris: editing.redirect_uris || [],
        grant_types: editing.grant_types || ['authorization_code'],
        subject_type: editing.subject_type || 'username',
        scope: (editing.scope || '').split(/\s+/).filter(Boolean),
        require_consent: !!editing.require_consent,
        require_pkce: !!editing.require_pkce,
        access_token_ttl: editing.access_token_ttl || 3600,
        refresh_token_ttl: editing.refresh_token_ttl || 604800,

        oidc_issuer: editing.oidc_issuer,
        oidc_audience: editing.oidc_audience,
        oidc_id_token_signing_alg: editing.oidc_id_token_signing_alg || 'RS256',
        oidc_userinfo_response: editing.oidc_userinfo_response || 'NORMAL',

        saml_entity_id: editing.saml_entity_id,
        saml_acs_url: editing.saml_acs_url,
        saml_audience: editing.saml_audience,
        saml_issuer: editing.saml_issuer,
        saml_binding: editing.saml_binding || 'Redirect-Post',
        saml_nameid_format: editing.saml_nameid_format || 'unspecified',
        saml_nameid_convert: editing.saml_nameid_convert || 'original',
        saml_signature_algorithm: editing.saml_signature_algorithm || 'RSAwithSHA256',
        saml_digest_algorithm: editing.saml_digest_algorithm || 'SHA256',
        saml_encrypted: !!editing.saml_encrypted,
        saml_validity_seconds: editing.saml_validity_seconds || 300,
        saml_certificate: editing.saml_certificate,

        cas_service: editing.cas_service,
        cas_callback_url: editing.cas_callback_url,
        cas_user_attribute: editing.cas_user_attribute || 'username',
        cas_expires_seconds: editing.cas_expires_seconds || 300,
      });
    } else {
      const initVersion = defaultProtocolVersion(family);
      form.resetFields();
      form.setFieldsValue({
        client_id: genId(),
        client_secret_preview: genSecret(),
        protocol: family,
        protocol_version: initVersion,
        is_active: true,

        // OAuth2/OIDC 默认
        redirect_uris: [],
        grant_types: ['authorization_code', 'refresh_token'],
        subject_type: 'username',
        scope: family === 'oidc' ? ['openid', 'profile', 'email'] : ['profile', 'email'],
        require_consent: false,
        require_pkce: false,
        access_token_ttl: 3600,
        refresh_token_ttl: 604800,

        // OIDC 默认
        oidc_id_token_signing_alg: 'RS256',
        oidc_userinfo_response: 'NORMAL',

        // SAML 默认
        saml_binding: 'Redirect-Post',
        saml_nameid_format: 'unspecified',
        saml_nameid_convert: 'original',
        saml_signature_algorithm: 'RSAwithSHA256',
        saml_digest_algorithm: 'SHA256',
        saml_encrypted: false,
        saml_validity_seconds: 300,

        // CAS 默认
        cas_user_attribute: 'username',
        cas_expires_seconds: 300,
      });
    }
  }, [open, editing, family]);

  const handleNext = async () => {
    try {
      if (step === 0) {
        await form.validateFields([
          'client_id', 'client_secret_preview', 'client_name', 'login_url',
        ]);
      } else if (step === 1) {
        await form.validateFields(STEP2_FIELDS[family]);
      }
      setStep((s) => s + 1);
    } catch {
      /* validateFields handles ui */
    }
  };

  const handleSubmit = async () => {
    const v = await form.validateFields();
    const backendProtocol: Proto = family;
    const base = {
      client_name: v.client_name,
      protocol: backendProtocol,
      protocol_version: v.protocol_version,
      logo_url: v.logo_url,
      home_url: v.login_url,
      login_url: v.login_url,
      is_active: v.is_active,
      description: v.description,
    };
    let payload: any = base;
    if (backendProtocol === 'oauth2' || backendProtocol === 'oidc') {
      payload = {
        ...base,
        redirect_uris: v.redirect_uris || [],
        grant_types: v.grant_types || [],
        subject_type: v.subject_type,
        scope: (v.scope || []).join(' '),
        require_consent: v.require_consent,
        require_pkce: v.require_pkce,
        access_token_ttl: v.access_token_ttl,
        refresh_token_ttl: v.refresh_token_ttl,
      };
      if (backendProtocol === 'oidc') {
        payload = {
          ...payload,
          oidc_issuer: v.oidc_issuer,
          oidc_audience: v.oidc_audience,
          oidc_id_token_signing_alg: v.oidc_id_token_signing_alg,
          oidc_userinfo_response: v.oidc_userinfo_response,
        };
      }
    } else if (backendProtocol === 'saml') {
      payload = {
        ...base,
        saml_entity_id: v.saml_entity_id,
        saml_acs_url: v.saml_acs_url,
        saml_audience: v.saml_audience || v.saml_entity_id,
        saml_issuer: v.saml_issuer,
        saml_binding: v.saml_binding,
        saml_nameid_format: v.saml_nameid_format,
        saml_nameid_convert: v.saml_nameid_convert,
        saml_signature_algorithm: v.saml_signature_algorithm,
        saml_digest_algorithm: v.saml_digest_algorithm,
        saml_encrypted: v.saml_encrypted,
        saml_validity_seconds: v.saml_validity_seconds,
        saml_certificate: v.saml_certificate,
      };
    } else if (backendProtocol === 'cas') {
      payload = {
        ...base,
        cas_service: v.cas_service,
        cas_callback_url: v.cas_callback_url || v.cas_service,
        cas_user_attribute: v.cas_user_attribute,
        cas_expires_seconds: v.cas_expires_seconds,
      };
    }
    setSaving(true);
    try {
      await onSubmit(payload);
      onClose();
    } catch (e: any) {
      message.error(e?.response?.data?.message || '提交失败');
    } finally {
      setSaving(false);
    }
  };

  const summary = useMemo(() => form.getFieldsValue(true), [step, form]);

  return (
    <div className="app-wizard">
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 28 }}>
        <Steps
          current={step}
          items={[{ title: '应用信息' }, { title: '协议配置' }, { title: '信息确认' }]}
          style={{ width: 640 }}
        />
      </div>

      <Form form={form} layout="horizontal" labelCol={{ flex: '120px' }} labelAlign="right" colon>
        {/* ============== Step 1 应用信息（共用） ============== */}
        <div style={{ display: step === 0 ? 'block' : 'none' }}>
          <div style={{ display: 'flex', gap: 20 }}>
            <div
              style={{
                flex: 1,
                minWidth: 0,
                border: '1px solid #eef0f5',
                borderRadius: 12,
                padding: '28px 28px 8px',
                background: '#fff',
              }}
            >
              <Form.Item name="client_id" label="编码" rules={[{ required: true }]}>
                <Input disabled style={{ background: '#f5f7fb' }} />
              </Form.Item>
              <Form.Item name="client_secret_preview" label="应用秘钥" rules={[{ required: true }]}>
                <Input
                  disabled={!!editing}
                  addonAfter={
                    !editing ? (
                      <Button
                        type="link"
                        size="small"
                        style={{ padding: 0, color: '#1677ff' }}
                        icon={<RedoOutlined />}
                        onClick={() =>
                          form.setFieldValue('client_secret_preview', genSecret())
                        }
                      >
                        生成
                      </Button>
                    ) : null
                  }
                />
              </Form.Item>
              <Form.Item name="client_name" label="应用名称" rules={[{ required: true, message: '请输入应用名称' }]}>
                <Input placeholder="例如：JumpServer 演示" />
              </Form.Item>
              <Form.Item name="protocol_version" label="协议" rules={[{ required: true }]}>
                <Select options={PROTOCOL_VERSIONS[family]} />
              </Form.Item>
              <Form.Item name="protocol" hidden><Input /></Form.Item>
              <Form.Item name="login_url" label="登录地址" rules={[{ required: true, message: '请输入应用登录地址' }]}>
                <Input placeholder="https://app.example.com" />
              </Form.Item>
              <Form.Item name="is_active" label="状态" valuePropName="checked" rules={[{ required: true }]}>
                <Switch />
              </Form.Item>
              <Form.Item name="description" label="描述">
                <Input.TextArea rows={3} placeholder="一句话描述该应用" />
              </Form.Item>
            </div>

            {/* 右侧图标卡 */}
            <div
              style={{
                width: 320,
                border: '1px solid #eef0f5',
                borderRadius: 12,
                padding: '28px 24px',
                background: '#fff',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'stretch',
              }}
            >
              <div style={{ marginBottom: 18 }}>
                <span style={{ color: '#ef4444', marginRight: 4 }}>*</span>
                <span style={{ color: '#1d2c5b', fontWeight: 500 }}>图标：</span>
              </div>

              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  width: '100%',
                }}
              >
                <Upload
                  name="file"
                  action="/api/v1/configs/upload-image"
                  headers={{ Authorization: `Bearer ${accessToken}` }}
                  data={{ prefix: 'app' }}
                  accept=".png,.jpg,.jpeg,.svg,.webp,.gif"
                  showUploadList={false}
                  beforeUpload={(file) => {
                    if (file.size > 2 * 1024 * 1024) {
                      message.error('图标不能超过 2MB');
                      return Upload.LIST_IGNORE;
                    }
                    return true;
                  }}
                  onChange={(info) => {
                    if (info.file.status === 'done') {
                      const url = info.file.response?.data?.url;
                      if (url) {
                        form.setFieldValue('logo_url', url);
                        message.success('图标已上传');
                      }
                    } else if (info.file.status === 'error') {
                      message.error(info.file.response?.message || '上传失败');
                    }
                  }}
                >
                  <div
                    className="app-wizard-upload-dropzone"
                    style={{
                      width: 240,
                      height: 240,
                      border: '1.5px dashed #c7d2fe',
                      borderRadius: 14,
                      overflow: 'hidden',
                      background: 'linear-gradient(180deg, #fafbff 0%, #eef2ff 100%)',
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                      position: 'relative',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLDivElement).style.borderColor = '#1677ff';
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLDivElement).style.borderColor = '#c7d2fe';
                    }}
                  >
                    {logoUrl ? (
                      <img src={logoUrl} alt="logo" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                    ) : (
                      <>
                        <img
                          src="/upload-illust.svg"
                          alt="upload"
                          style={{ width: 140, marginTop: 12 }}
                        />
                        <div style={{ textAlign: 'center', marginTop: 16, lineHeight: 1.8 }}>
                          <div style={{ fontSize: 13.5, color: '#475569' }}>支持 JPG、PNG 格式</div>
                          <div style={{ fontSize: 13.5, color: '#475569' }}>建议尺寸 256×256</div>
                        </div>
                      </>
                    )}
                  </div>
                </Upload>

                <Upload
                  name="file"
                  action="/api/v1/configs/upload-image"
                  headers={{ Authorization: `Bearer ${accessToken}` }}
                  data={{ prefix: 'app' }}
                  accept=".png,.jpg,.jpeg,.svg,.webp,.gif"
                  showUploadList={false}
                  onChange={(info) => {
                    if (info.file.status === 'done') {
                      const url = info.file.response?.data?.url;
                      if (url) {
                        form.setFieldValue('logo_url', url);
                        message.success('图标已上传');
                      }
                    } else if (info.file.status === 'error') {
                      message.error(info.file.response?.message || '上传失败');
                    }
                  }}
                >
                  <Button
                    icon={<UploadOutlined />}
                    size="large"
                    style={{ marginTop: 22, width: 180, height: 44, fontSize: 15, borderRadius: 8 }}
                  >
                    上传图标
                  </Button>
                </Upload>
              </div>

              <Form.Item name="logo_url" hidden>
                <Input />
              </Form.Item>
            </div>
          </div>
        </div>

        {/* ============== Step 2 协议配置（按协议切换） ============== */}
        <div style={{ display: step === 1 ? 'block' : 'none' }}>
          {(family === 'oidc' || family === 'oauth2') && <OAuth2OIDCConfig isOIDC={isOIDC} />}
          {family === 'saml' && <SAMLConfig />}
          {family === 'cas' && <CASConfig />}
        </div>

        {/* ============== Step 3 信息确认（按协议组装） ============== */}
        <div
          style={{
            display: step === 2 ? 'block' : 'none',
            border: '1px solid #eef0f5',
            borderRadius: 12,
            padding: '24px 28px',
            background: '#fff',
          }}
        >
          <Descriptions title="应用信息" column={2} bordered size="middle" style={{ marginBottom: 16 }}>
            <Descriptions.Item label="编码" span={2}>{summary.client_id}</Descriptions.Item>
            <Descriptions.Item label="应用名称">{summary.client_name}</Descriptions.Item>
            <Descriptions.Item label="协议">
              <Tag color="blue">
                {PROTOCOL_VERSIONS[family]
                  .find((x) => x.value === summary.protocol_version)?.label
                  || FAMILY_LABEL[family]}
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label="登录地址" span={2}>{summary.login_url}</Descriptions.Item>
            <Descriptions.Item label="状态">
              {summary.is_active ? <Tag color="green">启用</Tag> : <Tag>禁用</Tag>}
            </Descriptions.Item>
            <Descriptions.Item label="描述">{summary.description || '—'}</Descriptions.Item>
          </Descriptions>

          <Descriptions title="协议配置" column={2} bordered size="middle">
            {(family === 'oidc' || family === 'oauth2') && (
              <>
                <Descriptions.Item label="认证地址" span={2}>
                  {(summary.redirect_uris || []).map((u: string) => (
                    <div key={u}>{u}</div>
                  ))}
                </Descriptions.Item>
                <Descriptions.Item label="授权方式" span={2}>
                  {(summary.grant_types || []).map((g: string) => <Tag key={g}>{g}</Tag>)}
                </Descriptions.Item>
                <Descriptions.Item label="主题">{summary.subject_type}</Descriptions.Item>
                <Descriptions.Item label="作用域">
                  {(summary.scope || []).map((s: string) => <Tag key={s}>{s}</Tag>)}
                </Descriptions.Item>
                <Descriptions.Item label="许可确认">{summary.require_consent ? '强制' : '自动'}</Descriptions.Item>
                <Descriptions.Item label="PKCE">{summary.require_pkce ? '是' : '否'}</Descriptions.Item>
                <Descriptions.Item label="accessToken 有效期">{summary.access_token_ttl} 秒</Descriptions.Item>
                <Descriptions.Item label="refreshToken 有效期">{summary.refresh_token_ttl} 秒</Descriptions.Item>
                {isOIDC && (
                  <>
                    <Descriptions.Item label="Issuer" span={2}>{summary.oidc_issuer || '—'}</Descriptions.Item>
                    <Descriptions.Item label="Audience" span={2}>{summary.oidc_audience || '—'}</Descriptions.Item>
                    <Descriptions.Item label="ID Token 签名">{summary.oidc_id_token_signing_alg}</Descriptions.Item>
                    <Descriptions.Item label="UserInfo 响应">{summary.oidc_userinfo_response}</Descriptions.Item>
                  </>
                )}
              </>
            )}
            {family === 'saml' && (
              <>
                <Descriptions.Item label="Entity ID" span={2}>{summary.saml_entity_id}</Descriptions.Item>
                <Descriptions.Item label="ACS URL" span={2}>{summary.saml_acs_url}</Descriptions.Item>
                <Descriptions.Item label="Audience" span={2}>{summary.saml_audience || summary.saml_entity_id}</Descriptions.Item>
                <Descriptions.Item label="Issuer" span={2}>{summary.saml_issuer || '—'}</Descriptions.Item>
                <Descriptions.Item label="Binding">{summary.saml_binding}</Descriptions.Item>
                <Descriptions.Item label="NameID Format">{summary.saml_nameid_format}</Descriptions.Item>
                <Descriptions.Item label="NameID 转换">{summary.saml_nameid_convert}</Descriptions.Item>
                <Descriptions.Item label="签名算法">{summary.saml_signature_algorithm}</Descriptions.Item>
                <Descriptions.Item label="摘要算法">{summary.saml_digest_algorithm}</Descriptions.Item>
                <Descriptions.Item label="加密 Assertion">{summary.saml_encrypted ? '是' : '否'}</Descriptions.Item>
                <Descriptions.Item label="断言有效期">{summary.saml_validity_seconds} 秒</Descriptions.Item>
                <Descriptions.Item label="X.509 证书" span={2}>
                  {summary.saml_certificate
                    ? <code style={{ fontSize: 12 }}>{(summary.saml_certificate || '').slice(0, 60)}…</code>
                    : '—'}
                </Descriptions.Item>
              </>
            )}
            {family === 'cas' && (
              <>
                <Descriptions.Item label="服务地址" span={2}>{summary.cas_service}</Descriptions.Item>
                <Descriptions.Item label="回调地址" span={2}>{summary.cas_callback_url || summary.cas_service}</Descriptions.Item>
                <Descriptions.Item label="返回账号">{summary.cas_user_attribute}</Descriptions.Item>
                <Descriptions.Item label="Ticket 有效期">{summary.cas_expires_seconds} 秒</Descriptions.Item>
              </>
            )}
          </Descriptions>
        </div>
      </Form>

      <div className="app-wizard-footer">
        <Button size="large" style={{ minWidth: 96 }} onClick={onClose}>关闭</Button>
        {step > 0 && (
          <Button size="large" style={{ minWidth: 96 }} onClick={() => setStep((s) => s - 1)}>
            上一步
          </Button>
        )}
        {step < 2 && (
          <Button size="large" type="primary" style={{ minWidth: 120 }} onClick={handleNext}>
            下一步
          </Button>
        )}
        {step === 2 && (
          <Button size="large" type="primary" style={{ minWidth: 120 }} loading={saving} onClick={handleSubmit}>
            提交
          </Button>
        )}
      </div>
    </div>
  );
}

// ─── Step 2: OAuth 2.0 / OIDC ──────────────────────────────
function OAuth2OIDCConfig({ isOIDC }: { isOIDC: boolean }) {
  return (
    <div
      className="app-wizard-step2"
      style={{
        border: '1px solid #eef0f5',
        borderRadius: 12,
        padding: '32px 40px 16px',
        background: '#fff',
      }}
    >
      <Form.Item
        name="redirect_uris"
        label="认证地址"
        tooltip="多个回调地址换行分隔，格式如 https://app.example.com/callback"
        rules={[{ required: true, message: '请填写至少一个回调地址' }]}
        getValueFromEvent={(e) =>
          typeof e?.target?.value === 'string'
            ? e.target.value.split('\n').map((s: string) => s.trim()).filter(Boolean)
            : e
        }
        getValueProps={(v) => ({ value: Array.isArray(v) ? v.join('\n') : v })}
      >
        <Input.TextArea rows={4} placeholder="https://app.example.com/callback" />
      </Form.Item>

      <Form.Item name="grant_types" label="授权方式" rules={[{ required: true }]}>
        <Select
          mode="multiple"
          options={[
            { value: 'authorization_code', label: 'authorization_code' },
            { value: 'refresh_token',      label: 'refresh_token' },
            { value: 'client_credentials', label: 'client_credentials' },
            { value: 'password',           label: 'password' },
            { value: 'implicit',           label: 'implicit' },
          ]}
        />
      </Form.Item>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 32px' }}>
        <Form.Item name="subject_type" label="主题" rules={[{ required: true }]}>
          <Select
            options={[
              { value: 'username', label: '登录账号' },
              { value: 'user_id',  label: '用户 ID' },
              { value: 'email',    label: '邮箱' },
              { value: 'mobile',   label: '手机号' },
            ]}
          />
        </Form.Item>
        <Form.Item
          name="scope"
          label="作用域"
          rules={[{ required: true, message: '至少配置一个 Scope' }]}
        >
          <Select mode="tags" placeholder="按下回车继续添加" tokenSeparators={[' ', ',']} />
        </Form.Item>

        <Form.Item
          name="require_consent"
          label="许可确认"
          rules={[{ required: true }]}
          tooltip="强制：每次首次授权需用户点击确认；自动：跳过同意页"
          getValueProps={(v) => ({ value: v ? 'force' : 'auto' })}
          getValueFromEvent={(e) => e.target.value === 'force'}
        >
          <Radio.Group buttonStyle="solid">
            <Radio.Button value="force">强制</Radio.Button>
            <Radio.Button value="auto">自动</Radio.Button>
          </Radio.Group>
        </Form.Item>
        <Form.Item
          name="require_pkce"
          label="PKCE"
          rules={[{ required: true }]}
          getValueProps={(v) => ({ value: v ? 'yes' : 'no' })}
          getValueFromEvent={(e) => e.target.value === 'yes'}
        >
          <Radio.Group buttonStyle="solid">
            <Radio.Button value="yes">是</Radio.Button>
            <Radio.Button value="no">否</Radio.Button>
          </Radio.Group>
        </Form.Item>

        <Form.Item
          name="access_token_ttl"
          label="accessToken 有效期"
          rules={[{ required: true }]}
          extra={<span style={{ color: '#94a3b8', fontSize: 12 }}>建议值：3600 ~ 86400 秒</span>}
        >
          <InputNumber min={60} max={86400} addonAfter="秒" style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item
          name="refresh_token_ttl"
          label="refreshToken 有效期"
          rules={[{ required: true }]}
          extra={<span style={{ color: '#94a3b8', fontSize: 12 }}>建议值：86400 ~ 604800 秒</span>}
        >
          <InputNumber min={60} max={31536000} addonAfter="秒" style={{ width: '100%' }} />
        </Form.Item>
      </div>

      {isOIDC && (
        <>
          <div
            style={{
              margin: '8px 0 16px',
              paddingTop: 12,
              borderTop: '1px dashed #e5e7eb',
              color: '#1d2c5b',
              fontWeight: 600,
              fontSize: 14,
            }}
          >
            OpenID Connect 扩展
          </div>
          <Form.Item name="oidc_issuer" label="签发人">
            <Input placeholder="留空则使用默认 issuer（系统地址）" />
          </Form.Item>
          <Form.Item name="oidc_audience" label="受众">
            <Input placeholder="留空则使用 client_id" />
          </Form.Item>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 32px' }}>
            <Form.Item
              name="oidc_id_token_signing_alg"
              label="ID Token 签名"
              rules={[{ required: true }]}
            >
              <Select
                options={[
                  { value: 'RS256', label: 'RS256' },
                  { value: 'RS384', label: 'RS384' },
                  { value: 'RS512', label: 'RS512' },
                  { value: 'HS256', label: 'HS256' },
                  { value: 'HS384', label: 'HS384' },
                  { value: 'HS512', label: 'HS512' },
                ]}
              />
            </Form.Item>
            <Form.Item
              name="oidc_userinfo_response"
              label="UserInfo 响应"
              rules={[{ required: true }]}
              tooltip="/userinfo 接口返回的格式：普通 JSON / 签名 JWT / 加密 JWT / 签名后加密"
            >
              <Select
                options={[
                  { value: 'NORMAL',              label: 'NORMAL（普通 JSON）' },
                  { value: 'SIGNING',             label: 'SIGNING（签名 JWT）' },
                  { value: 'ENCRYPTION',          label: 'ENCRYPTION（加密 JWT）' },
                  { value: 'SIGNING_ENCRYPTION',  label: 'SIGNING_ENCRYPTION' },
                ]}
              />
            </Form.Item>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Step 2: SAML 2.0 ─────────────────────────────────────
function SAMLConfig() {
  return (
    <div
      className="app-wizard-step2"
      style={{
        border: '1px solid #eef0f5',
        borderRadius: 12,
        padding: '32px 40px 16px',
        background: '#fff',
      }}
    >
      <Form.Item
        name="saml_entity_id"
        label="Entity ID"
        rules={[{ required: true, message: '请输入 SP Entity ID' }]}
        tooltip="服务提供方（SP）的唯一标识，由对方 metadata 给出"
      >
        <Input placeholder="urn:example:sp 或 https://sp.example.com/saml" />
      </Form.Item>

      <Form.Item
        name="saml_acs_url"
        label="ACS URL"
        rules={[{ required: true, message: '请输入 Assertion Consumer Service URL' }]}
        tooltip="IdP 签发断言后回调到 SP 的地址"
      >
        <Input placeholder="https://sp.example.com/saml/acs" />
      </Form.Item>

      <Form.Item name="saml_audience" label="Audience">
        <Input placeholder="留空则使用 Entity ID" />
      </Form.Item>

      <Form.Item name="saml_issuer" label="Issuer (IdP)">
        <Input placeholder="留空使用 OneAuth 默认 issuer" />
      </Form.Item>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 32px' }}>
        <Form.Item name="saml_binding" label="Binding" rules={[{ required: true }]}>
          <Select
            options={[
              { value: 'Redirect-Post',            label: 'Redirect → POST' },
              { value: 'Post-Post',                label: 'POST → POST' },
              { value: 'IdpInit-Post',             label: 'IdP-Init → POST' },
              { value: 'Redirect-PostSimpleSign',  label: 'Redirect → PostSimpleSign' },
              { value: 'Post-PostSimpleSign',      label: 'POST → PostSimpleSign' },
            ]}
          />
        </Form.Item>
        <Form.Item name="saml_nameid_format" label="NameID Format" rules={[{ required: true }]}>
          <Select
            options={[
              { value: 'unspecified',                label: 'unspecified' },
              { value: 'persistent',                 label: 'persistent' },
              { value: 'transient',                  label: 'transient' },
              { value: 'emailAddress',               label: 'emailAddress' },
              { value: 'X509SubjectName',            label: 'X509SubjectName' },
              { value: 'WindowsDomainQualifiedName', label: 'WindowsDomainQualifiedName' },
              { value: 'entity',                     label: 'entity' },
            ]}
          />
        </Form.Item>

        <Form.Item name="saml_nameid_convert" label="NameID 转换">
          <Select
            options={[
              { value: 'original',  label: '保持原样' },
              { value: 'uppercase', label: '转大写' },
              { value: 'lowercase', label: '转小写' },
            ]}
          />
        </Form.Item>

        <Form.Item name="saml_signature_algorithm" label="签名算法" rules={[{ required: true }]}>
          <Select
            options={[
              { value: 'RSAwithSHA256', label: 'RSAwithSHA256' },
              { value: 'RSAwithSHA1',   label: 'RSAwithSHA1' },
              { value: 'RSAwithSHA384', label: 'RSAwithSHA384' },
              { value: 'RSAwithSHA512', label: 'RSAwithSHA512' },
            ]}
          />
        </Form.Item>
        <Form.Item name="saml_digest_algorithm" label="摘要算法" rules={[{ required: true }]}>
          <Select
            options={[
              { value: 'SHA256', label: 'SHA256' },
              { value: 'SHA1',   label: 'SHA1' },
              { value: 'SHA384', label: 'SHA384' },
              { value: 'SHA512', label: 'SHA512' },
            ]}
          />
        </Form.Item>

        <Form.Item
          name="saml_encrypted"
          label="加密 Assertion"
          getValueProps={(v) => ({ value: v ? 'yes' : 'no' })}
          getValueFromEvent={(e) => e.target.value === 'yes'}
        >
          <Radio.Group buttonStyle="solid">
            <Radio.Button value="yes">是</Radio.Button>
            <Radio.Button value="no">否</Radio.Button>
          </Radio.Group>
        </Form.Item>

        <Form.Item
          name="saml_validity_seconds"
          label="断言有效期"
          rules={[{ required: true }]}
          extra={<span style={{ color: '#94a3b8', fontSize: 12 }}>建议值：60 ~ 600 秒</span>}
        >
          <InputNumber min={30} max={3600} addonAfter="秒" style={{ width: '100%' }} />
        </Form.Item>
      </div>

      <Form.Item
        name="saml_certificate"
        label="SP 公钥证书"
        tooltip="粘贴 PEM 格式的 X.509 证书（用于校验 SP 签名 / 加密 Assertion）"
      >
        <Input.TextArea
          rows={5}
          placeholder={'-----BEGIN CERTIFICATE-----\nMIIC...\n-----END CERTIFICATE-----'}
        />
      </Form.Item>
    </div>
  );
}

// ─── Step 2: CAS ───────────────────────────────────────────
function CASConfig() {
  return (
    <div
      className="app-wizard-step2"
      style={{
        border: '1px solid #eef0f5',
        borderRadius: 12,
        padding: '32px 40px 16px',
        background: '#fff',
      }}
    >
      <Form.Item
        name="cas_service"
        label="服务地址"
        rules={[{ required: true, message: '请输入 CAS service URL' }]}
        tooltip="`service=` 参数白名单，必须与应用请求时一致"
      >
        <Input placeholder="https://app.example.com/" />
      </Form.Item>

      <Form.Item
        name="cas_callback_url"
        label="回调地址"
        tooltip="留空则使用服务地址，作为 ticket 验证完成后跳转的页面"
      >
        <Input placeholder="https://app.example.com/cas/callback" />
      </Form.Item>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 32px' }}>
        <Form.Item name="cas_user_attribute" label="返回账号" rules={[{ required: true }]}>
          <Select
            options={[
              { value: 'username', label: '登录账号' },
              { value: 'user_id',  label: '用户 ID' },
              { value: 'email',    label: '邮箱' },
              { value: 'mobile',   label: '手机号' },
            ]}
          />
        </Form.Item>
        <Form.Item
          name="cas_expires_seconds"
          label="Ticket 有效期"
          rules={[{ required: true }]}
          extra={<span style={{ color: '#94a3b8', fontSize: 12 }}>建议值：60 ~ 300 秒</span>}
        >
          <InputNumber min={30} max={3600} addonAfter="秒" style={{ width: '100%' }} />
        </Form.Item>
      </div>
    </div>
  );
}

export { };
