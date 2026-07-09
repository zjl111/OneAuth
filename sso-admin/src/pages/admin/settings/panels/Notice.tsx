import { Form, Input, Switch } from 'antd';
import type { SystemConfig } from '@/api/misc';
import { SectionHead, cardStyle } from './_shared';

export default function NoticePanel({ items }: { items: SystemConfig[]; form: any }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={cardStyle}>
        <SectionHead title="门户滚动公告" />
        <Form.Item
          label="启用公告"
          name="notice.enabled"
          valuePropName="checked"
          extra="开启后，公告内容将以横向滚动方式展示在门户页顶部"
          style={{ marginBottom: 16 }}
        >
          <Switch />
        </Form.Item>
        <Form.Item
          label="公告内容"
          name="notice.text"
          extra="填写公告内容，留空则不显示。适合发布维护通知、升级公告等临时信息。"
          style={{ marginBottom: 0 }}
        >
          <Input.TextArea
            maxLength={500}
            showCount
            rows={4}
            placeholder="例如：系统公告：为了提供更稳定的统一身份认证服务，平台将于今晚 22:00 进行全量应用底座升级维护，届时部分应用认证可能会有短暂波动，请各位同学提前做好准备。"
          />
        </Form.Item>
      </div>
    </div>
  );
}
