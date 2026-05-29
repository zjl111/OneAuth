import { Form, Input, InputNumber, Select, Switch, Button, Space } from 'antd';
import {
  MailOutlined,
  UserOutlined,
  GlobalOutlined,
  LockOutlined,
  ReloadOutlined,
  SendOutlined,
  SaveOutlined,
} from '@ant-design/icons';
import { SectionHead, cardStyle } from './_shared';

export default function SmtpPanel({
  onTest,
  onSave,
  onReset,
}: {
  onTest: () => void;
  onSave: () => Promise<void> | void;
  onReset: () => Promise<void> | void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* 基础配置 */}
      <div style={cardStyle}>
        <SectionHead title="基础配置" />
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', columnGap: 32 }}>
          <Form.Item label="是否启用 SMTP 邮件功能" name="smtp.enabled" valuePropName="checked">
            <Switch checkedChildren="启用" unCheckedChildren="禁用" />
          </Form.Item>
          <Form.Item label="发件邮箱地址（建议与账号一致）" name="smtp.from_address">
            <Input prefix={<MailOutlined style={{ color: '#94a3b8' }} />} placeholder="no-reply@example.com" />
          </Form.Item>

          <Form.Item label="发件人显示名称" name="smtp.from_name">
            <Input prefix={<UserOutlined style={{ color: '#94a3b8' }} />} placeholder="OneAuth" />
          </Form.Item>
          <Form.Item label="SMTP 服务器地址" name="smtp.host">
            <Input prefix={<GlobalOutlined style={{ color: '#94a3b8' }} />} placeholder="smtp.qq.com" />
          </Form.Item>

          <Form.Item label="SMTP 端口（465=SSL，587=STARTTLS，25=明文）" name="smtp.port">
            <InputNumber min={1} max={65535} style={{ width: '100%' }} placeholder="465" />
          </Form.Item>
          <Form.Item label="加密方式" name="smtp.use_tls">
            <Select
              options={[
                { value: 'ssl',      label: 'SSL' },
                { value: 'starttls', label: 'STARTTLS' },
                { value: 'none',     label: 'NONE（不加密）' },
              ]}
            />
          </Form.Item>
        </div>
      </div>

      {/* 安全与高级配置 */}
      <div style={cardStyle}>
        <SectionHead title="安全与高级配置" />
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', columnGap: 32 }}>
          <Form.Item label="SMTP 授权码 / 密码" name="smtp.password">
            <Input.Password
              prefix={<LockOutlined style={{ color: '#94a3b8' }} />}
              placeholder="保存后留空表示不修改"
              autoComplete="new-password"
              visibilityToggle
            />
          </Form.Item>
          <Form.Item
            label={<span>重置密码链接前缀 <span style={{ color: '#94a3b8', fontWeight: 'normal', marginLeft: 4 }}>（留空则使用「平台信息」中的当前站点 URL）</span></span>}
            name="smtp.reset_link_base"
          >
            <Input prefix={<GlobalOutlined style={{ color: '#94a3b8' }} />} placeholder="https://sso.example.com" />
          </Form.Item>
        </div>
      </div>

      {/* 邮件模板 */}
      <div style={cardStyle}>
        <SectionHead title="邮件模板" />
        <Form.Item
          label={<span>主题前缀 <span style={{ color: '#94a3b8', fontWeight: 'normal', marginLeft: 4 }}>（会附加在所有邮件主题前，例如 [OneAuth]）</span></span>}
          name="smtp.subject_prefix"
        >
          <Input placeholder="[OneAuth]" />
        </Form.Item>

        <div style={{ marginTop: 8, marginBottom: 12, color: '#1d2c5b', fontWeight: 500 }}>
          重置密码邮件
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', columnGap: 32 }}>
          <Form.Item label="主题" name="smtp.reset_subject">
            <Input placeholder="重置 OneAuth 密码" />
          </Form.Item>
          <Form.Item label="邮件问候语" name="smtp.reset_greeting">
            <Input placeholder="Hello" />
          </Form.Item>
        </div>
        <Form.Item
          label={<span>邮件正文 <span style={{ color: '#94a3b8', fontWeight: 'normal', marginLeft: 4 }}>（支持占位符：<code>{`{{name}}`}</code> 用户名、<code>{`{{greeting}}`}</code> 问候语、<code>{`{{link}}`}</code> 重置链接；留空使用默认模板）</span></span>}
          name="smtp.reset_body"
        >
          <Input.TextArea
            rows={6}
            placeholder={'示例：\n{{greeting}} {{name}}，请点击 {{link}} 重置密码。'}
            style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, monospace', fontSize: 12 }}
          />
        </Form.Item>
      </div>

      {/* 底部按钮区 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: '#fff',
          border: '1px solid #eef0f5',
          borderRadius: 12,
          padding: '14px 20px',
        }}
      >
        <Button icon={<ReloadOutlined />} onClick={() => onReset()}>重置</Button>
        <Space>
          <Button icon={<SendOutlined />} onClick={onTest}>发送测试邮件</Button>
          <Button type="primary" icon={<SaveOutlined />} onClick={() => onSave()}>保存配置</Button>
        </Space>
      </div>
    </div>
  );
}
