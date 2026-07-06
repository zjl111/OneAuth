import { useEffect, useMemo, useState } from 'react';
import {
  Card,
  Table,
  Button,
  Input,
  Space,
  Tag,
  Drawer,
  Form,
  InputNumber,
  Radio,
  Select,
  Switch,
  Popconfirm,
  App as AntdApp,
} from 'antd';
import { PlusOutlined, ReloadOutlined, DeleteOutlined } from '@ant-design/icons';
import { loginRuleApi, type LoginRule } from '@/api/misc';
import { usersApi, type User } from '@/api/users';
import TimeMaskPicker from '@/components/TimeMaskPicker';
import './login-rules.css';

export default function LoginRulesPage() {
  const { message, modal } = AntdApp.useApp();
  const [data, setData] = useState<LoginRule[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const handleBatchDelete = () => {
    if (selectedIds.length === 0) return;
    modal.confirm({
      title: `确认删除选中的 ${selectedIds.length} 条登录规则？`,
      okType: 'danger',
      onOk: async () => {
        try {
          const r: any = await loginRuleApi.batchDelete(selectedIds);
          if (r?.failed?.length) {
            message.warning(`已删除 ${r.deleted} 条，${r.failed.length} 条失败`);
          } else {
            message.success(`已删除 ${selectedIds.length} 条`);
          }
          setSelectedIds([]);
          load();
        } catch (e: any) {
          message.error(e?.response?.data?.message || '批量删除失败');
        }
      },
    });
  };

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<LoginRule | null>(null);
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);

  const load = () => {
    setLoading(true);
    loginRuleApi.list().then(setData).finally(() => setLoading(false));
  };
  useEffect(() => {
    load();
    usersApi.list({ page: 1, page_size: 500 }).then((d) => setUsers(d.items || []));
  }, []);

  const userScope = Form.useWatch('user_scope', form);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({
      priority: 30,
      user_scope: 'all',
      user_ids: [],
      ips: ['*'],
      time_mask: '',
      action: 'deny',
    });
    setOpen(true);
  };

  const openEdit = (r: LoginRule) => {
    setEditing(r);
    setOpen(true);
    setTimeout(() => {
      form.setFieldsValue({
        ...r,
        ips: r.ips?.length ? r.ips : ['*'],
        user_ids: r.user_ids || [],
      });
    }, 0);
  };

  const handleSave = async () => {
    const v = await form.validateFields();
    if (v.user_scope === 'specific' && (!v.user_ids || v.user_ids.length === 0)) {
      message.error('请选择具体用户');
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        // 编辑沿用原 enabled，不允许在 Drawer 里改
        await loginRuleApi.update(editing.id, { ...v, enabled: editing.enabled });
        message.success('已更新');
      } else {
        // 新建默认启用
        await loginRuleApi.create({ ...v, enabled: true });
        message.success('已创建');
      }
      setOpen(false);
      load();
    } catch (e: any) {
      message.error(e?.response?.data?.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (r: LoginRule) => {
    await loginRuleApi.delete(r.id);
    message.success('已删除');
    load();
  };

  const handleToggle = async (r: LoginRule) => {
    await loginRuleApi.toggle(r.id);
    message.success('已切换');
    load();
  };

  const userMap = useMemo(() => {
    const m = new Map<string, string>();
    users.forEach((u) => m.set(u.id, u.nickname || u.username));
    return m;
  }, [users]);

  return (
    <Card className="lr-page">
      <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ color: '#6b7280', fontSize: 13 }}>
          按规则的排序（数字越小越优先）顺序匹配登录请求的 IP 与时段。命中首条匹配规则即决定允许或拒绝；未命中任一规则时默认放行。
        </div>
        <Space>
          {selectedIds.length > 0 && (
            <Button danger icon={<DeleteOutlined />} onClick={handleBatchDelete}>
              批量删除（{selectedIds.length}）
            </Button>
          )}
          <Button icon={<ReloadOutlined />} onClick={load}>
            刷新
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            创建规则
          </Button>
        </Space>
      </div>

      <Table<LoginRule>
        rowKey="id"
        loading={loading}
        dataSource={data}
        pagination={false}
        rowSelection={{
          selectedRowKeys: selectedIds,
          onChange: (keys) => setSelectedIds(keys as string[]),
        }}
        columns={[
          { title: '排序', dataIndex: 'priority', width: 90, align: 'center' },
          { title: '名称', dataIndex: 'name' },
          {
            title: '范围',
            dataIndex: 'user_scope',
            width: 100,
            render: (v) => (v === 'specific' ? <Tag color="blue">指定用户</Tag> : <Tag>全部用户</Tag>),
          },
          {
            title: 'IP',
            dataIndex: 'ips',
            render: (v: string[]) =>
              !v || v.length === 0 || v.includes('*') ? (
                <Tag>全部</Tag>
              ) : (
                <Space size={4} wrap>
                  {v.map((x) => (
                    <Tag key={x}>{x}</Tag>
                  ))}
                </Space>
              ),
          },
          {
            title: '动作',
            dataIndex: 'action',
            width: 90,
            render: (v) => (v === 'accept' ? <Tag color="green">允许</Tag> : <Tag color="red">拒绝</Tag>),
          },
          {
            title: '启用',
            dataIndex: 'enabled',
            width: 80,
            render: (v, r) => <Switch size="small" checked={v} onChange={() => handleToggle(r)} />,
          },
          {
            title: '操作',
            width: 120,
            render: (_, r) => (
              <div style={{ display: 'flex', alignItems: 'center', gap: 0, flexWrap: 'nowrap' }}>
                <span className="act-link" onClick={() => openEdit(r)}>编辑</span>
                <span className="act-sep" />
                <Popconfirm title={`删除规则「${r.name}」？`} okType="danger" onConfirm={() => handleDelete(r)}>
                  <span className="act-link" style={{ color: '#ef4444' }}>删除</span>
                </Popconfirm>
              </div>
            ),
          },
        ]}
      />

      <Drawer
        title={editing ? '编辑用户登录控制' : '创建用户登录控制'}
        className="lr-drawer"
        width={760}
        open={open}
        onClose={() => setOpen(false)}
        destroyOnClose
        closable
      >
        <div className="lr-form-container">
          <Form
            form={form}
            layout="vertical"
            preserve={false}
          >
            <RuleSection title="基本设置">
              <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入规则名称' }]}>
                <Input placeholder="名称" />
              </Form.Item>
              <Form.Item
                name="priority"
                label="排序"
                tooltip="数字越小越优先匹配；多条规则同优先级时按创建顺序"
                rules={[{ required: true }]}
              >
                <InputNumber min={1} max={1000} style={{ width: '100%' }} />
              </Form.Item>
            </RuleSection>

            <RuleSection title="用户">
              <Form.Item name="user_scope" label="用户" rules={[{ required: true }]}>
                <Radio.Group>
                  <Radio value="all">全部用户</Radio>
                  <Radio value="specific">指定用户</Radio>
                </Radio.Group>
              </Form.Item>
              {userScope === 'specific' && (
                <Form.Item name="user_ids" label=" ">
                  <Select
                    mode="multiple"
                    showSearch
                    placeholder="选择用户"
                    optionFilterProp="label"
                    options={users.map((u) => ({
                      value: u.id,
                      label: `${u.nickname || u.username} (${u.email || u.username})`,
                    }))}
                  />
                </Form.Item>
              )}
            </RuleSection>

            <RuleSection title="规则">
              <Form.Item
                name="ips"
                label="IP"
                tooltip="* 表示匹配所有；支持单个 IP、CIDR (如 10.0.0.0/8)、IP 区间 (如 1.1.1.1-1.1.1.10)"
                extra={
                  <span style={{ color: '#94a3b8' }}>
                    * 表示匹配所有。例如: 192.168.10.1, 192.168.1.0/24, 10.1.1.1-10.1.1.20, 2001:db8:2de::e13,
                    2001:db8:1a:1110::/64
                  </span>
                }
              >
                <Select
                  mode="tags"
                  placeholder="IP (按下 Enter 继续输入)"
                  tokenSeparators={[',', ' ']}
                  options={[{ value: '*', label: '* (全部)' }]}
                />
              </Form.Item>
              <Form.Item name="time_mask" label="时段">
                <TimeMaskWrapper />
              </Form.Item>
            </RuleSection>

            <RuleSection title="动作">
              <Form.Item name="action" label="动作" rules={[{ required: true }]}>
                <Radio.Group>
                  <Radio value="deny">
                    <span style={{ color: '#ef4444', fontWeight: 500 }}>● 拒绝</span>
                  </Radio>
                  <Radio value="accept">
                    <span style={{ color: '#10b981', fontWeight: 500 }}>● 接受</span>
                  </Radio>
                </Radio.Group>
              </Form.Item>
            </RuleSection>
          </Form>
        </div>
        <div className="lr-drawer-footer">
          <Button onClick={() => setOpen(false)}>取消</Button>
          <Button type="primary" loading={saving} onClick={handleSave}>
            保存
          </Button>
        </div>
      </Drawer>

      {/* 调试：隐藏 userMap 引用，避免 TS 提示未用变量 */}
      <div style={{ display: 'none' }}>{userMap.size}</div>
    </Card>
  );
}

// Form 的 Item 必须把 value/onChange 转传给子组件
function TimeMaskWrapper({ value, onChange }: { value?: string; onChange?: (v: string) => void }) {
  return <TimeMaskPicker value={value} onChange={onChange} />;
}

// 分组 section：左侧彩色竖条 + 粗体标题，下方虚线分隔
function RuleSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="lr-rule-section">
      <div className="lr-rule-section-title">{title}</div>
      <div>{children}</div>
    </div>
  );
}
