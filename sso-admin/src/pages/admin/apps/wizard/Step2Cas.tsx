import { Form, Input, Select, InputNumber } from 'antd';

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
        label="服务地址"
        rules={[{ required: true, message: '请输入 CAS service URL' }]}
        tooltip="`service=` 参数白名单，必须与应用请求时一致"
      >
        <Input placeholder="https://app.example.com/" />
      </Form.Item>

      <Form.Item
        name="cas_callback_url"
        label="回调地址"
        tooltip="留空则使用服务地址，作为 ticket 验证完成后跳转的页面"
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
    </div>
  );
}
