import { useEffect, useMemo, useState } from 'react';
import { Card, Form, Input, InputNumber, Button, App as AntdApp, Tabs, Alert, Tag, Space, Upload, Select } from 'antd';
import { UploadOutlined, MailOutlined } from '@ant-design/icons';
import { configApi, type SystemConfig } from '@/api/misc';
import { invalidateSiteCache } from '@/hooks/useSite';
import { useAuthStore } from '@/store/authStore';
import request from '@/api/request';

const READONLY_OAUTH_KEYS = new Set([
  'id_token_signing_alg',
  'grant_types_supported',
  'response_types_supported',
  'pkce_required_for_public_clients',
]);

const NUMERIC_OAUTH_KEYS = new Set([
  'access_token_ttl',
  'refresh_token_ttl',
  'auth_code_ttl',
]);

const NUMERIC_SECURITY_KEYS = new Set([
  'session_timeout',
  'password_min_length',
  'login_lockout_threshold',
  'login_lockout_duration',
]);

const NUMERIC_MONITOR_KEYS = new Set(['interval']);
const NUMERIC_SMTP_KEYS = new Set(['port']);
const PASSWORD_SMTP_KEYS = new Set(['password']);
const BOOLEAN_SMTP_KEYS = new Set(['enabled']);
const ENUM_SMTP_KEYS: Record<string, string[]> = { use_tls: ['ssl', 'starttls', 'none'] };

const categoryLabel: Record<string, string> = {
  platform: '平台信息',
  security: '安全策略',
  monitor: '监控设置',
  smtp: '邮件 (SMTP)',
  oauth: 'OAuth2 / OIDC 协议',
};

function isNumeric(category: string, key: string) {
  if (category === 'oauth') return NUMERIC_OAUTH_KEYS.has(key);
  if (category === 'security') return NUMERIC_SECURITY_KEYS.has(key);
  if (category === 'monitor') return NUMERIC_MONITOR_KEYS.has(key);
  if (category === 'smtp') return NUMERIC_SMTP_KEYS.has(key);
  return false;
}

function isReadOnly(category: string, key: string) {
  return category === 'oauth' && READONLY_OAUTH_KEYS.has(key);
}

