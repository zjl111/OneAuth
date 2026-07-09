import { useEffect, useState } from 'react';
import { Card, Tabs, Table, Tag, Input, Button, Select, Form, InputNumber, Space, App as AntdApp, type TableColumnsType } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { configApi, logApi, type AccessLog, type LoginLog, type OperationLog, type SystemConfig } from '@/api/misc';
import type { PageData } from '@/api/request';
import './logs.css';

type Fetcher<T> = (params: Record<string, unknown>) => Promise<PageData<T>>;

interface LogFilter {
  key: string;
  placeholder: string;
  type?: 'input' | 'select';
  options?: Array<{ value: string; label: string }>;
}
interface LogTableProps<T> {
  fetcher: Fetcher<T>;
  columns: TableColumnsType<T>;
  filters?: LogFilter[];
}

function fmtTime(v: string) {
  return dayjs(v).format('YYYY-MM-DD HH:mm:ss');
}

function LogsStrategyPanel() {
  const { message } = AntdApp.useApp();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const items = await configApi.byCategory('logs');
      const obj: Record<string, number> = {
        'logs.login_retention_days': 180,
        'logs.operation_retention_days': 180,
        'logs.access_retention_days': 180,
      };
      (items || []).forEach((c: SystemConfig) => {
        const n = Number(c.value);
        if (!Number.isNaN(n) && n > 0) {
          obj[`${c.category}.${c.key}`] = n;
        }
      });
      form.setFieldsValue(obj);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async () => {
    const values = await form.validateFields();
    const items = Object.entries(values).map(([k, v]) => {
      const [category, ...rest] = k.split('.');
      return { category, key: rest.join('.'), value: String(v) };
    });
    setSaving(true);
    try {
      await configApi.set(items);
      message.success('已保存清除策略');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ paddingTop: 8 }}>
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Card>
          <Form form={form} layout="vertical" disabled={loading}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 24 }}>
              <Form.Item label="登录日志清除时间" name="logs.login_retention_days" extra="默认清除 180 天前的登录记录">
                <InputNumber min={1} max={3650} style={{ width: '100%' }} addonAfter="天" />
              </Form.Item>
              <Form.Item label="操作日志清除时间" name="logs.operation_retention_days" extra="默认清除 180 天前的操作记录">
                <InputNumber min={1} max={3650} style={{ width: '100%' }} addonAfter="天" />
              </Form.Item>
              <Form.Item label="访问日志清除时间" name="logs.access_retention_days" extra="默认清除 180 天前的访问记录">
                <InputNumber min={1} max={3650} style={{ width: '100%' }} addonAfter="天" />
              </Form.Item>
            </div>
          </Form>
        </Card>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button type="primary" onClick={save} loading={saving}>
            保存清除策略
          </Button>
        </div>
      </Space>
    </div>
  );
}

