import { useEffect, useState } from 'react';
import { Card, Tabs, Table, Tag, Input, Button, Space, type TableColumnsType } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { logApi, type LoginLog, type OperationLog, type AccessLog } from '@/api/misc';
import type { PageData } from '@/api/request';

type Fetcher<T> = (params: Record<string, unknown>) => Promise<PageData<T>>;

interface LogTableProps<T> {
  fetcher: Fetcher<T>;
  columns: TableColumnsType<T>;
  filters?: Array<{ key: string; placeholder: string }>;
}

function fmtTime(v: string) {
  return dayjs(v).format('YYYY-MM-DD HH:mm:ss');
}

function LogTable<T extends { id: number }>({ fetcher, columns, filters = [] }: LogTableProps<T>) {
  const [data, setData] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [filterVals, setFilterVals] = useState<Record<string, string>>({});

  const load = () => {
    setLoading(true);
    fetcher({ page, page_size: 20, ...filterVals })
      .then((d) => {
        setData(d.items || []);
        setTotal(d.total);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  return (
    <>
      {filters.length > 0 && (
        <Space style={{ marginBottom: 12 }}>
          {filters.map((f) => (
            <Input
              key={f.key}
              placeholder={f.placeholder}
              value={filterVals[f.key] || ''}
              onChange={(e) => setFilterVals({ ...filterVals, [f.key]: e.target.value })}
              onPressEnter={load}
              style={{ width: 200 }}
              allowClear
            />
          ))}
          <Button onClick={load} icon={<ReloadOutlined />}>
            查询
          </Button>
        </Space>
      )}
      <Table<T>
        rowKey="id"
        loading={loading}
        dataSource={data}
        columns={columns}
        pagination={{ current: page, total, pageSize: 20, onChange: setPage }}
      />
    </>
  );
}

const loginColumns: TableColumnsType<LoginLog> = [
  { title: '用户名', dataIndex: 'username', width: 140 },
  { title: 'IP', dataIndex: 'ip_address', width: 140 },
  {
    title: '状态',
    dataIndex: 'status',
    width: 90,
    render: (v) => (v === 'success' ? <Tag color="green">成功</Tag> : <Tag color="red">失败</Tag>),
  },
  { title: '消息', dataIndex: 'message', ellipsis: true },
  { title: 'User-Agent', dataIndex: 'user_agent', ellipsis: true },
  { title: '时间', dataIndex: 'created_at', width: 170, render: fmtTime },
];

// 把审计中间件产出的 action / resource 翻成中文
const RESOURCE_LABEL: Record<string, string> = {
  users: '用户',
  roles: '角色',
  departments: '部门',
  apps: '应用',
  configs: '系统配置',
  access: '访问控制',
  monitor: '状态监控',
  dictionaries: '字典',
  auth: '账户',
  permissions: '权限',
};
const ACTION_LABEL: Record<string, string> = {
  create: '创建',
  update: '更新',
  delete: '删除',
  patch: '更新',
  post: '创建',
  put: '更新',
};
const SUFFIX_LABEL: Record<string, string> = {
  'reset-password': '重置密码',
  lock: '锁定/解锁',
  roles: '设置角色',
  avatar: '上传头像',
  'rotate-secret': '轮换密钥',
  'toggle-status': '启用/禁用',
  probe: '立即探测',
  maintenance: '维护模式',
  'batch-delete': '批量删除',
  'upload-logo': '上传 Logo',
  'upload-image': '上传图片',
  profile: '个人资料',
  'change-password': '修改密码',
};

function translateAction(action: string, resource: string): string {
  // 形如 "create" "delete" "update"
  if (ACTION_LABEL[action]) return ACTION_LABEL[action];
  // 形如 "post.reset-password" / "put.roles" / "delete.maintenance"
  const dot = action.indexOf('.');
  if (dot > 0) {
    const verb = action.slice(0, dot);
    const suffix = action.slice(dot + 1);
    const verbCN = ACTION_LABEL[verb] || verb;
    const suffixCN = SUFFIX_LABEL[suffix] || suffix;
    return `${verbCN}·${suffixCN}`;
  }
  return action || '-';
}

const operationColumns: TableColumnsType<OperationLog> = [
  { title: '用户', dataIndex: 'username', width: 140 },
  {
    title: '资源',
    dataIndex: 'resource_type',
    width: 110,
    render: (v: string) => <Tag>{RESOURCE_LABEL[v] || v}</Tag>,
  },
  {
    title: '操作',
    dataIndex: 'action',
    width: 160,
    render: (v: string, r) => <span style={{ fontWeight: 500 }}>{translateAction(v, r.resource_type)}</span>,
  },
  {
    title: '目标 ID',
    dataIndex: 'resource_id',
    width: 200,
    ellipsis: true,
    render: (v: string) => (v ? <code style={{ fontSize: 12 }}>{v}</code> : '-'),
  },
  { title: 'IP', dataIndex: 'ip_address', width: 140 },
  {
    title: '状态码',
    dataIndex: 'status',
    width: 80,
    render: (v: number) => (v >= 400 ? <Tag color="red">{v}</Tag> : <Tag color="green">{v}</Tag>),
  },
  { title: '时间', dataIndex: 'created_at', width: 170, render: fmtTime },
];

const accessColumns: TableColumnsType<AccessLog> = [
  { title: '用户', dataIndex: 'username', width: 140 },
  { title: '应用名称', dataIndex: 'client_name', width: 200 },
  { title: 'Client ID', dataIndex: 'client_id', width: 200 },
  { title: 'IP', dataIndex: 'ip_address', width: 140 },
  { title: '时间', dataIndex: 'created_at', render: fmtTime },
];


export default function LogsPage() {
  return (
    <Card>
      <Tabs
        items={[
          {
            key: 'login',
            label: '登录日志',
            children: (
              <LogTable<LoginLog>
                fetcher={logApi.login}
                columns={loginColumns}
                filters={[{ key: 'username', placeholder: '用户名' }]}
              />
            ),
          },
          {
            key: 'op',
            label: '操作日志',
            children: <LogTable<OperationLog> fetcher={logApi.operation} columns={operationColumns} />,
          },
          {
            key: 'access',
            label: '历史访问',
            children: <LogTable<AccessLog> fetcher={logApi.access} columns={accessColumns} />,
          },
        ]}
      />
    </Card>
  );
}
