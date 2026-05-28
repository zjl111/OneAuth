import { useEffect, useMemo, useState } from 'react';
import {
  Card,
  Table,
  Button,
  Input,
  Space,
  Tag,
  Modal,
  Form,
  Drawer,
  Popconfirm,
  Transfer,
  App as AntdApp,
} from 'antd';
import { PlusOutlined, ReloadOutlined, TeamOutlined, UserAddOutlined } from '@ant-design/icons';
import { userGroupApi, type UserGroup } from '@/api/misc';
import { usersApi, type User } from '@/api/users';
import PageToolbar from '@/components/PageToolbar';

export default function UserGroupsPage() {
  const { message, modal } = AntdApp.useApp();
  const [data, setData] = useState<UserGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<UserGroup | null>(null);
  const [form] = Form.useForm();

  // 成员管理 Drawer
  const [memberOpen, setMemberOpen] = useState(false);
  const [memberGroup, setMemberGroup] = useState<UserGroup | null>(null);
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [savingMembers, setSavingMembers] = useState(false);

  const load = () => {
    setLoading(true);
    userGroupApi.list().then(setData).finally(() => setLoading(false));
  };

  useEffect(load, []);

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    if (!kw) return data;
    return data.filter(
      (g) => g.name.toLowerCase().includes(kw) || (g.description || '').toLowerCase().includes(kw)
    );
  }, [data, keyword]);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    setOpen(true);
  };
  const openEdit = (g: UserGroup) => {
    setEditing(g);
    form.setFieldsValue(g);
    setOpen(true);
  };

  const handleSave = async () => {
    const v = await form.validateFields();
    if (editing) {
      await userGroupApi.update(editing.id, v);
      message.success('已更新');
    } else {
      await userGroupApi.create(v);
      message.success('已创建');
    }
    setOpen(false);
    load();
  };

  const handleDelete = async (g: UserGroup) => {
    await userGroupApi.delete(g.id);
    message.success('已删除');
    load();
  };

  const openMembers = async (g: UserGroup) => {
    setMemberGroup(g);
    setMemberOpen(true);
    setSavingMembers(false);
    try {
      const [usersPage, members] = await Promise.all([
        usersApi.list({ page: 1, page_size: 1000 }),
        userGroupApi.members(g.id),
      ]);
      setAllUsers(usersPage.items || []);
      setPicked((members || []).map((m: any) => m.id));
    } catch (e: any) {
      message.error(e?.response?.data?.message || '加载成员失败');
    }
  };

  const handleSaveMembers = async () => {
    if (!memberGroup) return;
    setSavingMembers(true);
    try {
      await userGroupApi.setMembers(memberGroup.id, picked);
      message.success(`已保存（${picked.length} 名成员）`);
      setMemberOpen(false);
      load();
    } catch (e: any) {
      message.error(e?.response?.data?.message || '保存失败');
    } finally {
      setSavingMembers(false);
    }
  };

  const transferData = useMemo(
    () =>
      allUsers.map((u) => ({
        key: u.id,
        title: u.nickname || u.username,
        description: u.email || u.username,
      })),
    [allUsers]
  );

  return (
    <>
      <PageToolbar>
        <Input
          allowClear
          placeholder="搜索用户组名称 / 描述"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          style={{ width: 240 }}
        />
        <Button icon={<ReloadOutlined />} onClick={load}>
          刷新
        </Button>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          新建用户组
        </Button>
      </PageToolbar>

      <Card>
        <Table<UserGroup>
          rowKey="id"
          loading={loading}
          dataSource={filtered}
          pagination={{ pageSize: 10, showSizeChanger: true }}
          columns={[
            {
              title: '名称',
              dataIndex: 'name',
              render: (v) => (
                <Space>
                  <TeamOutlined style={{ color: '#1677ff' }} />
                  <span style={{ fontWeight: 500 }}>{v}</span>
                </Space>
              ),
            },
            { title: '描述', dataIndex: 'description', ellipsis: true, render: (v) => v || '-' },
            {
              title: '成员数',
              dataIndex: 'member_count',
              width: 100,
              align: 'center',
              render: (v: number) => <Tag color="blue">{v ?? 0} 人</Tag>,
            },
            { title: '创建时间', dataIndex: 'created_at', width: 180, render: (v: string) => new Date(v).toLocaleString('zh-CN') },
            {
              title: '操作',
              width: 240,
              render: (_, r) => (
                <Space size={4}>
                  <Button type="link" size="small" icon={<UserAddOutlined />} onClick={() => openMembers(r)}>
                    管理成员
                  </Button>
                  <Button type="link" size="small" onClick={() => openEdit(r)}>
                    编辑
                  </Button>
                  <Popconfirm title={`确认删除「${r.name}」？`} okType="danger" onConfirm={() => handleDelete(r)}>
                    <Button type="link" size="small" danger>
                      删除
                    </Button>
                  </Popconfirm>
                </Space>
              ),
            },
          ]}
        />
      </Card>

      <Modal
        title={editing ? '编辑用户组' : '新建用户组'}
        open={open}
        onCancel={() => setOpen(false)}
        onOk={handleSave}
        destroyOnClose
      >
        <Form form={form} layout="vertical" preserve={false}>
          <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入用户组名称' }]}>
            <Input placeholder="例如：项目 A 成员 / 出差报销审批人" />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={3} placeholder="可选" />
          </Form.Item>
        </Form>
      </Modal>

      <Drawer
        title={
          <Space>
            <TeamOutlined style={{ color: '#1677ff' }} />
            <span>管理成员 - {memberGroup?.name}</span>
          </Space>
        }
        width={720}
        open={memberOpen}
        onClose={() => setMemberOpen(false)}
        extra={
          <Space>
            <Button onClick={() => setMemberOpen(false)}>取消</Button>
            <Button type="primary" loading={savingMembers} onClick={handleSaveMembers}>
              保存
            </Button>
          </Space>
        }
      >
        <p style={{ color: '#6b7280', marginTop: 0 }}>左侧为可选用户，勾选后移到右侧即为该组成员。</p>
        <Transfer
          dataSource={transferData}
          targetKeys={picked}
          onChange={(keys) => setPicked(keys as string[])}
          render={(item) => `${item.title}（${item.description}）`}
          showSearch
          listStyle={{ width: 320, height: 480 }}
          titles={['可选用户', '已选成员']}
          locale={{
            itemUnit: '人',
            itemsUnit: '人',
            searchPlaceholder: '搜索昵称 / 邮箱',
          }}
        />
      </Drawer>
    </>
  );
}
