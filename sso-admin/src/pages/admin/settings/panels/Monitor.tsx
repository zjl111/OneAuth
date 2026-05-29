import { Form, InputNumber, Switch } from 'antd';
import { SectionHead, cardStyle } from './_shared';

export default function MonitorPanel() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={cardStyle}>
        <SectionHead title="探测设置" />
        <Form.Item label="监控周期" name="monitor.interval">
          <InputNumber min={5} max={3600} style={{ width: 220 }} addonAfter="秒" />
        </Form.Item>
      </div>
      <div style={cardStyle}>
        <SectionHead title="状态页" />
        <Form.Item label="状态页公开展示" name="monitor.public_status_page" valuePropName="checked">
          <Switch checkedChildren="启用" unCheckedChildren="禁用" />
        </Form.Item>
      </div>
    </div>
  );
}