function LogTable<T extends { id: number }>({ fetcher, columns, filters = [] }: LogTableProps<T>) {
  const [data, setData] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [pagination, setPagination] = useState({ current: 1, pageSize: 10 });
  const [filterVals, setFilterVals] = useState<Record<string, string>>({});

  const load = (nextPagination = pagination, nextFilters = filterVals) => {
    setLoading(true);
    fetcher({ page: nextPagination.current, page_size: nextPagination.pageSize, ...nextFilters })
      .then((d) => {
        setData(d.items || []);
        setTotal(d.total);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagination.current, pagination.pageSize]);

  return (
    <>
      {filters.length > 0 && (
        <div className="log-filter-bar" style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {filters.map((f) =>
            f.type === 'select' ? (
              <Select
                key={f.key}
                placeholder={f.placeholder}
                value={filterVals[f.key] || undefined}
                onChange={(v) => {
                  const next = { ...filterVals, [f.key]: v || '' };
                  const nextPagination = { ...pagination, current: 1 };
                  setFilterVals(next);
                  setPagination(nextPagination);
                  load(nextPagination, next);
                  // 下拉切换自动查询，无需再点查询
                }}
                allowClear
                style={{ width: 200 }}
                options={f.options || []}
              />
            ) : (
              <Input
                key={f.key}
                placeholder={f.placeholder}
                value={filterVals[f.key] || ''}
                onChange={(e) => setFilterVals({ ...filterVals, [f.key]: e.target.value })}
                onPressEnter={() => {
                  const next = { ...filterVals };
                  const nextPagination = { ...pagination, current: 1 };
                  setPagination(nextPagination);
                  load(nextPagination, next);
                }}
                style={{ width: 200 }}
                allowClear
              />
            ),
          )}
          <Button onClick={() => load()} icon={<ReloadOutlined />} style={{ marginLeft: 'auto' }}>
            刷新
          </Button>
        </div>
      )}
      <Table<T>
        rowKey="id"
        loading={loading}
        dataSource={data}
        columns={columns}
        pagination={{
          current: pagination.current,
          pageSize: pagination.pageSize,
          total,
          showSizeChanger: true,
          showTotal: (t) => `共 ${t} 条`,
          onChange: (page, pageSize) => {
            const nextPagination = { current: page, pageSize };
            setPagination(nextPagination);
            load(nextPagination);
          },
        }}
      />
    </>
  );
}

const loginColumns: TableColumnsType<LoginLog> = [
  {
    title: '用户名',
    width: 220,
    render: (_, r) => {
      const name = r.display_name || r.username;
      return name && r.username && name !== r.username ? `${name}(${r.username})` : r.username;
    },
  },
  { title: 'IP', dataIndex: 'ip_address', width: 140 },
  {
    title: '登录城市',
    width: 150,
    render: (_, r) => {
      const p = (r as any).province || '';
      const c = (r as any).city || '';
      if (!p && !c) {
        const ip = r.ip_address || '';
        if (ip.startsWith('192.168.') || ip.startsWith('10.') || ip.startsWith('172.') || ip === '127.0.0.1' || ip === '::1') {
          return '局域网';
        }
        return '—';
      }
      if (p && c && p !== c) return `${p} / ${c}`;
      return p || c;
    },
  },
  { title: '运营商', dataIndex: 'isp', width: 100, render: (v) => v || '—' },
  {
    title: '状态',
    dataIndex: 'status',
    width: 90,
    render: (v) => (v === 'success' ? <Tag color="green">成功</Tag> : <Tag color="red">失败</Tag>),
  },
  { title: '消息', dataIndex: 'message', width: 160, ellipsis: true },
  { title: '用户代理', dataIndex: 'user_agent', ellipsis: true, render: (v: string) => v || '—' },
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
  monitor: '应用健康',
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
  {
    title: '用户',
    width: 220,
    render: (_, r) => {
      const name = r.display_name || r.username;
      return name && r.username && name !== r.username ? `${name}(${r.username})` : r.username;
    },
  },
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
    title: '目标名称',
    dataIndex: 'resource_id',
    width: 260,
    ellipsis: true,
    render: (_, r) => {
      const name = (r as OperationLog & { resource_name?: string }).resource_name;
      const id = r.resource_id;
      if (!name && !id) return '-';
      if (!name) return <code style={{ fontSize: 12 }}>{id}</code>;
      if (name === id) return <code style={{ fontSize: 12 }}>{name}</code>;
      return (
        <div style={{ lineHeight: 1.2 }}>
          <div style={{ fontWeight: 500 }}>{name}</div>
          {id && <div style={{ color: '#94a3b8', fontSize: 12 }}><code>{id}</code></div>}
        </div>
      );
    },
  },
  {
    title: '输出',
    dataIndex: 'output',
    width: 280,
    ellipsis: true,
    render: (v: string) => v || '—',
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
  {
    title: '用户',
    width: 220,
    render: (_, r) => {
      const name = r.display_name || r.username;
      return name && r.username && name !== r.username ? `${name}(${r.username})` : r.username;
    },
  },
  { title: '应用名称', dataIndex: 'client_name', width: 200 },
  { title: 'Client ID', dataIndex: 'client_id', width: 200 },
  { title: 'IP', dataIndex: 'ip_address', width: 140 },
  {
    title: '登录城市',
    width: 150,
    render: (_, r) => {
      const p = (r as any).province || '';
      const c = (r as any).city || '';
      if (!p && !c) {
        const ip = r.ip_address || '';
        if (ip.startsWith('192.168.') || ip.startsWith('10.') || ip.startsWith('172.') || ip === '127.0.0.1' || ip === '::1') {
          return '局域网';
        }
        return '—';
      }
      if (p && c && p !== c) return `${p} / ${c}`;
      return p || c;
    },
  },
  { title: '时间', dataIndex: 'created_at', render: fmtTime },
];


export default function LogsPage() {
  return (
    <>
      <Card className="log-page">
        <Tabs
          items={[
            {
              key: 'login',
              label: '登录日志',
              children: (
                <LogTable<LoginLog>
                  fetcher={logApi.login}
                  columns={loginColumns}
                  filters={[{ key: 'username', placeholder: '姓名 / 用户名' }]}
                />
              ),
            },
            {
              key: 'op',
              label: '操作日志',
              children: (
                <LogTable<OperationLog>
                  fetcher={logApi.operation}
                  columns={operationColumns}
                  filters={[
                    { key: 'username', placeholder: '用户' },
                    {
                      key: 'resource',
                      placeholder: '资源类型',
                      type: 'select',
                      options: Object.entries(RESOURCE_LABEL).map(([value, label]) => ({ value, label })),
                    },
                  ]}
                />
              ),
            },
            {
              key: 'access',
              label: '应用访问日志',
              children: (
                <LogTable<AccessLog>
                  fetcher={logApi.access}
                  columns={accessColumns}
                  filters={[
                    { key: 'username', placeholder: '用户' },
                    { key: 'client_id', placeholder: 'Client ID' },
                  ]}
                />
              ),
            },
            {
              key: 'strategy',
              label: '清除策略',
              children: <LogsStrategyPanel />,
            },
          ]}
        />
      </Card>
    </>
  );
}
