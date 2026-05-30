import { Form, Input, Switch } from 'antd';
import { LockOutlined } from '@ant-design/icons';
import { SectionHead, cardStyle } from './_shared';

export default function WecomPanel() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={cardStyle}>
        <SectionHead title="基础配置" />
        <Form.Item label="是否启用企业微信登录" name="wecom.enabled" valuePropName="checked">
          <Switch checkedChildren="启用" unCheckedChildren="禁用" />
        </Form.Item>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', columnGap: 32 }}>
          <Form.Item label="CorpID" name="wecom.corp_id">
            <Input placeholder="企业唯一标识 CorpID" />
          </Form.Item>
          <Form.Item label="应用 AgentID" name="wecom.agent_id">
            <Input placeholder="自建应用 AgentID" />
          </Form.Item>
          <Form.Item label="应用 Secret" name="wecom.secret">
            <Input.Password
              prefix={<LockOutlined style={{ color: '#94a3b8' }} />}
              placeholder="保存后留空表示不修改"
              autoComplete="new-password"
            />
          </Form.Item>
          <Form.Item label="未注册用户自动创建" name="wecom.auto_create_user" valuePropName="checked">
            <Switch checkedChildren="允许" unCheckedChildren="禁止" />
          </Form.Item>
        </div>
        <div style={{ color: '#94a3b8', fontSize: 12, marginTop: 8, paddingLeft: 11 }}>
          回调地址需在企业微信后台填：<code>{`${location.origin}/oauth/wecom/callback`}</code>
        </div>
      </div>
    </div>
  );
}
