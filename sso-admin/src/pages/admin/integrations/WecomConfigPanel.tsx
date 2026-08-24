import { useEffect, useState } from 'react';
import { App as AntdApp, Button, Card, Form, Input, Skeleton, Switch } from 'antd';
import { CheckCircleOutlined, LockOutlined, ReloadOutlined } from '@ant-design/icons';
import { configApi, wecomConfigApi } from '@/api/misc';
import { cardStyle, footerStyle, SectionHead } from './_shared';

const PASSWORD_KEYS = new Set(['secret']);
const BOOL_KEYS = new Set(['enabled', 'auto_create_user']);

export default function WecomConfigPanel() {
  const { message } = AntdApp.useApp();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [verified, setVerified] = useState(false);
  const [verifying, setVerifying] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const configs = await configApi.byCategory('wecom');
      const obj: Record<string, any> = {};
      configs.forEach((c) => {
        if (c.key === 'verified') {
          setVerified(c.value === 'true');
          return;
        }
        const fieldKey = `wecom.${c.key}`;
        if (PASSWORD_KEYS.has(c.key)) {
          obj[fieldKey] = '';
        } else if (BOOL_KEYS.has(c.key)) {
          obj[fieldKey] = c.value === 'true';
        } else {
          obj[fieldKey] = c.value;
        }
      });
      form.setFieldsValue(obj);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSave = async () => {
    const values = form.getFieldsValue();
    const items: Array<{ category: string; key: string; value: string }> = [];
    for (const [k, v] of Object.entries(values)) {
      if (v == null) continue;
      const [, key] = k.split('.');
      if (PASSWORD_KEYS.has(key) && v === '') continue;
      items.push({ category: 'wecom', key, value: typeof v === 'boolean' ? (v ? 'true' : 'false') : String(v) });
    }
    // 携带当前校验状态，避免保存时把后端已落库的 verified 冲掉
    if (verified) {
      items.push({ category: 'wecom', key: 'verified', value: 'true' });
    }
    setSaving(true);
    try {
      await configApi.set(items);
      message.success('已保存');
      load();
    } finally {
      setSaving(false);
    }
  };

  // 校验配置：用 corp_id + secret 向企微换取 token 验证有效性；后端校验成功会落库 verified=true，
  // 之后「启用企业微信登录」开关才会放开（后端 Enabled() 也要求 verified=true）。
  const handleVerify = async () => {
    const v = form.getFieldsValue();
    setVerifying(true);
    try {
      await wecomConfigApi.verify({
        corp_id: String(v['wecom.corp_id'] || '').trim(),
        secret: String(v['wecom.secret'] || ''),
      });
      // 后端已落库 verified=true；前端同步放出开关，并默认开启（用户保存后即时生效）。
      setVerified(true);
      form.setFieldValue('wecom.enabled', true);
      message.success('企业微信配置校验通过，已为您开启登录开关，点击保存即可生效');
    } catch (e: any) {
      setVerified(false);
      message.error(e?.response?.data?.message || '校验失败，请检查 CorpID / Secret');
    } finally {
      setVerifying(false);
    }
  };

  if (loading) return <Card><Skeleton active paragraph={{ rows: 6 }} /></Card>;

  return (
    <Form form={form} layout="vertical" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={cardStyle}>
        <SectionHead title="基础配置" />
        <Form.Item label="是否启用企业微信登录" name="wecom.enabled" valuePropName="checked">
          <Switch disabled={!verified} checkedChildren="启用" unCheckedChildren="禁用" />
        </Form.Item>
        {!verified && (
          <div style={{ color: '#fa8c16', fontSize: 12, marginTop: -8, marginBottom: 8, paddingLeft: 11 }}>
            请先点击底部「校验」验证 CorpID / Secret 有效性，校验通过后才能启用企业微信登录；修改凭据后请重新校验。
          </div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', columnGap: 32 }}>
          <Form.Item label="CorpID" name="wecom.corp_id">
            <Input placeholder="企业唯一标识 CorpID" />
          </Form.Item>
          <Form.Item label="应用 AgentID" name="wecom.agent_id">
            <Input placeholder="自建应用 AgentID" />
          </Form.Item>
          <Form.Item label="应用 Secret" name="wecom.secret">
            <Input.Password prefix={<LockOutlined style={{ color: '#94a3b8' }} />} placeholder="保存后留空表示不修改" autoComplete="new-password" />
          </Form.Item>
          <Form.Item label="未注册用户自动创建" name="wecom.auto_create_user" valuePropName="checked">
            <Switch checkedChildren="允许" unCheckedChildren="禁止" />
          </Form.Item>
        </div>
        <div style={{ color: '#94a3b8', fontSize: 12, marginTop: 8, paddingLeft: 11 }}>
          回调地址需在企业微信后台填：<code>{`${location.origin}/oauth/wecom/callback`}</code>
        </div>
      </div>

      <div style={footerStyle}>
        <Button icon={<ReloadOutlined />} onClick={load}>
          刷新
        </Button>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button icon={<CheckCircleOutlined />} onClick={handleVerify} loading={verifying}>
            校验
          </Button>
          <Button type="primary" loading={saving} onClick={handleSave}>
            保存
          </Button>
        </div>
      </div>
    </Form>
  );
}
