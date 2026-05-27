import { useEffect } from 'react';
import { Form, Input, Button, Checkbox, App as AntdApp } from 'antd';
import { UserOutlined, LockOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import { useSite } from '@/hooks/useSite';
import './login.css';

export default function LoginPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { message } = AntdApp.useApp();
  const returnTo = searchParams.get('return_to') || '';

  const { login, isAuthenticated, user } = useAuthStore();
  const site = useSite();

  useEffect(() => {
    if (isAuthenticated && user) {
      handleRedirect(user.is_staff);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRedirect = (_isStaff: boolean) => {
    if (returnTo) {
      if (returnTo.startsWith('/oauth/authorize')) {
        window.location.replace(returnTo);
        return;
      }
      navigate(returnTo);
      return;
    }
    navigate('/portal');
  };

  const onFinish = async (values: { username: string; password: string; remember?: boolean }) => {
    try {
      const u = await login(values.username, values.password, values.remember);
      message.success(`欢迎回来，${u.nickname || u.username}`);
      handleRedirect(u.is_staff);
    } catch (e: any) {
      const msg = e?.response?.data?.message || '登录失败';
      message.error(msg);
    }
  };

  const year = new Date().getFullYear();

  return (
    <div className="login-page">
      <div className="login-card">
        <h2 className="login-title">欢迎登录 {site.name}</h2>

        <Form
          size="large"
          onFinish={onFinish}
          initialValues={{ remember: true }}
          autoComplete="off"
          requiredMark={false}
        >
          <Form.Item name="username" rules={[{ required: true, message: '请输入账号或邮箱' }]}>
            <Input prefix={<UserOutlined />} placeholder="账号 / 邮箱" />
          </Form.Item>
          <Form.Item name="password" rules={[{ required: true, message: '请输入密码' }]}>
            <Input.Password prefix={<LockOutlined />} placeholder="密码" />
          </Form.Item>

          <div className="login-row">
            <Form.Item name="remember" valuePropName="checked" noStyle>
              <Checkbox>记住我</Checkbox>
            </Form.Item>
            <a className="login-forgot" href="#">忘记密码</a>
          </div>

          <Form.Item>
            <Button type="primary" htmlType="submit" block className="login-submit">
              登 录
            </Button>
          </Form.Item>
        </Form>
      </div>

      <div className="login-footer">
        <span className="login-footer-brand">
          <SafetyCertificateOutlined />
          <span>© {year} {site.name}. 保留所有权利。</span>
        </span>
        <span className="login-footer-links">
          <a href="#">隐私政策</a>
          <span className="sep">|</span>
          <a href="#">服务条款</a>
        </span>
      </div>
    </div>
  );
}
