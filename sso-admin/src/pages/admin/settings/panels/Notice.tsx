import { Form, Input, Switch } from 'antd';
import { SectionHead, cardStyle } from './_shared';

export default function NoticePanel(_: { items?: unknown; form?: unknown }) {
  return (
    <div style={cardStyle}>
      <SectionHead title="门户公告" />
      <Form.Item label="是否启用门户公告" name="notice.enabled" valuePropName="checked">
        <Switch checkedChildren="启用" unCheckedChildren="禁用" />
      </Form.Item>
      <Form.Item label="公告内容" name="notice.text">
        <Input.TextArea rows={4} placeholder="显示在应用门户顶部" />
      </Form.Item>
    </div>
  );
}
