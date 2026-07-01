import { useEffect, useState } from 'react';
import { Modal, Form, Input, Button, App as AntdApp, Divider } from 'antd';
import { UserOutlined, LockOutlined, WechatOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import { useSite } from '@/hooks/useSite';
import { get } from '@/api/request';
import WecomQRLogin from './WecomQRLogin';
import SliderCaptcha from './SliderCaptcha';
import './LoginModal.css';

interface Props {
  open: boolean;
  onClose: () => void;
  /** 登录成功后跳转地址；默认 /portal。优先级低于 returnTo */
  redirectTo?: string;
  /** OAuth 流程透传的回跳地址（一般是 /oauth/authorize?...），存在则覆盖 redirectTo */
  returnTo?: string;
}

export default function LoginModal({ open, onClose, redirectTo = '/portal', returnTo }: Props) {
  const navigate = useNavigate();
  const { message } = AntdApp.useApp();
  const site = useSite();
  const login = useAuthStore((s) => s.login);
  const [submitting, setSubmitting] = useState(false);
  const [wecomEnabled, setWecomEnabled] = useState(false);
  const [showWecomQR, setShowWecomQR] = useState(false);
  // captcha：失败到达阈值时后端返回 4090，弹拼图；通过后用 ticket 重发登录
  const [captchaOpen, setCaptchaOpen] = useState(false);
  const [pending, setPending] = useState<{ username: string; password: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    get<{ enabled: boolean }>('/auth/wecom/status')
      .then((d) => setWecomEnabled(!!d?.enabled))
      .catch(() => setWecomEnabled(false));
  }, [open]);

  const doLogin = async (username: string, password: string, ticket?: string) => {
    setSubmitting(true);
    try {
      const u = await login(username, password, undefined, ticket);
      message.success(`欢迎回来，${u.nickname || u.username}`);
      setPending(null);
      onClose();
      const target = returnTo || redirectTo;
      if (target.startsWith('/oauth/authorize') || target.startsWith('/cas/') || target.startsWith('/saml/')) {
        // OAuth / CAS 协议页面必须 full reload，让后端读到刚 set 的 sso_session cookie
        window.location.replace(target);
        return;
      }
      navigate(target);
    } catch (e: any) {
      const code = e?.response?.data?.code;
      const msg = e?.response?.data?.message;
      // 后端 captcha gate：要求滑块验证
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
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      destroyOnClose
      centered
      width={420}
      className="login-modal"
      maskClosable
    >
      <div className="login-modal-head">
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
          <a
            onClick={() => {
              onClose();
              navigate('/oauth/forgot-password');
            }}
          >
            忘记密码？
          </a>
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
    </Modal>
  );
}
