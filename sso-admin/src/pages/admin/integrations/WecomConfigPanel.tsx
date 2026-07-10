import { useEffect, useState } from 'react';
import { App as AntdApp, Button, Card, Form, Input, Skeleton, Space, Switch } from 'antd';
import { LockOutlined, ReloadOutlined } from '@ant-design/icons';
import { configApi } from '@/api/misc';
import { cardStyle, footerStyle, SectionHead } from './_shared';

const PASSWORD_KEYS = new Set(['secret']);
const BOOL_KEYS = new Set(['enabled', 'auto_create_user']);

export default function WecomConfigPanel() {
  const { message } = AntdApp.useApp();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const configs = await configApi.byCategory('wecom');
      const obj: Record<string, any> = {};
      configs.forEach((c) => {
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
    setSaving(true);
    try {
      await configApi.set(items);
      message.success('已保存');
      load();
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Card><Skeleton active paragraph={{ rows: 6 }} /></Card>;

  return (
    <Form form={form} layout="vertical" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={cardStyle}>
        <SectionHead title="基础配置" />
        <Form.Item label="是否启用企业微信登录" name="wecom.enabled" valuePropName="checked">
          <Switch checkedChildren="启用" unCheckedChildren="禁用" />
        </Form.Item>
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
        <Button type="primary" loading={saving} onClick={handleSave}>
          保存
        </Button>
      </div>
    </Form>
  );
}
