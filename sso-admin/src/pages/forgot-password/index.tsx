import { useState } from 'react';
import { Form, Input, Button, App as AntdApp, Result } from 'antd';
import { MailOutlined, ArrowLeftOutlined } from '@ant-design/icons';
import { Link, useNavigate } from 'react-router-dom';
import { useSite } from '@/hooks/useSite';
import { authApi } from '@/api/auth';
import './forgot.css';

export default function ForgotPasswordPage() {
  const { message } = AntdApp.useApp();
  const navigate = useNavigate();
  const site = useSite();
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState<string | null>(null);

  const onFinish = async (values: { email: string }) => {
    setSubmitting(true);
    try {
      await authApi.forgotPassword(values.email);
      setSent(values.email);
    } catch (e: any) {
      message.error(e?.response?.data?.message || '发送失败');
    } finally {
      setSubmitting(false);
    }
  };

  if (sent) {
    return (
      <div className="forgot-page">
        <div className="forgot-card">
          <Result
            status="success"
            title="重置链接已发送"
            subTitle={
              <div>
                <p>如果 <b>{sent}</b> 是有效的注册邮箱，重置链接已发送到您的收件箱。</p>
                <p style={{ color: '#94a3b8', fontSize: 13 }}>链接 30 分钟内有效。请检查邮箱（含垃圾邮件）。</p>
              </div>
            }
            extra={
              <Button type="primary" onClick={() => navigate('/')}>
                返回登录
              </Button>
            }
          />
        </div>
      </div>
    );
  }

  return (
    <div className="forgot-page">
      <div className="forgot-card">
        <h2 className="forgot-title">找回密码</h2>
        <p className="forgot-sub">输入注册邮箱，我们会向您发送重置链接</p>

        {!site.smtp_enabled && (
          <div className="forgot-warn">
            ⚠️ 管理员尚未配置邮件服务。如忘记密码，请直接联系管理员重置。
          </div>
        )}

        <Form
          size="large"
          onFinish={onFinish}
          autoComplete="off"
          requiredMark={false}
          disabled={!site.smtp_enabled}
        >
          <Form.Item
            name="email"
            rules={[
              { required: true, message: '请输入邮箱' },
              { type: 'email', message: '邮箱格式不正确' },
            ]}
          >
            <Input prefix={<MailOutlined />} placeholder="注册邮箱" />
          </Form.Item>
          <Form.Item>
            <Button
              type="primary"
              htmlType="submit"
              block
              loading={submitting}
              className="forgot-submit"
              disabled={!site.smtp_enabled}
            >
              发送重置链接
            </Button>
          </Form.Item>
        </Form>

        <Link to="/" className="forgot-back">
          <ArrowLeftOutlined /> 返回登录
        </Link>
      </div>
    </div>
  );
}