export default function SettingsPage() {
  const { message, modal } = AntdApp.useApp();
  const [data, setData] = useState<SystemConfig[]>([]);
  const [form] = Form.useForm();

  const load = async () => {
    const d = await configApi.list();
    setData(d);
    const obj: Record<string, string | number> = {};
    d.forEach((c) => {
      const isPasswordField = c.category === 'smtp' && PASSWORD_SMTP_KEYS.has(c.key);
      if (isPasswordField) {
        // 密码字段不回显已保存值，留空给运营
        obj[`${c.category}.${c.key}`] = '';
      } else {
        obj[`${c.category}.${c.key}`] = isNumeric(c.category, c.key) ? Number(c.value) : c.value;
      }
    });
    form.setFieldsValue(obj);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const grouped = useMemo(() => {
    const g: Record<string, SystemConfig[]> = {};
    data.forEach((c) => {
      (g[c.category] ||= []).push(c);
    });
    return g;
  }, [data]);

  const handleSave = async () => {
    const values = form.getFieldsValue();
    const items: Array<{ category: string; key: string; value: string }> = [];
    for (const [k, v] of Object.entries(values)) {
      if (v == null) continue;
      const [category, ...rest] = k.split('.');
      const key = rest.join('.');
      if (isReadOnly(category, key)) continue;
      // SMTP 密码留空 = 不修改
      if (category === 'smtp' && PASSWORD_SMTP_KEYS.has(key) && v === '') continue;
      items.push({ category, key, value: String(v) });
    }
    await configApi.set(items);
    invalidateSiteCache();
    message.success('已保存，OAuth 相关变更需重启服务生效');
    load();
  };

  const accessToken = useAuthStore((s) => s.accessToken);
  const logoValue = (Form.useWatch('platform.logo', form) as string | undefined) || '';

  const renderField = (c: SystemConfig) => {
    const readOnly = isReadOnly(c.category, c.key);
    const numeric = isNumeric(c.category, c.key);
    if (readOnly) {
      return <Input value={c.value} disabled />;
    }
    if (c.category === 'platform' && c.key === 'logo') {
      return (
        <Space align="start" size={16}>
          <div
            style={{
              width: 72,
              height: 72,
              border: '1px dashed #d9d9d9',
              borderRadius: 8,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: '#fafafa',
              overflow: 'hidden',
            }}
          >
            {logoValue ? (
              <img src={logoValue} alt="logo" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
            ) : (
              <span style={{ color: '#94a3b8', fontSize: 12 }}>未设置</span>
            )}
          </div>
          <Space direction="vertical" size={4}>
            <Upload
              name="file"
              action="/api/v1/configs/upload-logo"
              headers={{ Authorization: `Bearer ${accessToken}` }}
              accept=".png,.jpg,.jpeg,.svg,.webp,.gif"
              showUploadList={false}
              beforeUpload={(file) => {
                if (file.size > 5 * 1024 * 1024) {
                  message.error('文件不能超过 5MB');
                  return Upload.LIST_IGNORE;
                }
                return true;
              }}
              onChange={(info) => {
                if (info.file.status === 'done') {
                  const url = info.file.response?.data?.url;
                  if (url) {
                    form.setFieldValue('platform.logo', url);
                    invalidateSiteCache();
                    message.success('Logo 已更新');
                  }
                } else if (info.file.status === 'error') {
                  message.error(info.file.response?.message || '上传失败');
                }
              }}
            >
              <Button icon={<UploadOutlined />}>上传 Logo</Button>
            </Upload>
            <Input
              value={logoValue}
              onChange={(e) => form.setFieldValue('platform.logo', e.target.value)}
              placeholder="或填入图片 URL"
              style={{ width: 320 }}
            />
            {logoValue && (
              <Button
                type="link"
                size="small"
                danger
                onClick={() => form.setFieldValue('platform.logo', '')}
                style={{ padding: 0 }}
              >
                清除
              </Button>
            )}
          </Space>
        </Space>
      );
    }
    if (numeric) {
      return <InputNumber min={0} style={{ width: '100%' }} addonAfter={c.key.endsWith('_ttl') || c.key.includes('timeout') || c.key.includes('duration') ? '秒' : undefined} />;
    }
    if (c.category === 'smtp' && BOOLEAN_SMTP_KEYS.has(c.key)) {
      return (
        <Select
          options={[
            { value: 'true', label: '启用' },
            { value: 'false', label: '禁用' },
          ]}
          style={{ width: 220 }}
        />
      );
    }
    if (c.category === 'smtp' && PASSWORD_SMTP_KEYS.has(c.key)) {
      return <Input.Password placeholder="保存后不再回显，留空表示不修改" autoComplete="new-password" />;
    }
    if (c.category === 'smtp' && ENUM_SMTP_KEYS[c.key]) {
      return (
        <Select
          options={ENUM_SMTP_KEYS[c.key].map((v) => ({ value: v, label: v.toUpperCase() }))}
          style={{ width: 220 }}
        />
      );
    }
    return <Input />;
  };

  const testSMTP = () => {
    let to = '';
    modal.confirm({
      title: '发送测试邮件',
      content: (
        <Input
          placeholder="测试收件邮箱"
          onChange={(e) => (to = e.target.value)}
        />
      ),
      okText: '发送',
      onOk: async () => {
        if (!to) {
          message.error('请输入收件邮箱');
          return Promise.reject();
        }
        try {
          await request.post('/configs/test-smtp', { to });
          message.success(`已发送测试邮件到 ${to}`);
        } catch (e: any) {
          message.error(e?.response?.data?.message || '发送失败');
        }
      },
    });
  };

  return (
    <Card>
      <Form form={form} layout="vertical">
        <Tabs
          items={Object.entries(grouped).map(([cat, items]) => ({
            key: cat,
            label: (
              <span>
                {categoryLabel[cat] || cat}
                {cat === 'oauth' && (
                  <Tag color="orange" style={{ marginLeft: 8 }}>
                    重启生效
                  </Tag>
                )}
              </span>
            ),
            children: (
              <>
                {cat === 'oauth' && (
                  <Alert
                    showIcon
                    type="warning"
                    style={{ marginBottom: 16 }}
                    message="OAuth/OIDC 协议参数修改后需要重启后端服务才会生效"
                    description={
                      <Space direction="vertical" size={2}>
                        <span>• <b>Issuer</b> 一旦改变，所有已签发的 JWT 会因 `iss` 校验失败而失效。</span>
                        <span>• <b>Access Token TTL</b> 减小只影响新签发的 Token；增大不会延长已签发 Token 的有效期。</span>
                        <span>• 标记为"只读"的字段反映了当前实现能力，不可在 UI 修改。</span>
                      </Space>
                    }
                  />
                )}
                {cat === 'smtp' && (
                  <Alert
                    showIcon
                    type="info"
                    style={{ marginBottom: 16 }}
                    message="SMTP 配置用于「忘记密码」邮件发送等场景"
                    description={
                      <Space direction="vertical" size={2}>
                        <span>• 密码保存后不再回显，留空提交表示<b>不修改</b>密码。</span>
                        <span>• <b>use_tls</b>：QQ/腾讯企业邮箱用 <code>ssl</code>(465)；Gmail/Outlook 用 <code>starttls</code>(587)。</span>
                        <span>• 修改后建议点击右上角「发送测试邮件」验证配置。</span>
                      </Space>
                    }
                    action={
                      <Button size="small" type="primary" icon={<MailOutlined />} onClick={testSMTP}>
                        发送测试邮件
                      </Button>
                    }
                  />
                )}
                {items.map((c) => (
                  <Form.Item
                    key={c.id}
                    label={c.description || c.key}
                    name={`${c.category}.${c.key}`}
                    extra={
                      <span style={{ color: '#94a3b8', fontSize: 12 }}>
                        <code>{c.key}</code>
                      </span>
                    }
                  >
                    {renderField(c)}
                  </Form.Item>
                ))}
              </>
            ),
          }))}
        />
        <Button type="primary" onClick={handleSave}>
          保存
        </Button>
      </Form>
    </Card>
  );
}
