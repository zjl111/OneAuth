import { useState } from 'react';
import { Form, Input, Switch, Button, App as AntdApp } from 'antd';
import { LockOutlined, GlobalOutlined, UserOutlined, ApiOutlined } from '@ant-design/icons';
import request from '@/api/request';
import { SectionHead, cardStyle } from './_shared';

export default function LdapPanel() {
  const { message } = AntdApp.useApp();
  const [testing, setTesting] = useState(false);

  const handleTest = async () => {
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
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
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

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          gap: 12,
          background: '#fff',
          border: '1px solid #eef0f5',
          borderRadius: 12,
          padding: '14px 20px',
        }}
      >
        <span style={{ color: '#94a3b8', fontSize: 13, marginRight: 'auto' }}>
          先保存配置后再点击测试连接
        </span>
        <Button icon={<ApiOutlined />} loading={testing} onClick={handleTest}>
          测试连接
        </Button>
      </div>
    </div>
  );
}
