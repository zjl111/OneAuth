import { useEffect, useMemo, useState } from 'react';
import { App as AntdApp, Button, Card, Popconfirm, Space, Table, Tag } from 'antd';
import { ReloadOutlined, UnlockOutlined } from '@ant-design/icons';
import { accessApi, type IPRule } from '@/api/misc';
import './ip-blacklist.css';

function formatTime(v: string | null) {
  if (!v) return '-';
  return new Date(v).toLocaleString('zh-CN', { hour12: false });
}

export default function IPBlacklistPage() {
  const { message } = AntdApp.useApp();
  const [data, setData] = useState<IPRule[]>([]);
  const [loading, setLoading] = useState(false);

  const load = () => {
    setLoading(true);
    accessApi
      .list()
      .then((items) => setData(items.filter((it) => it.type === 'black')))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const rows = useMemo(() => data, [data]);

  const handleUnlock = async (row: IPRule) => {
    await accessApi.unlock(row.id);
    message.success(`已解锁 ${row.ip}`);
    load();
  };

  return (
    <Card className="ip-blacklist-page">
      <div className="ip-blacklist-toolbar">
        <div className="ip-blacklist-tip">
          当前仅展示黑名单 IP。点击“解锁”会直接移除黑名单条目，允许该 IP 重新登录。
        </div>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={load}>
            刷新
          </Button>
        </Space>
      </div>

      <Table<IPRule>
        rowKey="id"
        loading={loading}
        dataSource={rows}
        pagination={false}
        columns={[
          { title: 'IP / CIDR', dataIndex: 'ip', width: 220 },
          {
            title: '类型',
            dataIndex: 'type',
            width: 100,
            render: () => <Tag color="red">黑名单</Tag>,
          },
          {
            title: '备注',
            dataIndex: 'note',
            render: (v) => v || '-',
          },
          {
            title: '自动封禁',
            dataIndex: 'auto_ban',
            width: 110,
            render: (v: boolean) => (v ? <Tag color="orange">自动</Tag> : <Tag>手动</Tag>),
          },
          {
            title: '过期时间',
            dataIndex: 'expires_at',
            width: 180,
            render: (v: string | null) => formatTime(v),
          },
          {
            title: '创建时间',
            dataIndex: 'created_at',
            width: 180,
            render: (v: string) => formatTime(v),
          },
          {
            title: '操作',
            width: 120,
            fixed: 'right',
            render: (_, row) => (
              <Popconfirm title={`确认解锁 ${row.ip}？`} okText="解锁" onConfirm={() => handleUnlock(row)}>
                <span className="act-link ip-unlock-link">
                  <UnlockOutlined />
                  解锁
                </span>
              </Popconfirm>
            ),
          },
        ]}
      />
    </Card>
  );
}
