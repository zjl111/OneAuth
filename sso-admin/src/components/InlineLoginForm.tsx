import { useEffect, useState } from 'react';
import { Form, Input, Button, App as AntdApp, Divider } from 'antd';
import { UserOutlined, LockOutlined, WechatOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import { useSite } from '@/hooks/useSite';
import { get } from '@/api/request';
import WecomQRLogin from './WecomQRLogin';
import SliderCaptcha from './SliderCaptcha';

interface Props {
  redirectTo?: string;
  returnTo?: string;
}

/**
 * 嵌入式登录表单 —— 直接显示在页面中（非弹框）
 * 用于 login_style === 'inline' 时替代 LoginModal
 */
export default function InlineLoginForm({ redirectTo = '/portal', returnTo }: Props) {
  const navigate = useNavigate();
  const { message } = AntdApp.useApp();
  const site = useSite();
  const login = useAuthStore((s) => s.login);
  const [submitting, setSubmitting] = useState(false);
  const [wecomEnabled, setWecomEnabled] = useState(false);
  const [showWecomQR, setShowWecomQR] = useState(false);
  const [captchaOpen, setCaptchaOpen] = useState(false);
  const [pending, setPending] = useState<{ username: string; password: string } | null>(null);

  useEffect(() => {
    get<{ enabled: boolean }>('/auth/wecom/status')
      .then((d) => setWecomEnabled(!!d?.enabled))
      .catch(() => setWecomEnabled(false));
  }, []);

  const doLogin = async (username: string, password: string, ticket?: string) => {
    setSubmitting(true);
    try {
      const u = await login(username, password, undefined, ticket);
      message.success(`欢迎回来，${u.nickname || u.username}`);
      setPending(null);
      const target = returnTo || redirectTo;
      if (target.startsWith('/oauth/authorize') || target.startsWith('/cas/') || target.startsWith('/saml/')) {
        // 清除首页 useEffect 的防循环标记，让回跳顺利进行
        sessionStorage.removeItem('__protoRedirect:' + target);
        window.location.replace(target);
        return;
      }
      navigate(target);
    } catch (e: any) {
      const code = e?.response?.data?.code;
      const msg = e?.response?.data?.message;
      if (code === 4090 || msg === 'captcha_required') {
        setPending({ username, password });
        setCaptchaOpen(true);
        return;
      }
      message.error(msg || '登录失败');
    } finally {
      setSubmitting(false);
    }
  };

  const onFinish = (values: { username: string; password: string }) => {
    doLogin(values.username, values.password);
  };

  const onCaptchaSuccess = (ticket: string) => {
    setCaptchaOpen(false);
    if (pending) {
      doLogin(pending.username, pending.password, ticket);
    }
  };

  return (
    <div className="inline-login-card">
      <div className="inline-login-head">
        <h2>
          登录 <span className="brand">{site.name}</span>
        </h2>
        <p>欢迎回来，请登录您的账号</p>
      </div>
      <Form size="large" onFinish={onFinish} autoComplete="off" requiredMark={false}>
        <Form.Item name="username" rules={[{ required: true, message: '请输入账号 / 邮箱 / 手机号' }]}>
          <Input prefix={<UserOutlined />} placeholder="账号 / 邮箱 / 手机号" />
        </Form.Item>
        <Form.Item name="password" rules={[{ required: true, message: '请输入密码' }]}>
          <Input.Password prefix={<LockOutlined />} placeholder="密码" />
        </Form.Item>
        <div className="login-modal-forgot">
          <a onClick={() => navigate('/oauth/forgot-password')}>忘记密码？</a>
        </div>
        <Form.Item>
          <Button type="primary" htmlType="submit" block loading={submitting} className="login-modal-submit">
            立即登录
          </Button>
        </Form.Item>
      </Form>
      {wecomEnabled && (
        <>
          <Divider plain style={{ color: '#94a3b8', fontSize: 12, margin: '8px 0 16px' }}>第三方登录</Divider>
          {!showWecomQR ? (
            <Button
              block
              size="large"
              icon={<WechatOutlined style={{ color: '#07c160' }} />}
              onClick={() => setShowWecomQR(true)}
            >
              使用企业微信登录
            </Button>
          ) : (
            <>
              <WecomQRLogin returnTo={returnTo} />
              <div style={{ textAlign: 'center', marginTop: 8 }}>
                <a onClick={() => setShowWecomQR(false)} style={{ color: '#94a3b8', fontSize: 12 }}>
                  ← 返回账号密码登录
                </a>
              </div>
            </>
          )}
        </>
      )}
      <SliderCaptcha
        open={captchaOpen}
        onCancel={() => setCaptchaOpen(false)}
        onSuccess={onCaptchaSuccess}
      />
    </div>
  );
}
