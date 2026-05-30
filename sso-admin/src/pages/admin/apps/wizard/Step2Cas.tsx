import { Form, Input, Select, InputNumber, Switch } from 'antd';

export default function Step2Cas() {
  return (
    <div
      className="app-wizard-step2"
      style={{
        border: '1px solid #eef0f5',
        borderRadius: 12,
        padding: '32px 40px 16px',
        background: '#fff',
      }}
    >
      <Form.Item
        name="cas_service"
        label="应用服务地址 (service)"
        rules={[
          { required: true, message: '请输入对端应用的 service URL' },
          {
            validator: (_, v) => {
              if (!v) return Promise.resolve();
              return /^https?:\/\/.+/i.test(String(v).trim())
                ? Promise.resolve()
                : Promise.reject(new Error('请填写完整 URL，必须以 http:// 或 https:// 开头'));
            },
          },
        ]}
        tooltip="对端应用（被接入的第三方应用）的 URL，登录请求里 ?service=... 必须与此完全一致；不是 OneAuth 自己的地址"
        extra={<span style={{ color: '#94a3b8', fontSize: 12 }}>对端应用 URL（被接入的第三方），例：https://jumpserver.example.com/</span>}
      >
        <Input placeholder="https://app.example.com/" />
      </Form.Item>

      <Form.Item
        name="cas_callback_url"
        label="应用回调地址"
        rules={[
          {
            validator: (_, v) => {
              if (!v) return Promise.resolve();
              return /^https?:\/\/.+/i.test(String(v).trim())
                ? Promise.resolve()
                : Promise.reject(new Error('请填写完整 URL，必须以 http:// 或 https:// 开头'));
            },
          },
        ]}
        tooltip="登录成功后 OneAuth 把浏览器重定向回去并附上 ?ticket=ST-xxx 的地址。留空则使用上面的服务地址"
        extra={<span style={{ color: '#94a3b8', fontSize: 12 }}>对端应用 URL，例：https://jumpserver.example.com/cas/callback；留空则与服务地址相同</span>}
      >
        <Input placeholder="https://app.example.com/cas/callback" />
      </Form.Item>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: '0 32px' }}>
        <Form.Item name="cas_user_attribute" label="用户标识字段" rules={[{ required: true }]}>
          <Select
            options={[
              { value: 'username', label: '用户名' },
              { value: 'user_id',  label: '用户 UUID' },
              { value: 'email',    label: '邮箱' },
              { value: 'mobile',   label: '手机号' },
            ]}
          />
        </Form.Item>
        <Form.Item
          name="cas_expires_seconds"
          label="Ticket 有效期"
          rules={[{ required: true }]}
          extra={<span style={{ color: '#94a3b8', fontSize: 12 }}>建议值：60 ~ 300 秒</span>}
        >
          <InputNumber min={30} max={3600} addonAfter="秒" style={{ width: '100%' }} />
        </Form.Item>
      </div>

      <Form.Item
        name="cas_return_attributes"
        label="返回用户属性"
        valuePropName="checked"
        extra={
          <span style={{ color: '#94a3b8', fontSize: 12 }}>
            开启后 ticket validate 响应里会带 cas:attributes（姓名 / 邮箱 / 手机号 / 部门等）
          </span>
        }
      >
        <Switch checkedChildren="启用" unCheckedChildren="禁用" />
      </Form.Item>
    </div>
  );
}
