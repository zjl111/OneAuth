import { Form, InputNumber, Input, Switch } from 'antd';
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

      <div style={cardStyle}>
        <SectionHead title="滑动验证码" />
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', columnGap: 32 }}>
          <Form.Item
            label="启用滑动验证"
            name="security.captcha_enabled"
            valuePropName="checked"
            extra="开启后，登录失败达到阈值会要求拖动滑块"
          >
            <Switch checkedChildren="开" unCheckedChildren="关" />
          </Form.Item>
          <Form.Item
            label="触发阈值（连续失败次数）"
            name="security.captcha_threshold"
            extra="0 = 每次登录都要求；建议 3"
          >
            <InputNumber min={0} max={20} style={{ width: '100%' }} addonAfter="次" />
          </Form.Item>
        </div>
        <Form.Item
          label="Unsplash Access Key（可选）"
          name="security.captcha_unsplash_key"
          extra="去 https://unsplash.com/developers 注册免费 Demo App 获取，留空则使用内置 5 张兜底图"
        >
          <Input.Password placeholder="VH0m9DUQ...（留空也能用）" autoComplete="off" />
        </Form.Item>
      </div>

      <div style={cardStyle}>
        <SectionHead title="IP 自动封禁" />
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr) minmax(0,1fr)', columnGap: 24 }}>
          <Form.Item
            label="启用自动封禁"
            name="security.ip_ban_enabled"
            valuePropName="checked"
            extra="同一 IP 在 30 分钟窗口内失败次数超阈值，自动加入黑名单"
          >
            <Switch checkedChildren="开" unCheckedChildren="关" />
          </Form.Item>
          <Form.Item
            label="封禁阈值（30 分钟内失败次数）"
            name="security.ip_ban_threshold"
            extra="到达后自动加入黑名单"
          >
            <InputNumber min={1} max={1000} style={{ width: '100%' }} addonAfter="次" />
          </Form.Item>
          <Form.Item
            label="封禁时长"
            name="security.ip_ban_duration"
            extra="0 = 永久封禁，需手动从黑名单移除"
          >
            <InputNumber min={0} max={2592000} style={{ width: '100%' }} addonAfter="秒" />
          </Form.Item>
        </div>
      </div>
    </div>
  );
}
