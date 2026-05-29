import { Form, InputNumber } from 'antd';
import { SectionHead, cardStyle } from './_shared';

export default function SecurityPanel() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={cardStyle}>
        <SectionHead title="登录与会话" />
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', columnGap: 32 }}>
          <Form.Item label="Session 超时（秒）" name="security.session_timeout">
            <InputNumber min={60} max={31536000} style={{ width: '100%' }} addonAfter="秒" />
          </Form.Item>
          <Form.Item label="登录失败锁定阈值" name="security.login_lockout_threshold">
            <InputNumber min={1} max={100} style={{ width: '100%' }} addonAfter="次" />
          </Form.Item>
          <Form.Item label="锁定时长（秒）" name="security.login_lockout_duration">
            <InputNumber min={60} max={86400} style={{ width: '100%' }} addonAfter="秒" />
          </Form.Item>
        </div>
      </div>

      <div style={cardStyle}>
        <SectionHead title="密码策略" />
        <Form.Item label="密码最小长度" name="security.password_min_length">
          <InputNumber min={4} max={64} style={{ width: 220 }} addonAfter="位" />
        </Form.Item>
      </div>
    </div>
  );
}
