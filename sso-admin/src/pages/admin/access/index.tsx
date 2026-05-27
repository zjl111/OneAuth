import { useEffect, useState } from 'react';
import { Card, Table, Button, Modal, Form, Input, Tag, Space, Popconfirm, Radio, App as AntdApp } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { accessApi, type IPRule } from '@/api/misc';
import PageToolbar from '@/components/PageToolbar';

export default function AccessPage() {
  const { message } = AntdApp.useApp();
  const [data, setData] = useState<IPRule[]>([]);
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();

  const load = () => accessApi.list().then(setData);
  useEffect(() => { load(); }, []);

  const handleSave = async () => {
    const v = await form.validateFields();
    await accessApi.create(v);
    message.success('已添加');
    setOpen(false);
    load();
  };

  return (
    <>
      <PageToolbar>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => {
            form.resetFields();
            form.setFieldsValue({ type: 'black' });
            setOpen(true);
          }}
        >
          新增规则
        </Button>
      </PageToolbar>
      <Card>
      <Table
        rowKey="id"
        dataSource={data}
        pagination={false}
        columns={[
          {
            title: '类型',
            dataIndex: 'type',
            render: (v) => (v === 'black' ? <Tag color="red">黑名单</Tag> : <Tag color="green">白名单</Tag>),
          },
          { title: 'IP / CIDR', dataIndex: 'ip' },
          { title: '说明', dataIndex: 'note', render: (v) => v || '-' },
          { title: '创建时间', dataIndex: 'created_at' },
          {
            title: '操作',
            render: (_, r) => (
              <Popconfirm
                title="确认删除？"
                onConfirm={async () => {
                  await accessApi.delete(r.id);
                  message.success('已删除');
                  load();
                }}
              >
                <Button type="link" size="small" danger>
                  删除
                </Button>
              </Popconfirm>
            ),
          },
        ]}
      />

      <Modal title="新增 IP 规则" open={open} onCancel={() => setOpen(false)} onOk={handleSave} destroyOnClose>
        <Form form={form} layout="vertical" preserve={false}>
          <Form.Item name="type" label="类型" rules={[{ required: true }]}>
            <Radio.Group>
              <Radio value="black">黑名单</Radio>
              <Radio value="white">白名单</Radio>
            </Radio.Group>
          </Form.Item>
          <Form.Item name="ip" label="IP / CIDR" rules={[{ required: true }]}>
            <Input placeholder="192.168.1.1 或 10.0.0.0/8" />
          </Form.Item>
          <Form.Item name="note" label="说明">
            <Input />
          </Form.Item>
        </Form>
      </Modal>
      </Card>
    </>
  );
}
