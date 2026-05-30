import { useEffect, useMemo, useState } from 'react';
import {
  Form,
  Input,
  Switch,
  Steps,
  Button,
  App as AntdApp,
} from 'antd';
import { CopyOutlined, DownloadOutlined } from '@ant-design/icons';
import type { OAuth2Client } from '@/api/apps';
import LogoUploader from '@/components/LogoUploader';
import './wizard.css';

import {
  ALL_OIDC_CLAIMS,
  FAMILY_LABEL,
  PROTOCOL_VERSIONS,
  STEP2_FIELDS,
  defaultProtocolVersion,
  type Proto,
  type ProtoFamily,
  type WizardValues,
} from './wizard/types';
import Step2OAuth2OIDC from './wizard/Step2OAuth2OIDC';
import Step2Saml from './wizard/Step2Saml';
import Step2Cas from './wizard/Step2Cas';
import Step3Handoff from './wizard/Step3Handoff';
import { copyHandoffText, downloadHandoffJSON } from './wizard/handoff-utils';

export type { Proto, ProtoFamily };
export { PROTOCOL_VERSIONS, FAMILY_LABEL };

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
  onSubmit: (values: any) => Promise<OAuth2Client>;
}) {
  const { message } = AntdApp.useApp();
  const [step, setStep] = useState(0);
  const [form] = Form.useForm<WizardValues>();
  const [saving, setSaving] = useState(false);
  const logoUrl = Form.useWatch('logo_url', form);
  const isOIDC = family === 'oidc';
  const [discovery, setDiscovery] = useState<Record<string, any> | null>(null);

  // Step3 展示的"真实"应用数据：新建模式 = 后端 Create 返回；编辑模式 = 传入的 editing
  const [submitted, setSubmitted] = useState<OAuth2Client | null>(null);

  // OIDC / OAuth2 端点直接基于当前浏览器访问的域名拼出来。
  // 浏览器现在能打开本管理后台，证明应用方将来也会用同一个公网入口接入；
  // 这跟"后端 issuer = platform.site_url"是同一份事实，不用绕 /.well-known。
  useEffect(() => {
    if (!open) return;
    if (family !== 'oidc' && family !== 'oauth2') return;
    const origin = window.location.origin;
    setDiscovery({
      issuer: origin,
      authorization_endpoint: origin + '/oauth/authorize',
      token_endpoint: origin + '/oauth/token',
      userinfo_endpoint: origin + '/oauth/userinfo',
      jwks_uri: origin + '/oauth/jwks.json',
      end_session_endpoint: origin + '/oauth/end_session',
    });
  }, [open, family]);

  useEffect(() => {
    if (!open) {
      setSubmitted(null);
      return;
    }
    setSubmitted(editing || null);
  }, [open, editing]);

  useEffect(() => {
    if (!open) return;
    setStep(0);
    if (editing) {
      const p = ((editing.protocol as Proto) || family) as Proto;
      const editVersion = editing.protocol_version || defaultProtocolVersion(p);
      form.setFieldsValue({
        client_name: editing.client_name,
        protocol: p,
        protocol_version: editVersion,
        logo_url: editing.logo_url,
        login_url: editing.login_url || editing.home_url,
        is_active: editing.is_active,
        description: editing.description,

        redirect_uris: editing.redirect_uris || [],
        grant_types: (editing.grant_types || ['authorization_code']).filter((g) => g !== 'refresh_token'),
        subject_type: editing.subject_type || 'username',
        scope: (editing.scope || '').split(/\s+/).filter(Boolean),
        require_consent: !!editing.require_consent,
        require_pkce: !!editing.require_pkce,
        access_token_ttl: editing.access_token_ttl || 3600,
        refresh_token_ttl: editing.refresh_token_ttl || 604800,
        id_token_ttl: editing.id_token_ttl || 3600,
        issue_refresh_token: editing.issue_refresh_token !== false,

        oidc_issuer: editing.oidc_issuer,
        oidc_audience: editing.oidc_audience,
        oidc_id_token_signing_alg: editing.oidc_id_token_signing_alg || 'RS256',
        oidc_userinfo_response: editing.oidc_userinfo_response || 'NORMAL',
        oidc_claims: editing.oidc_claims || ALL_OIDC_CLAIMS,

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
        protocol: family,
        protocol_version: initVersion,
        is_active: true,
        redirect_uris: [],
        grant_types: ['authorization_code'],
        subject_type: 'username',
        scope: family === 'oidc'
          ? ['openid', 'profile', 'email', 'phone', 'roles']
          : ['profile', 'email'],
        require_consent: false,
        require_pkce: false,
        access_token_ttl: 3600,
        refresh_token_ttl: 604800,
        id_token_ttl: 3600,
        issue_refresh_token: true,
        oidc_id_token_signing_alg: 'RS256',
        oidc_userinfo_response: 'NORMAL',
        oidc_claims: ALL_OIDC_CLAIMS,
        saml_binding: 'Redirect-Post',
        saml_nameid_format: 'unspecified',
        saml_nameid_convert: 'original',
        saml_signature_algorithm: 'RSAwithSHA256',
        saml_digest_algorithm: 'SHA256',
        saml_encrypted: false,
        saml_validity_seconds: 300,
        cas_user_attribute: 'username',
        cas_expires_seconds: 300,
      });
    }
  }, [open, editing, family]);

  const buildPayload = (v: any) => {
    const backendProtocol: Proto = family;
    const base: any = {
      client_name: v.client_name,
      protocol: backendProtocol,
      protocol_version: v.protocol_version,
      logo_url: v.logo_url,
      home_url: v.login_url,
      login_url: v.login_url,
      is_active: v.is_active,
      description: v.description,
    };
    if (backendProtocol === 'oauth2' || backendProtocol === 'oidc') {
      Object.assign(base, {
        redirect_uris: v.redirect_uris || [],
        grant_types: v.grant_types || [],
        subject_type: v.subject_type,
        scope: (backendProtocol === 'oidc'
          ? ['openid', ...((v.scope || []).filter((s: string) => s !== 'openid'))]
          : (v.scope || [])
        ).join(' '),
        require_consent: v.require_consent,
        require_pkce: v.require_pkce,
        access_token_ttl: v.access_token_ttl,
        refresh_token_ttl: v.refresh_token_ttl,
        id_token_ttl: v.id_token_ttl,
        issue_refresh_token: v.issue_refresh_token,
      });
      if (backendProtocol === 'oidc') {
        Object.assign(base, {
          oidc_issuer: v.oidc_issuer,
          oidc_audience: v.oidc_audience,
          oidc_id_token_signing_alg: v.oidc_id_token_signing_alg,
          oidc_userinfo_response: v.oidc_userinfo_response,
          oidc_claims: v.oidc_claims,
        });
      }
    } else if (backendProtocol === 'saml') {
      Object.assign(base, {
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
      });
    } else if (backendProtocol === 'cas') {
      Object.assign(base, {
        cas_service: v.cas_service,
        cas_callback_url: v.cas_callback_url || v.cas_service,
        cas_user_attribute: v.cas_user_attribute,
        cas_expires_seconds: v.cas_expires_seconds,
      });
    }
    return base;
  };

  const handleNext = async () => {
    try {
      if (step === 0) {
        await form.validateFields(['client_name', 'login_url']);
        // 登录页跳转应用没有 Step2，直接提交 → Step3
        if (family === 'link') {
          const v = form.getFieldsValue(true);
          setSaving(true);
          try {
            const real = await onSubmit(buildPayload(v));
            setSubmitted(real);
            setStep(2);
          } catch (e: any) {
            message.error(e?.response?.data?.message || '提交失败');
          } finally {
            setSaving(false);
          }
          return;
        }
        setStep(1);
        return;
      }
      if (step === 1) {
        await form.validateFields(STEP2_FIELDS[family]);
        const v = form.getFieldsValue(true);
        setSaving(true);
        try {
          const real = await onSubmit(buildPayload(v));
          setSubmitted(real);
          setStep(2);
        } catch (e: any) {
          message.error(e?.response?.data?.message || '提交失败');
        } finally {
          setSaving(false);
        }
      }
    } catch {
      /* validateFields handles ui */
    }
  };

  const handleFinish = () => onClose();
  const summary = useMemo(() => form.getFieldsValue(true), [step, form]);

  return (
    <div className="app-wizard">
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 28 }}>
        <Steps
          current={family === 'link' && step === 2 ? 1 : step}
          items={
            family === 'link'
              ? [{ title: '应用信息' }, { title: '信息确认' }]
              : [{ title: '应用信息' }, { title: '客户端配置' }, { title: '信息确认' }]
          }
          style={{ width: family === 'link' ? 460 : 640 }}
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
              <Form.Item name="client_name" label="应用名称" rules={[{ required: true, message: '请输入应用名称' }]}>
                <Input placeholder="例如：JumpServer 演示" />
              </Form.Item>
              <Form.Item
                name="login_url"
                label="应用入口"
                rules={[
                  { required: true, message: '请输入应用入口地址' },
                  {
                    validator: (_, v) => {
                      if (!v) return Promise.resolve();
                      if (/^https?:\/\/.+/i.test(String(v).trim())) return Promise.resolve();
                      return Promise.reject(new Error('请填写完整 URL，必须以 http:// 或 https:// 开头'));
                    },
                  },
                ]}
              >
                <Input placeholder="https://app.example.com" />
              </Form.Item>
              <Form.Item label="协议版本" required>
                <Input
                  value={
                    PROTOCOL_VERSIONS[family].find((x) => x.value === defaultProtocolVersion(family))?.label
                    || FAMILY_LABEL[family]
                  }
                  disabled
                  style={{ background: '#f5f7fb' }}
                />
              </Form.Item>
              <Form.Item name="protocol" hidden><Input /></Form.Item>
              <Form.Item name="protocol_version" hidden><Input /></Form.Item>
              {editing && (family === 'oidc' || family === 'oauth2') && (
                <Form.Item label="客户端 ID">
                  <Input value={editing.client_id} disabled style={{ background: '#f5f7fb' }} />
                </Form.Item>
              )}
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
              <LogoUploader
                value={logoUrl}
                onChange={(u) => form.setFieldValue('logo_url', u)}
                buttonText="上传图标"
              />
              <Form.Item name="logo_url" hidden>
                <Input />
              </Form.Item>
            </div>
          </div>
        </div>

        {/* ============== Step 2 ============== */}
        <div style={{ display: step === 1 ? 'block' : 'none' }}>
          {(family === 'oidc' || family === 'oauth2') && <Step2OAuth2OIDC isOIDC={isOIDC} />}
          {family === 'saml' && <Step2Saml />}
          {family === 'cas' && <Step2Cas />}
        </div>

        {/* ============== Step 3 ============== */}
        <div style={{ display: step === 2 ? 'block' : 'none' }}>
          <Step3Handoff
            family={family}
            isOIDC={isOIDC}
            isNewly={!editing && !!submitted && !!submitted.client_secret}
            summary={summary}
            submitted={submitted}
            discovery={discovery}
          />
        </div>
      </Form>

      <div className="app-wizard-footer">
        <Button size="large" style={{ minWidth: 96 }} onClick={onClose}>关闭</Button>
        {step > 0 && step < 2 && (
          <Button size="large" style={{ minWidth: 96 }} onClick={() => setStep((s) => s - 1)}>
            上一步
          </Button>
        )}
        {step < 2 && (
          <Button size="large" type="primary" style={{ minWidth: 120 }} loading={saving} onClick={handleNext}>
            {/* link 应用 Step0 直接创建并完成 */}
            {step === 1
              ? (editing ? '保存并继续' : '创建并继续')
              : family === 'link'
                ? (editing ? '保存' : '创建')
                : '下一步'}
          </Button>
        )}
        {step === 2 && (
          <>
            {family !== 'link' && (
              <>
                <Button
                  size="large"
                  icon={<CopyOutlined />}
                  onClick={() => copyHandoffText(family, isOIDC, submitted, form.getFieldsValue(true), discovery, message)}
                >
                  复制全部配置
                </Button>
                <Button
                  size="large"
                  icon={<DownloadOutlined />}
                  onClick={() => downloadHandoffJSON(family, submitted, form.getFieldsValue(true), discovery)}
                >
                  下载 JSON
                </Button>
              </>
            )}
            <Button size="large" type="primary" style={{ minWidth: 120 }} onClick={handleFinish}>
              完成
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
