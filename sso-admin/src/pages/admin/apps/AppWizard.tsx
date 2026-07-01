import { useEffect, useMemo, useState } from 'react';
import {
  Form,
  Input,
  Switch,
  Steps,
  Button,
  Upload,
  App as AntdApp,
} from 'antd';
import { CopyOutlined, DownloadOutlined, AppstoreOutlined } from '@ant-design/icons';
import type { OAuth2Client } from '@/api/apps';
import { useAuthStore } from '@/store/authStore';
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
import Step3AppPerm from './wizard/Step3AppPerm';
import Step3Handoff from './wizard/Step3Handoff';
import { copyHandoffText, downloadHandoffJSON } from './wizard/handoff-utils';

export type { Proto, ProtoFamily };
export { PROTOCOL_VERSIONS, FAMILY_LABEL };

export default function AppWizard({
  open,
  family,
  editing,
  isDuplicate,
  onClose,
  onSubmit,
}: {
  open: boolean;
  family: ProtoFamily;
  editing: OAuth2Client | null;
  isDuplicate?: boolean;
  onClose: () => void;
  onSubmit: (values: any) => Promise<OAuth2Client>;
}) {
  const { message } = AntdApp.useApp();
  const [step, setStep] = useState(0);
  const [form] = Form.useForm<WizardValues>();
  const [saving, setSaving] = useState(false);
  const logoUrl = Form.useWatch('logo_url', form);
  const isOIDC = family === 'oidc';
  const hasOpenId = family === 'oidc' || family === 'oauth2';
  const [discovery, setDiscovery] = useState<Record<string, any> | null>(null);

  // 内联 Logo 上传配置（Step0 横向布局复用）
  const uploadConfig = useMemo(() => ({
    name: 'file',
    action: '/api/v1/configs/upload-image',
    headers: { Authorization: `Bearer ${useAuthStore.getState().accessToken}` },
    data: { prefix: 'app' },
    accept: '.png,.jpg,.jpeg,.svg,.webp,.gif',
    showUploadList: false,
    beforeUpload: (file: File) => {
      if (file.size > 2 * 1024 * 1024) {
        message.error('图片不能超过 2MB');
        return Upload.LIST_IGNORE;
      }
      return true;
    },
    onChange: (info: any) => {
      if (info.file.status === 'done') {
        const url = info.file.response?.data?.url;
        if (url) {
          form.setFieldValue('logo_url', url);
          message.success('图标已上传');
        }
      } else if (info.file.status === 'error') {
        message.error(info.file.response?.message || '上传失败');
      }
    },
  }), [message, form]);

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
        cas_return_attributes: editing.cas_return_attributes !== false,

        access_policy: (editing as any).access_policy || 'assigned',
        grants: (editing as any).grants || [],
        visible_in_portal: (editing as any).visible_in_portal !== false,
        allow_idp_initiated: (editing as any).allow_idp_initiated !== false,
        allow_sp_initiated: (editing as any).allow_sp_initiated !== false,
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
        scope: ['profile', 'email'],
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
        cas_return_attributes: true,

        access_policy: 'assigned',
        grants: [],
        visible_in_portal: true,
        allow_idp_initiated: true,
        allow_sp_initiated: true,
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
        scope: (v.scope || []).join(' '),
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
        cas_return_attributes: !!v.cas_return_attributes,
      });
    }
    // 访问授权
    const policy = v.access_policy || 'assigned';
    base.access_policy = policy;
    base.visible_in_portal = v.visible_in_portal !== false;
    base.allow_idp_initiated = v.allow_idp_initiated !== false;
    base.allow_sp_initiated = v.allow_sp_initiated !== false;
    base.grants =
      policy === 'assigned'
        ? (v.grants || []).map((g: any) => ({
            principal_type: g.principal_type,
            principal_id: g.principal_id,
          }))
        : [];
    return base;
  };

  const submitAndAdvance = async () => {
    const v = form.getFieldsValue(true);
    setSaving(true);
    try {
      const real = await onSubmit(buildPayload(v));
      setSubmitted(real);
      setStep(3);
    } catch (e: any) {
      message.error(e?.response?.data?.message || '提交失败');
    } finally {
      setSaving(false);
    }
  };

  const handleNext = async () => {
    try {
      if (step === 0) {
        await form.validateFields(['client_name', 'login_url']);
        // link 协议没有客户端配置步骤，直接进入应用授权
        setStep(family === 'link' ? 2 : 1);
        return;
      }
      if (step === 1) {
        await form.validateFields(STEP2_FIELDS[family]);
        setStep(2);
        return;
      }
      if (step === 2) {
        // 访问授权步骤：assigned 时校验已选 principal 至少 1 个
        const v = form.getFieldsValue(true);
        const policy = v.access_policy || 'assigned';
        if (policy === 'assigned' && (!v.grants || v.grants.length === 0)) {
          message.warning('请至少选择一个用户、组织或用户组，或切换到「所有人可访问」/「暂不授权」');
          return;
        }
        await submitAndAdvance();
      }
    } catch {
      /* validateFields handles ui */
    }
  };

  const handleFinish = () => onClose();
  const summary = useMemo(() => form.getFieldsValue(true), [step, form]);

  return (
    <div className="app-wizard">
      <div className="app-wizard-steps">
        <Steps
          current={family === 'link' && step >= 2 ? step - 1 : step}
          items={
            family === 'link'
              ? [{ title: '应用信息' }, { title: '应用授权' }, { title: '信息确认' }]
              : [{ title: '应用信息' }, { title: '客户端配置' }, { title: '应用授权' }, { title: '信息确认' }]
          }
        />
      </div>

      <Form form={form} layout="vertical">
        {/* ============== Step 0 应用信息（共用） ============== */}
        <div style={{ display: step === 0 ? 'block' : 'none' }}>
          <div className="wizard-form-body">
            {/* 应用图标 — 横向流式布局 */}
            <Form.Item label="应用图标">
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <Upload {...uploadConfig}>
                  <div
                    style={{
                      width: 64,
                      height: 64,
                      borderRadius: 12,
                      border: logoUrl ? '1px solid #eef0f5' : '1.5px dashed #c7d2fe',
                      background: logoUrl ? '#fff' : 'linear-gradient(180deg, #fafbff 0%, #eef2ff 100%)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                      overflow: 'hidden',
                      flexShrink: 0,
                      transition: 'border-color 0.2s',
                    }}
                  >
                    {logoUrl ? (
                      <img src={logoUrl} alt="logo" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                    ) : (
                      <AppstoreOutlined style={{ fontSize: 24, color: '#94a3b8' }} />
                    )}
                  </div>
                </Upload>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <Upload {...uploadConfig}>
                    <Button size="small" style={{ fontSize: 13 }}>上传图标</Button>
                  </Upload>
                  <span style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.4 }}>
                    支持 JPG、PNG，建议 256×256
                  </span>
                </div>
              </div>
            </Form.Item>
            <Form.Item name="logo_url" hidden>
              <Input />
            </Form.Item>

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

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <Form.Item name="is_active" label="状态" valuePropName="checked" rules={[{ required: true }]}>
                <Switch />
              </Form.Item>
              <Form.Item
                name="visible_in_portal"
                label="是否显示"
                valuePropName="checked"
                rules={[{ required: true }]}
              >
                <Switch />
              </Form.Item>
            </div>

            <Form.Item name="description" label="描述">
              <Input.TextArea rows={3} placeholder="一句话描述该应用" />
            </Form.Item>
          </div>
        </div>

        {/* ============== Step 2 客户端配置 ============== */}
        <div style={{ display: step === 1 ? 'block' : 'none' }}>
          {(family === 'oidc' || family === 'oauth2') && <Step2OAuth2OIDC isOIDC={isOIDC} hasOpenId={hasOpenId} />}
          {family === 'saml' && <Step2Saml />}
          {family === 'cas' && <Step2Cas />}
        </div>

        {/* ============== Step 3 应用授权 ============== */}
        <div style={{ display: step === 2 ? 'block' : 'none' }}>
          <Step3AppPerm />
        </div>

        {/* ============== Step 4 信息确认 ============== */}
        <div style={{ display: step === 3 ? 'block' : 'none' }}>
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
        <Button onClick={onClose}>关闭</Button>
        {step > 0 && step < 3 && (
          <Button
            onClick={() => {
              // link 协议从 step2 退回 step0（跳过 step1）
              if (family === 'link' && step === 2) {
                setStep(0);
              } else {
                setStep((s) => s - 1);
              }
            }}
          >
            上一步
          </Button>
        )}
        {step < 3 && (
          <Button type="primary" loading={saving} onClick={handleNext}>
            {step === 2 ? (editing && !isDuplicate ? '保存并继续' : '创建并继续') : '下一步'}
          </Button>
        )}
        {step === 3 && (
          <>
            {family !== 'link' && (
              <>
                <Button
                  icon={<CopyOutlined />}
                  onClick={() => copyHandoffText(family, isOIDC, submitted, form.getFieldsValue(true), discovery, message)}
                >
                  复制全部配置
                </Button>
                <Button
                  icon={<DownloadOutlined />}
                  onClick={() => downloadHandoffJSON(family, submitted, form.getFieldsValue(true), discovery)}
                >
                  下载 JSON
                </Button>
              </>
            )}
            <Button type="primary" onClick={handleFinish}>
              完成
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
