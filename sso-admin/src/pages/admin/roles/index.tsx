import { useEffect, useMemo, useState } from 'react';
import {
  Card,
  Table,
  Button,
  Modal,
  Form,
  Input,
  Tag,
  Space,
  Popconfirm,
  Tree,
  Drawer,
  App as AntdApp,
  Alert,
} from 'antd';
import { PlusOutlined, SafetyOutlined } from '@ant-design/icons';
import { roleApi, type Role, type Permission } from '@/api/misc';
import PageToolbar from '@/components/PageToolbar';

export default function RolePage() {
  const { message } = AntdApp.useApp();
  const [data, setData] = useState<Role[]>([]);
  const [perms, setPerms] = useState<Permission[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Role | null>(null);

  // 权限 Drawer
  const [permOpen, setPermOpen] = useState(false);
  const [permRole, setPermRole] = useState<Role | null>(null);
  const [checkedKeys, setCheckedKeys] = useState<string[]>([]);
  const [savingPerms, setSavingPerms] = useState(false);

  const [form] = Form.useForm();

  const load = () => {
    setLoading(true);
    roleApi.list().then((d) => {
      setData(d);
      setLoading(false);
    });
  };

  useEffect(() => {
    load();
    roleApi.permTree().then(setPerms);
  }, []);

  // 把后端 Permission 树转成 Antd Tree 数据，给 button 类型加 Tag
  const permTreeData = useMemo(() => {
    const ACTION_COLOR: Record<string, string> = {
      read: 'blue',
      create: 'green',
      update: 'gold',
      delete: 'red',
    };
    const ACTION_LABEL: Record<string, string> = {
      read: '查看',
      create: '新建',
      update: '修改',
      delete: '删除',
    };
    const map = (list: Permission[]): any[] =>
      list.map((p) => {
        const suffix = p.code.includes(':') ? p.code.split(':').pop()! : '';
        return {
          key: p.id,
          title: (
            <Space size={6}>
              <span style={{ fontWeight: p.type === 'menu' ? 600 : 400 }}>{p.name}</span>
              {suffix && ACTION_LABEL[suffix] && (
                <Tag color={ACTION_COLOR[suffix]} style={{ margin: 0 }}>
                  {suffix}
                </Tag>
              )}
              <code style={{ fontSize: 11, color: '#94a3b8' }}>{p.code}</code>
            </Space>
          ),
          children: p.children ? map(p.children) : undefined,
        };
      });
    return map(perms);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perms]);

  const handleSave = async () => {
    const v = await form.validateFields();
    if (editing) {
      await roleApi.update(editing.id, v);
      message.success('已更新');
    } else {
      await roleApi.create(v);
      message.success('已创建');
    }
    setOpen(false);
    load();
  };

  const openPerms = (r: Role) => {
    setPermRole(r);
    setCheckedKeys(r.permissions?.map((p) => p.id) || []);
    setPermOpen(true);
  };

  const handleSavePerms = async () => {
    if (!permRole) return;
    setSavingPerms(true);
    try {
      await roleApi.setPermissions(permRole.id, checkedKeys);
      message.success('权限已更新');
      setPermOpen(false);
      load();
    } catch (e: any) {
      message.error(e?.response?.data?.message || '保存失败');
    } finally {
      setSavingPerms(false);
    }
  };

  return (
    <>
      <PageToolbar>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => {
            setEditing(null);
            form.resetFields();
            setOpen(true);
          }}
        >
          新建角色
        </Button>
      </PageToolbar>
      <Card>
        <Table
          rowKey="id"
          loading={loading}
          dataSource={data}
          pagination={false}
          columns={[
            { title: '角色名', dataIndex: 'name', width: 180 },
            { title: '编码', dataIndex: 'code', width: 180, render: (v) => <code>{v}</code> },
            { title: '描述', dataIndex: 'description', render: (v) => v || '-' },
            {
              title: '类型',
              dataIndex: 'is_builtin',
              width: 100,
              render: (v) => (v ? <Tag color="purple">内置</Tag> : <Tag>自定义</Tag>),
            },
            {
              title: '已分配权限',
              dataIndex: 'permissions',
              width: 130,
              align: 'center',
              render: (ps?: Permission[]) => <Tag color="blue">{ps?.length || 0} 项</Tag>,
            },
            {
              title: '操作',
              width: 240,
              render: (_, r) => (
                <Space>
                  <Button type="link" size="small" icon={<SafetyOutlined />} onClick={() => openPerms(r)}>
                    分配权限
                  </Button>
                  <Button
                    type="link"
                    size="small"
                    onClick={() => {
                      setEditing(r);
                      form.setFieldsValue(r);
                      setOpen(true);
                    }}
                  >
                    编辑
                  </Button>
                  <Popconfirm
                    title="确认删除？"
                    onConfirm={async () => {
                      try {
                        await roleApi.delete(r.id);
                        message.success('已删除');
                        load();
                      } catch (e: any) {
                        message.error(e?.response?.data?.message || '删除失败');
                      }
                    }}
                    disabled={r.is_builtin}
                  >
                    <Button type="link" size="small" danger disabled={r.is_builtin}>
                      删除
                    </Button>
                  </Popconfirm>
                </Space>
              ),
            },
          ]}
        />

        <Modal title={editing ? '编辑角色' : '新建角色'} open={open} onCancel={() => setOpen(false)} onOk={handleSave} destroyOnClose>
          <Form form={form} layout="vertical" preserve={false}>
            <Form.Item name="name" label="角色名" rules={[{ required: true }]}>
              <Input />
            </Form.Item>
            <Form.Item name="code" label="编码" rules={[{ required: true }]}>
              <Input disabled={!!editing} />
            </Form.Item>
            <Form.Item name="description" label="描述">
              <Input.TextArea rows={2} />
            </Form.Item>
          </Form>
        </Modal>

        <Drawer
          title={
            <Space>
              <SafetyOutlined style={{ color: '#1677ff' }} />
              <span>分配权限 - {permRole?.name || ''}</span>
              {permRole?.code && <code style={{ fontSize: 12, color: '#94a3b8' }}>{permRole.code}</code>}
            </Space>
          }
          width={520}
          placement="right"
          open={permOpen}
          onClose={() => setPermOpen(false)}
          extra={
            <Space>
              <Button onClick={() => setPermOpen(false)}>取消</Button>
              <Button type="primary" loading={savingPerms} onClick={handleSavePerms}>
                保存
              </Button>
            </Space>
          }
        >
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message="勾选菜单会自动赋予该菜单访问权；下方「查看/新建/修改/删除」对应该菜单内的操作权限。"
          />
          <div style={{ marginBottom: 8 }}>
            <Tag color="blue">查看 read</Tag>
            <Tag color="green">新建 create</Tag>
            <Tag color="gold">修改 update</Tag>
            <Tag color="red">删除 delete</Tag>
          </div>
          <Tree
            treeData={permTreeData}
            checkable
            defaultExpandAll
            checkStrictly={false}
            checkedKeys={checkedKeys}
            onCheck={(keys, info) => {
              // 兼容 checked 对象/数组
              const next = Array.isArray(keys) ? keys : info.checked;
              setCheckedKeys(next as string[]);
            }}
            blockNode
          />
        </Drawer>
      </Card>
    </>
  );
}
