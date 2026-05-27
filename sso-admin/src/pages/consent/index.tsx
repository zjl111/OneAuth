import { useEffect, useState } from 'react';
import { Button, Card, Tag, Space, App as AntdApp } from 'antd';
import { useSearchParams } from 'react-router-dom';
import { SafetyCertificateOutlined } from '@ant-design/icons';
import { useAuthStore } from '@/store/authStore';

interface AppMeta {
  client_name: string;
  description?: string;
  logo_url?: string;
}

export default function ConsentPage() {
  const [searchParams] = useSearchParams();
  const { message } = AntdApp.useApp();
  const user = useAuthStore((s) => s.user);

  const clientId = searchParams.get('client_id') || '';
  const scope = searchParams.get('scope') || '';
  const scopes = scope.split(/\s+/).filter(Boolean);

  const [meta, setMeta] = useState<AppMeta>({ client_name: clientId });

  useEffect(() => {
    // 简单显示 client_id；要展示完整元信息可后端补一个公开端点
    setMeta({ client_name: clientId });
  }, [clientId]);

  const buildAuthorizeURL = (consent: boolean) => {
    const params = new URLSearchParams();
    searchParams.forEach((v, k) => params.set(k, v));
    params.set('response_type', 'code');
    if (consent) params.set('consent', '1');
    return '/oauth/authorize?' + params.toString();
  };

  const handleAgree = () => {
    window.location.replace(buildAuthorizeURL(true));
  };
  const handleCancel = () => {
    // 取消授权：跳回 redirect_uri 携带 error
    const redirect = searchParams.get('redirect_uri') || '/';
    const state = searchParams.get('state') || '';
    const sep = redirect.includes('?') ? '&' : '?';
    window.location.replace(
      `${redirect}${sep}error=access_denied&error_description=user+denied&state=${encodeURIComponent(state)}`
    );
    message.warning('已拒绝授权');
  };

  const scopeDesc: Record<string, string> = {
    openid: '识别您的身份',
    profile: '访问您的基本资料（昵称、头像）',
    email: '访问您的邮箱',
    phone: '访问您的手机号',
    roles: '访问您所属的角色',
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #e8f0ff 0%, #f4f7ff 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
      }}
    >
      <Card style={{ width: 480, borderRadius: 12, boxShadow: '0 20px 60px rgba(0,0,0,0.08)' }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div
            style={{
              width: 64,
              height: 64,
              margin: '0 auto 16px',
              borderRadius: 16,
              background: 'linear-gradient(135deg, #1677ff, #4f8cff)',
              color: '#fff',
              display: 'grid',
              placeItems: 'center',
              fontSize: 32,
            }}
          >
            <SafetyCertificateOutlined />
          </div>
          <h2 style={{ margin: 0 }}>授权确认</h2>
          <p style={{ color: '#6b7280', marginTop: 8 }}>
            <b>{meta.client_name}</b> 正在请求访问您的账号
          </p>
        </div>

        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 8 }}>当前用户：</div>
          <Tag color="blue">{user?.nickname || user?.username}</Tag>
        </div>

        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 8 }}>该应用将获得：</div>
          <ul style={{ paddingLeft: 20, lineHeight: '28px', color: '#1f2937' }}>
            {scopes.map((s) => (
              <li key={s}>{scopeDesc[s] || s}</li>
            ))}
          </ul>
        </div>

        <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
          <Button onClick={handleCancel}>拒绝</Button>
          <Button type="primary" onClick={handleAgree}>
            同意授权
          </Button>
        </Space>
      </Card>
    </div>
  );
}
