import { useEffect, useState } from 'react';
import { Card, Table, Button, Tag, Space, Switch, Modal, Form, Input, InputNumber, App as AntdApp, Popconfirm, Drawer, Dropdown } from 'antd';
import { ReloadOutlined, ThunderboltOutlined, DeleteOutlined, CloseOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { monitorApi } from '@/api/misc';
import PageToolbar from '@/components/PageToolbar';
import './monitor.css';

const statusMap: Record<string, { color: string; label: string }> = {
  up: { color: 'green', label: '正常' },
  degraded: { color: 'orange', label: '性能下降' },
  down: { color: 'red', label: '服务中断' },
  maintenance: { color: 'blue', label: '维护中' },
  no_data: { color: 'default', label: '无数据' },
};

export default function MonitorPage() {
  const { message, modal } = AntdApp.useApp();
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [form] = Form.useForm();

  const load = () => {
    setLoading(true);
    monitorApi.list().then((d) => {
      setData(d);
      setLoading(false);
    });
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, []);

  const handleSave = async () => {
    const v = await form.validateFields();
    await monitorApi.update(editing.client_id, v);
    message.success('已保存');
    setEditing(null);
    load();
  };

  const handleDelete = async (clientId: string) => {
    await monitorApi.delete(clientId);
    message.success('已删除');
    setSelectedIds((ids) => ids.filter((id) => id !== clientId));
    load();
  };

  const handleBatchDelete = () => {
    if (selectedIds.length === 0) return;
    modal.confirm({
      title: `确认删除选中的 ${selectedIds.length} 个监控？`,
      content: '删除后该应用的所有历史探测数据将被清空，应用本身不受影响。',
      okType: 'danger',
      onOk: async () => {
        await monitorApi.batchDelete(selectedIds);
        message.success('已删除');
        setSelectedIds([]);
        load();
      },
    });
  };

  return (
    <>
      <PageToolbar>
        {selectedIds.length > 0 && (
          <Button danger icon={<DeleteOutlined />} onClick={handleBatchDelete}>
            批量删除（{selectedIds.length}）
          </Button>
        )}
        <Button icon={<ReloadOutlined />} onClick={load}>
          刷新
        </Button>
      </PageToolbar>
      <Card className="monitor-page">
      <Table
        rowKey="client_id"
        loading={loading}
        dataSource={data}
        pagination={false}
        scroll={{ x: 1180 }}
        rowSelection={{
          selectedRowKeys: selectedIds,
          onChange: (keys) => setSelectedIds(keys as string[]),
        }}
        columns={[
          {
            title: '应用',
            dataIndex: 'client_name',
            width: 220,
            render: (name: string | undefined, r: any) => (
              <div>
                <div style={{ fontWeight: 500, color: '#1d2c5b' }}>{name || r.client_id}</div>
                {name && (
                  <div style={{ fontSize: 12, color: '#94a3b8' }}>
                    <code>{r.client_id}</code>
                  </div>
                )}
              </div>
            ),
          },
          {
            title: '当前状态',
            dataIndex: 'current_status',
            width: 110,
            render: (v) => <Tag color={statusMap[v]?.color}>{statusMap[v]?.label || v}</Tag>,
          },
          {
            title: '启用监控',
            dataIndex: 'enabled',
            width: 100,
            render: (v, r) => (
              <Switch
                checked={v}
                onChange={async (checked) => {
                  await monitorApi.update(r.client_id, { enabled: checked });
                  message.success('已更新');
                  load();
                }}
              />
            ),
          },
          { title: '健康检查 URL', dataIndex: 'health_check_url', ellipsis: true, minWidth: 200 },
          {
            title: '响应时间',
            dataIndex: 'last_response_ms',
            width: 110,
            align: 'right',
            render: (v) => (v ? `${v} ms` : '-'),
          },
          {
            title: '上次探测',
            dataIndex: 'last_probed_at',
            width: 160,
            render: (v) => (v ? dayjs(v).format('MM-DD HH:mm:ss') : '-'),
          },
          {
            title: '操作',
            key: 'actions',
            width: 180,
            fixed: 'right',
            render: (_, r) => (
              <div style={{ display: 'flex', alignItems: 'center', gap: 0, flexWrap: 'nowrap' }}>
                <span className="act-link" onClick={() => { setEditing(r); form.setFieldsValue(r); }}>配置</span>
                <span className="act-sep" />
                <span className="act-link" onClick={async () => {
                  await monitorApi.setMaintenance(r.client_id, !r.maintenance, '');
                  message.success(r.maintenance ? '已结束维护' : '已开启维护');
                  load();
                }}>{r.maintenance ? '结束维护' : '维护'}</span>
                <span className="act-sep" />
                <Dropdown trigger={['click']} menu={{ items: [
                  { key: 'probe', label: '立即探测', onClick: async () => {
                    await monitorApi.probe(r.client_id);
                    message.success('已触发探测');
                    setTimeout(load, 2000);
                  }},
                  { type: 'divider' },
                  { key: 'delete', label: '删除', danger: true, onClick: () => handleDelete(r.client_id) },
                ]}}>
                  <span className="act-link">···</span>
                </Dropdown>
              </div>
            ),
          },
        ]}
      />

      <Drawer
        className="monitor-config-drawer"
        title={null}
        closable={false}
        open={!!editing}
        onClose={() => setEditing(null)}
        width={760}
      >
        <div className="app-drawer-header">
          <span className="app-drawer-title">配置监控 - {editing?.client_name || editing?.client_id}</span>
          <Button type="text" icon={<CloseOutlined />} onClick={() => setEditing(null)} className="drawer-close-btn" />
        </div>
        <Form form={form} layout="vertical" style={{ flex: 1, overflow: 'auto', minHeight: 0, padding: '16px 24px' }}>
          <Form.Item name="health_check_url" label="健康检查 URL">
            <Input placeholder="https://app.example.com/health" />
          </Form.Item>
          <Form.Item name="timeout_ms" label="超时（毫秒）">
            <InputNumber min={1000} max={60000} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="degraded_ms" label="性能下降阈值（毫秒）">
            <InputNumber min={100} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="enabled" label="启用监控" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
        <div className="drawer-footer">
          <Button onClick={() => setEditing(null)}>取消</Button>
          <Button type="primary" onClick={handleSave}>保存</Button>
        </div>
      </Drawer>
      </Card>
    </>
  );
}
