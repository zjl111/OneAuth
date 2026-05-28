import { useEffect, useState } from 'react';
import { Table, Tag, Button, Space, Popconfirm, App as AntdApp } from 'antd';
import { ReloadOutlined, LogoutOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { sessionsApi, type OnlineSession } from '@/api/misc';

function fmtTime(v: string) {
  return v ? dayjs(v).format('YYYY-MM-DD HH:mm:ss') : '-';
}

export default function OnlineSessionTable() {
  const { message, modal } = AntdApp.useApp();
  const [data, setData] = useState<OnlineSession[]>([]);
  const [loading, setLoading] = useState(false);

  const load = () => {
    setLoading(true);
    sessionsApi
      .list()
      .then((d) => setData(d || []))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, []);

  const handleKick = (s: OnlineSession) => {
    modal.confirm({
      title: `强制 ${s.username} 下线？`,
      content: '该会话立即失效，用户需重新登录。已签发的 JWT 仍可在过期前使用，如需彻底失效请走撤销流程。',
      okType: 'danger',
      onOk: async () => {
        await sessionsApi.kick(s.sid);
        message.success('已下线');
        load();
      },
    });
  };

  return (
    <>
      <Space style={{ marginBottom: 12 }}>
        <Tag color="blue">当前在线 {data.length}</Tag>
        <Button icon={<ReloadOutlined />} onClick={load}>
          刷新
        </Button>
      </Space>
      <Table<OnlineSession>
        rowKey="sid"
        loading={loading}
        dataSource={data}
        pagination={false}
        columns={[
          { title: '用户名', dataIndex: 'username', width: 160 },
          {
            title: '类型',
            dataIndex: 'is_staff',
            width: 90,
            render: (v) => (v ? <Tag color="purple">管理员</Tag> : <Tag>普通用户</Tag>),
          },
          { title: 'IP', dataIndex: 'ip', width: 140 },
          { title: 'User-Agent', dataIndex: 'ua', ellipsis: true },
          { title: '登录时间', dataIndex: 'auth_time', width: 170, render: fmtTime },
          { title: '过期时间', dataIndex: 'expires_at', width: 170, render: fmtTime },
          {
            title: '操作',
            width: 120,
            render: (_, r) => (
              <Popconfirm title={`强制 ${r.username} 下线？`} okType="danger" onConfirm={() => handleKick(r)}>
                <Button type="link" size="small" danger icon={<LogoutOutlined />}>
                  强制下线
                </Button>
              </Popconfirm>
            ),
          },
        ]}
      />
    </>
  );
}
