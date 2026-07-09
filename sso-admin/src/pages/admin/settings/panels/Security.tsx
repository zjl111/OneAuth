import { useEffect, useState } from 'react';
import { App as AntdApp, Button, Form, InputNumber, Input, Space, Switch, Tag } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { accessApi, type IPRule } from '@/api/misc';
import { SectionHead, cardStyle } from './_shared';

export default function SecurityPanel() {
  const { message } = AntdApp.useApp();
  const [lockedIps, setLockedIps] = useState<IPRule[]>([]);
  const [loadingLockedIps, setLoadingLockedIps] = useState(false);
  const [lockedIpsLoaded, setLockedIpsLoaded] = useState(false);

  const loadLockedIps = async () => {
    setLoadingLockedIps(true);
    try {
      const items = await accessApi.list();
      setLockedIps(items.filter((it) => it.type === 'black'));
    } catch {
      setLockedIps([]);
    } finally {
      setLoadingLockedIps(false);
      setLockedIpsLoaded(true);
    }
  };

  useEffect(() => {
    loadLockedIps();
  }, []);

  const handleUnlock = async (row: IPRule) => {
    await accessApi.unlock(row.id);
    message.success(`已解锁 ${row.ip}`);
    loadLockedIps();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={cardStyle}>
        <SectionHead title="登录与会话" />
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', columnGap: 32 }}>
          <Form.Item
            label="会话有效期（分钟）"
            name="oauth.session_ttl"
            extra="用户登录后可保持登录状态的最长时间；0 = 使用默认值 8 小时；修改后需重启后端生效"
          >
            <InputNumber min={0} max={525600} style={{ width: '100%' }} addonAfter="分钟" />
          </Form.Item>
          <Form.Item
            label="无活动自动登出（分钟）"
            name="security.session_timeout"
            extra="超过该分钟数没有任何主动操作（点击/表单/搜索）将强制重新登录；0 = 禁用"
          >
            <InputNumber min={0} max={525600} style={{ width: '100%' }} addonAfter="分钟" />
          </Form.Item>
          <Form.Item label="登录失败锁定阈值" name="security.login_lockout_threshold">
            <InputNumber min={1} max={100} style={{ width: '100%' }} addonAfter="次" />
          </Form.Item>
          <Form.Item label="锁定时长（分钟）" name="security.login_lockout_duration">
            <InputNumber min={1} max={1440} style={{ width: '100%' }} addonAfter="分钟" />
          </Form.Item>
          <Form.Item
            label="长时间未登录账号自动锁定（天）"
            name="security.user_inactive_days"
            extra="超过该天数未登录的用户将被自动锁定（admin 除外）；默认 30 天；修改后实时生效"
          >
            <InputNumber min={1} max={365} style={{ width: '100%' }} addonAfter="天" />
          </Form.Item>
        </div>
      </div>

      <div style={cardStyle}>
        <SectionHead title="密码策略" />
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', columnGap: 32 }}>
          <Form.Item label="密码最小长度" name="security.password_min_length">
            <InputNumber min={4} max={64} style={{ width: 220 }} addonAfter="位" />
          </Form.Item>
          <div />
          <Form.Item
            label="大写字母"
            name="security.password_require_uppercase"
            valuePropName="checked"
            extra="启用后，密码必须包含大写字母"
          >
            <Switch checkedChildren="开" unCheckedChildren="关" />
          </Form.Item>
          <Form.Item
            label="小写字母"
            name="security.password_require_lowercase"
            valuePropName="checked"
            extra="启用后，密码必须包含小写字母"
          >
            <Switch checkedChildren="开" unCheckedChildren="关" />
          </Form.Item>
          <Form.Item
            label="必须包含数字"
            name="security.password_require_digit"
            valuePropName="checked"
            extra="启用后，密码必须包含数字"
          >
            <Switch checkedChildren="开" unCheckedChildren="关" />
          </Form.Item>
          <Form.Item
            label="必须包含特殊字符"
            name="security.password_require_special"
            valuePropName="checked"
            extra="启用后，密码必须包含特殊字符"
          >
            <Switch checkedChildren="开" unCheckedChildren="关" />
          </Form.Item>
        </div>
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
            label="封禁时长（分钟）"
            name="security.ip_ban_duration"
            extra="0 = 永久封禁，需手动从黑名单移除"
          >
            <InputNumber min={0} max={43200} style={{ width: '100%' }} addonAfter="分钟" />
          </Form.Item>
        </div>
        {lockedIpsLoaded && lockedIps.length > 0 && (
          <>
            <div style={{ marginTop: 8, color: '#6b7280', fontSize: 13 }}>
              下方展示当前被封禁的 IP，点击标签上的关闭即可直接解锁。支持多个 IP。
            </div>
            <div
              style={{
                marginTop: 12,
                minHeight: 52,
                border: '1px solid #e5e7eb',
                borderRadius: 10,
                padding: 12,
                background: '#fafbfc',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
                <span style={{ color: '#374151', fontSize: 13, fontWeight: 500 }}>被锁定 IP</span>
                <Button icon={<ReloadOutlined />} onClick={loadLockedIps} loading={loadingLockedIps} size="small">
                  刷新
                </Button>
              </div>
              <Space size={[8, 8]} wrap>
                {lockedIps.map((row) => (
                  <Tag
                    key={row.id}
                    closable
                    color="red"
                    onClose={(e) => {
                      e.preventDefault();
                      void handleUnlock(row);
                    }}
                  >
                    {row.ip}
                  </Tag>
                ))}
              </Space>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
