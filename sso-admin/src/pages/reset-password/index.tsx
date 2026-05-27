import { useEffect, useState } from 'react';
import { Form, Input, Button, App as AntdApp, Result, Spin } from 'antd';
import { LockOutlined } from '@ant-design/icons';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { authApi } from '@/api/auth';
import '../forgot-password/forgot.css';

export default function ResetPasswordPage() {
  const { message } = AntdApp.useApp();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get('token') || '';

  const [loading, setLoading] = useState(true);
  const [maskedEmail, setMaskedEmail] = useState<string>('');
  const [invalid, setInvalid] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) {
      setInvalid(true);
      setLoading(false);
      return;
    }
    authApi
      .verifyResetToken(token)
      .then((r) => setMaskedEmail(r.email))
      .catch(() => setInvalid(true))
      .finally(() => setLoading(false));
  }, [token]);

  const onFinish = async (v: { new_password: string; confirm: string }) => {
    if (v.new_password !== v.confirm) {
      message.error('两次输入的密码不一致');
      return;
    }
    setSubmitting(true);
    try {
      await authApi.resetPassword({ token, new_password: v.new_password });
      setDone(true);
    } catch (e: any) {
      message.error(e?.response?.data?.message || '重置失败');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="forgot-page">
        <div className="forgot-card" style={{ textAlign: 'center', padding: 60 }}>
          <Spin />
          <div style={{ marginTop: 16, color: '#94a3b8' }}>正在验证链接…</div>
        </div>
      </div>
    );
  }

  if (invalid) {
    return (
      <div className="forgot-page">
        <div className="forgot-card">
          <Result
            status="error"
            title="链接已过期或无效"
            subTitle="请重新发起忘记密码请求，或联系管理员。"
            extra={
              <Button type="primary" onClick={() => navigate('/oauth/forgot-password')}>
                重新申请
              </Button>
            }
          />
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="forgot-page">
        <div className="forgot-card">
          <Result
            status="success"
            title="密码已重置"
            subTitle="请使用新密码重新登录"
            extra={
              <Button type="primary" onClick={() => navigate('/')}>
                去登录
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
        <h2 className="forgot-title">设置新密码</h2>
        <p className="forgot-sub">为账号 <b>{maskedEmail}</b> 设置新密码</p>
        <Form size="large" onFinish={onFinish} autoComplete="off" requiredMark={false}>
          <Form.Item
            name="new_password"
            rules={[
              { required: true, message: '请输入新密码' },
              { min: 8, message: '密码至少 8 位' },
            ]}
          >
            <Input.Password prefix={<LockOutlined />} placeholder="新密码（至少 8 位）" />
          </Form.Item>
          <Form.Item
            name="confirm"
            rules={[{ required: true, message: '请再输入一次' }]}
          >
            <Input.Password prefix={<LockOutlined />} placeholder="确认新密码" />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" block loading={submitting} className="forgot-submit">
              提交
            </Button>
          </Form.Item>
        </Form>
      </div>
    </div>
  );
}
