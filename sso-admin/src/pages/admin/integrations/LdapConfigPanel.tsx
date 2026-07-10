import { useEffect, useState } from 'react';
import { App as AntdApp, Button, Card, Form, Input, Skeleton, Space, Switch } from 'antd';
import { GlobalOutlined, LockOutlined, ReloadOutlined, UserOutlined } from '@ant-design/icons';
import { configApi } from '@/api/misc';
import request from '@/api/request';
import { cardStyle, footerStyle, SectionHead } from './_shared';

const PASSWORD_KEYS = new Set(['bind_password']);
const BOOL_KEYS = new Set(['enabled', 'start_tls']);

export default function LdapConfigPanel() {
  const { message } = AntdApp.useApp();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const configs = await configApi.byCategory('ldap');
      const obj: Record<string, any> = {};
      configs.forEach((c) => {
        const fieldKey = `ldap.${c.key}`;
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
      items.push({ category: 'ldap', key, value: typeof v === 'boolean' ? (v ? 'true' : 'false') : String(v) });
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

  const testConnection = async () => {
    setTesting(true);
    try {
      await request.post('/configs/test-ldap');
      message.success('LDAP 连接成功');
    } catch (e: any) {
      message.error(e?.response?.data?.message || 'LDAP 连接失败');
    } finally {
      setTesting(false);
    }
  };

  if (loading) return <Card><Skeleton active paragraph={{ rows: 10 }} /></Card>;

  return (
    <Form form={form} layout="vertical" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={cardStyle}>
        <SectionHead title="基础配置" />
        <Form.Item label="是否启用 LDAP / AD 登录" name="ldap.enabled" valuePropName="checked">
          <Switch checkedChildren="启用" unCheckedChildren="禁用" />
        </Form.Item>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', columnGap: 32 }}>
          <Form.Item label="LDAP 服务器地址" name="ldap.url">
            <Input prefix={<GlobalOutlined style={{ color: '#94a3b8' }} />} placeholder="ldap://10.0.0.1:389 或 ldaps://ad.example.com:636" />
          </Form.Item>
          <Form.Item label="使用 StartTLS" name="ldap.start_tls" valuePropName="checked">
            <Switch checkedChildren="开启" unCheckedChildren="关闭" />
          </Form.Item>

          <Form.Item label="管理员 Bind DN" name="ldap.bind_dn">
            <Input prefix={<UserOutlined style={{ color: '#94a3b8' }} />} placeholder="cn=admin,dc=example,dc=com" />
          </Form.Item>
          <Form.Item label="管理员 Bind 密码" name="ldap.bind_password">
            <Input.Password
              prefix={<LockOutlined style={{ color: '#94a3b8' }} />}
              placeholder="保存后留空表示不修改"
              autoComplete="new-password"
            />
          </Form.Item>

          <Form.Item label="用户搜索基准 DN" name="ldap.base_dn">
            <Input placeholder="ou=users,dc=example,dc=com" />
          </Form.Item>
          <Form.Item label="用户搜索过滤器" name="ldap.user_filter">
            <Input placeholder="(&(objectClass=person)(|(uid=%s)(sAMAccountName=%s)(mail=%s)))" />
          </Form.Item>
        </div>
      </div>

      <div style={cardStyle}>
        <SectionHead title="属性映射" />
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', columnGap: 32 }}>
          <Form.Item label="登录账号 (username)" name="ldap.attr_username">
            <Input placeholder="sAMAccountName / uid" />
          </Form.Item>
          <Form.Item label="姓名 (display name)" name="ldap.attr_displayname">
            <Input placeholder="displayName / cn" />
          </Form.Item>
          <Form.Item label="邮箱" name="ldap.attr_email">
            <Input placeholder="mail" />
          </Form.Item>
          <Form.Item label="手机号" name="ldap.attr_phone">
            <Input placeholder="mobile / telephoneNumber" />
          </Form.Item>
        </div>
      </div>

      <div style={footerStyle}>
        <Button icon={<ReloadOutlined />} onClick={load}>
          刷新
        </Button>
        <Space>
          <Button loading={testing} onClick={testConnection}>
            测试连接
          </Button>
          <Button type="primary" loading={saving} onClick={handleSave}>
            保存
          </Button>
        </Space>
      </div>
    </Form>
  );
}
