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
  Collapse,
  App as AntdApp,
} from 'antd';
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { loginRuleApi, type LoginRule } from '@/api/misc';
import { usersApi, type User } from '@/api/users';
import TimeMaskPicker from '@/components/TimeMaskPicker';

export default function LoginRulesPage() {
  const { message } = AntdApp.useApp();
  const [data, setData] = useState<LoginRule[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);

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
      priority: 50,
      enabled: true,
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
        await loginRuleApi.update(editing.id, v);
        message.success('已更新');
      } else {
        await loginRuleApi.create(v);
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
    <div>
      <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ color: '#6b7280', fontSize: 13 }}>
          按规则的优先级（数字越小越优先）顺序匹配登录请求的 IP 与时段。命中首条匹配规则即决定允许或拒绝；未命中任一规则时默认放行。
        </div>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={load}>
            刷新
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            新建规则
          </Button>
        </Space>
      </div>

      <Table<LoginRule>
        rowKey="id"
        loading={loading}
        dataSource={data}
        pagination={false}
        columns={[
          { title: '优先级', dataIndex: 'priority', width: 90, align: 'center' },
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
            width: 140,
            render: (_, r) => (
              <Space size={4}>
                <Button type="link" size="small" onClick={() => openEdit(r)}>
                  编辑
                </Button>
                <Popconfirm title={`删除规则「${r.name}」？`} okType="danger" onConfirm={() => handleDelete(r)}>
                  <Button type="link" size="small" danger>
                    删除
                  </Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />

      <Drawer
        title={editing ? '编辑登录规则' : '新建登录规则'}
        width={780}
        open={open}
        onClose={() => setOpen(false)}
        destroyOnClose
        extra={
          <Space>
            <Button onClick={() => setOpen(false)}>取消</Button>
            <Button type="primary" loading={saving} onClick={handleSave}>
              保存
            </Button>
          </Space>
        }
      >
        <Form form={form} layout="vertical" preserve={false}>
          <Collapse
            defaultActiveKey={['base', 'user', 'rule', 'action']}
            ghost
            items={[
              {
                key: 'base',
                label: '基本设置',
                children: (
                  <>
                    <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入规则名称' }]}>
                      <Input placeholder="例如：拒绝外网工作时间登录" />
                    </Form.Item>
                    <Form.Item
                      name="priority"
                      label="优先级"
                      tooltip="数字越小越优先匹配；多条规则同优先级时按创建顺序"
                      rules={[{ required: true }]}
                    >
                      <InputNumber min={1} max={1000} style={{ width: 200 }} />
                    </Form.Item>
                    <Form.Item name="enabled" label="启用此规则" valuePropName="checked">
                      <Switch />
                    </Form.Item>
                  </>
                ),
              },
              {
                key: 'user',
                label: '用户',
                children: (
                  <>
                    <Form.Item name="user_scope" label="用户" rules={[{ required: true }]}>
                      <Radio.Group>
                        <Radio value="all">全部用户</Radio>
                        <Radio value="specific">指定用户</Radio>
                      </Radio.Group>
                    </Form.Item>
                    {userScope === 'specific' && (
                      <Form.Item name="user_ids" label="选择用户">
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
                  </>
                ),
              },
              {
                key: 'rule',
                label: '规则',
                children: (
                  <>
                    <Form.Item
                      name="ips"
                      label="IP"
                      tooltip="* 表示匹配所有；支持单个 IP、CIDR (如 10.0.0.0/8)、IP 区间 (如 1.1.1.1-1.1.1.10)"
                    >
                      <Select
                        mode="tags"
                        placeholder="按 Enter 添加多个 IP / CIDR / 区间"
                        tokenSeparators={[',', ' ']}
                        options={[{ value: '*', label: '* (全部)' }]}
                      />
                    </Form.Item>
                    <Form.Item name="time_mask" label="时段" tooltip="鼠标按住拖动选择；不选 = 全时段">
                      <TimeMaskWrapper />
                    </Form.Item>
                  </>
                ),
              },
              {
                key: 'action',
                label: '动作',
                children: (
                  <Form.Item name="action" label="命中规则后的动作" rules={[{ required: true }]}>
                    <Radio.Group>
                      <Radio value="accept">
                        <span style={{ color: '#10b981' }}>● 允许</span>
                      </Radio>
                      <Radio value="deny">
                        <span style={{ color: '#ef4444' }}>● 拒绝</span>
                      </Radio>
                    </Radio.Group>
                  </Form.Item>
                ),
              },
            ]}
          />
        </Form>
      </Drawer>

      {/* 调试：隐藏 userMap 引用，避免 TS 提示未用变量 */}
      <div style={{ display: 'none' }}>{userMap.size}</div>
    </div>
  );
}

// Form 的 Item 必须把 value/onChange 转传给子组件
function TimeMaskWrapper({ value, onChange }: { value?: string; onChange?: (v: string) => void }) {
  return <TimeMaskPicker value={value} onChange={onChange} />;
}
