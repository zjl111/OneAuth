import { useEffect, useMemo, useState } from 'react';
import {
  Card,
  Tree,
  Button,
  Modal,
  Form,
  Input,
  InputNumber,
  Space,
  App as AntdApp,
  Empty,
  Table,
  Tag,
  Dropdown,
  Popconfirm,
  Select,
} from 'antd';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  ApartmentOutlined,
  SearchOutlined,
  MoreOutlined,
  UserAddOutlined,
} from '@ant-design/icons';
import { orgApi, roleApi, type Department, type Role } from '@/api/misc';
import { usersApi, type User } from '@/api/users';
import UserAvatar from '@/components/UserAvatar';
import './orgs.css';

type DeptTreeNode = {
  key: string;
  title: React.ReactNode;
  children?: DeptTreeNode[];
  raw: Department;
};

function flattenDepts(list: Department[], acc: Department[] = []): Department[] {
  list.forEach((d) => {
    acc.push(d);
    if (d.children?.length) flattenDepts(d.children, acc);
  });
  return acc;
}

// 在整棵树中找到 id 对应的节点，并返回该节点 + 所有后代的 id 列表
function collectSubtreeIds(tree: Department[], rootId: string): string[] {
  const dfs = (list: Department[]): Department | null => {
    for (const d of list) {
      if (d.id === rootId) return d;
      if (d.children?.length) {
        const hit = dfs(d.children);
        if (hit) return hit;
      }
    }
    return null;
  };
  const root = dfs(tree);
  if (!root) return [rootId];
  return flattenDepts([root]).map((d) => d.id);
}

export default function OrgPage() {
  const { message, modal } = AntdApp.useApp();

  // 部门
  const [tree, setTree] = useState<Department[]>([]);
  const [deptKeyword, setDeptKeyword] = useState('');
  const [selectedDept, setSelectedDept] = useState<Department | null>(null);

  // 部门 Modal
  const [deptOpen, setDeptOpen] = useState(false);
  const [editingDept, setEditingDept] = useState<Department | null>(null);
  const [deptParent, setDeptParent] = useState<Department | null>(null);
  const [deptForm] = Form.useForm();

  // 成员
  const [members, setMembers] = useState<User[]>([]);
  const [memberTotal, setMemberTotal] = useState(0);
  const [memberLoading, setMemberLoading] = useState(false);
  const [memberKeyword, setMemberKeyword] = useState('');
  const [pagination, setPagination] = useState({ current: 1, pageSize: 10 });

  // 添加成员 Modal
  const [addMemberOpen, setAddMemberOpen] = useState(false);
  const [candidateUsers, setCandidateUsers] = useState<User[]>([]);
  const [pickedUserId, setPickedUserId] = useState<string | undefined>();
  const [roles, setRoles] = useState<Role[]>([]);

  const loadTree = () => orgApi.tree().then(setTree);
  useEffect(() => {
    loadTree();
    roleApi.list().then(setRoles);
  }, []);

  const loadMembers = (deptId?: string) => {
    if (!deptId) {
      setMembers([]);
      setMemberTotal(0);
      return;
    }
    const ids = collectSubtreeIds(tree, deptId);
    setMemberLoading(true);
    usersApi
      .list({
        page: pagination.current,
        page_size: pagination.pageSize,
        department_ids: ids.join(','),
        keyword: memberKeyword,
      })
      .then((d) => {
        setMembers(d.items || []);
        setMemberTotal(d.total);
      })
      .finally(() => setMemberLoading(false));
  };

  useEffect(() => {
    loadMembers(selectedDept?.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDept?.id, pagination.current, pagination.pageSize]);

  // 第一次树加载完成后自动选第一个
  useEffect(() => {
    if (!selectedDept && tree.length > 0) {
      const first = tree[0].children?.[0] || tree[0];
      setSelectedDept(first);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree]);

  const handleDeptAdd = (p?: Department) => {
    setEditingDept(null);
    setDeptParent(p || null);
    deptForm.resetFields();
    deptForm.setFieldsValue({ sort_order: 0 });
    setDeptOpen(true);
  };

  const handleDeptEdit = (d: Department) => {
    setEditingDept(d);
    setDeptParent(null);
    deptForm.setFieldsValue(d);
    setDeptOpen(true);
  };

  const handleDeptDel = (d: Department) =>
    modal.confirm({
      title: `确认删除部门「${d.name}」？`,
      content: '该部门下的成员将变为"未分配部门"，但不会被删除。',
      okType: 'danger',
      onOk: async () => {
        await orgApi.delete(d.id);
        message.success('已删除');
        if (selectedDept?.id === d.id) setSelectedDept(null);
        loadTree();
      },
    });

  const handleDeptSave = async () => {
    const v = await deptForm.validateFields();
    if (editingDept) {
      await orgApi.update(editingDept.id, v);
      message.success('已更新');
    } else {
      await orgApi.create({ ...v, parent_id: deptParent?.id });
      message.success('已创建');
    }
    setDeptOpen(false);
    loadTree();
  };

  // 添加成员：从未分配 / 其他部门的用户里挑
  const openAddMember = async () => {
    if (!selectedDept) return;
    const all = await usersApi.list({ page: 1, page_size: 200 });
    setCandidateUsers((all.items || []).filter((u) => u.department_id !== selectedDept.id));
    setPickedUserId(undefined);
    setAddMemberOpen(true);
  };
  const handleAddMember = async () => {
    if (!pickedUserId || !selectedDept) return;
    await usersApi.update(pickedUserId, { department_id: selectedDept.id });
    message.success('已添加');
    setAddMemberOpen(false);
    loadMembers(selectedDept.id);
  };

  const handleRemoveMember = async (u: User) => {
    await usersApi.update(u.id, { department_id: null as any });
    message.success('已从部门移除');
    loadMembers(selectedDept?.id);
  };

  const handleDeleteMember = async (u: User) => {
    await usersApi.delete(u.id);
    message.success('用户已删除');
    loadMembers(selectedDept?.id);
  };

  // 部门树搜索过滤
  const filteredTree = useMemo<DeptTreeNode[]>(() => {
    const kw = deptKeyword.trim();
    const build = (list: Department[]): DeptTreeNode[] =>
      list
        .map((d) => {
          const children = d.children ? build(d.children) : [];
          const hit = !kw || d.name.includes(kw);
          if (!hit && children.length === 0) return null;
          return {
            key: d.id,
            title: (
              <div className="dept-node">
                <ApartmentOutlined className="dept-icon" />
                <span className="dept-name">{d.name}</span>
                <Dropdown
                  trigger={['click']}
                  menu={{
                    items: [
                      { key: 'add', icon: <PlusOutlined />, label: '新建子部门', onClick: () => handleDeptAdd(d) },
                      { key: 'edit', icon: <EditOutlined />, label: '编辑', onClick: () => handleDeptEdit(d) },
                      { type: 'divider' as const },
                      { key: 'del', icon: <DeleteOutlined />, label: '删除', danger: true, onClick: () => handleDeptDel(d) },
                    ],
                  }}
                >
                  <Button
                    type="text"
                    size="small"
                    className="dept-more"
                    icon={<MoreOutlined />}
                    onClick={(e) => e.stopPropagation()}
                  />
                </Dropdown>
              </div>
            ),
            children: children.length ? children : undefined,
            raw: d,
          } as DeptTreeNode;
        })
        .filter(Boolean) as DeptTreeNode[];
    return build(tree);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree, deptKeyword]);

  return (
    <div className="org-page">
      {/* 左：部门树 */}
      <Card
        className="dept-tree-card"
        title={
          <div className="dept-tree-title">
            <div>
              <div style={{ fontSize: 16, fontWeight: 600 }}>组织架构</div>
              <div style={{ fontSize: 12, color: '#94a3b8' }}>按部门查看层级关系</div>
            </div>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => handleDeptAdd()}>
              新建部门
            </Button>
          </div>
        }
      >
        <Input
          allowClear
          prefix={<SearchOutlined />}
          placeholder="搜索部门名称"
          value={deptKeyword}
          onChange={(e) => setDeptKeyword(e.target.value)}
          style={{ marginBottom: 12 }}
        />
        {filteredTree.length === 0 ? (
          <Empty description="暂无部门" />
        ) : (
          <Tree
            treeData={filteredTree}
            defaultExpandAll
            showLine={{ showLeafIcon: false }}
            blockNode
            selectedKeys={selectedDept ? [selectedDept.id] : []}
            onSelect={(_, info) => {
              const node = info.node as any;
              setSelectedDept(node.raw);
              setPagination((p) => ({ ...p, current: 1 }));
            }}
          />
        )}
      </Card>

      {/* 右：成员列表 */}
      <Card
        className="dept-members-card"
        title={
          <div className="dept-members-title">
            <div>
              <div style={{ fontSize: 16, fontWeight: 600 }}>
                {selectedDept ? `${selectedDept.name} 成员` : '请选择左侧部门'}
              </div>
              <div style={{ fontSize: 12, color: '#94a3b8' }}>
                {selectedDept ? `共 ${memberTotal} 人` : '点击左侧任意部门查看成员'}
              </div>
            </div>
            <Space>
              <Input
                allowClear
                prefix={<SearchOutlined />}
                placeholder="搜索成员姓名或邮箱"
                value={memberKeyword}
                onChange={(e) => setMemberKeyword(e.target.value)}
                onPressEnter={() => loadMembers(selectedDept?.id)}
                style={{ width: 240 }}
              />
              <Button
                type="primary"
                icon={<UserAddOutlined />}
                disabled={!selectedDept}
                onClick={openAddMember}
              >
                新增成员
              </Button>
            </Space>
          </div>
        }
      >
        <Table
          rowKey="id"
          loading={memberLoading}
          dataSource={members}
          pagination={{
            current: pagination.current,
            pageSize: pagination.pageSize,
            total: memberTotal,
            showSizeChanger: true,
            onChange: (p, s) => setPagination({ current: p, pageSize: s }),
          }}
          columns={[
            {
              title: '姓名',
              key: 'name',
              render: (_, r) => (
                <Space>
                  <UserAvatar src={r.avatar} name={r.nickname || r.username} size={32} />
                  <span>{r.nickname || r.username}</span>
                </Space>
              ),
            },
            { title: '邮箱', dataIndex: 'email', render: (v) => v || '-' },
            {
              title: '角色',
              dataIndex: 'roles',
              render: (rs: User['roles']) =>
                rs?.length ? (
                  <Space size={4}>
                    {rs.map((r) => (
                      <Tag color="blue" key={r.id}>
                        {r.name}
                      </Tag>
                    ))}
                  </Space>
                ) : (
                  '-'
                ),
            },
            {
              title: '状态',
              key: 'status',
              width: 100,
              render: (_, r) =>
                r.is_locked ? <Tag color="red">锁定</Tag> : r.is_active ? <Tag color="green">在职</Tag> : <Tag>禁用</Tag>,
            },
            {
              title: '操作',
              key: 'actions',
              width: 180,
              render: (_, r) => (
                <Space size={4}>
                  <Popconfirm
                    title={`将 ${r.nickname || r.username} 移出本部门？`}
                    onConfirm={() => handleRemoveMember(r)}
                  >
                    <Button type="link" size="small">
                      移出部门
                    </Button>
                  </Popconfirm>
                  <Popconfirm
                    title={`删除用户 ${r.nickname || r.username}？`}
                    okType="danger"
                    onConfirm={() => handleDeleteMember(r)}
                  >
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

      {/* 部门 Modal */}
      <Modal
        title={editingDept ? '编辑部门' : `新建部门${deptParent ? ' (父级: ' + deptParent.name + ')' : ''}`}
        open={deptOpen}
        onCancel={() => setDeptOpen(false)}
        onOk={handleDeptSave}
        destroyOnClose
      >
        <Form form={deptForm} layout="vertical" preserve={false}>
          <Form.Item name="name" label="部门名称" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="sort_order" label="排序">
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>

      {/* 添加成员 Modal */}
      <Modal
        title={selectedDept ? `添加成员到「${selectedDept.name}」` : '添加成员'}
        open={addMemberOpen}
        onCancel={() => setAddMemberOpen(false)}
        onOk={handleAddMember}
        okButtonProps={{ disabled: !pickedUserId }}
        destroyOnClose
      >
        <p style={{ color: '#6b7280', marginTop: 0 }}>
          从其他部门或未分配部门的用户中选一位添加到当前部门：
        </p>
        <Select
          showSearch
          style={{ width: '100%' }}
          placeholder="搜索并选择用户"
          optionFilterProp="label"
          value={pickedUserId}
          onChange={setPickedUserId}
          options={candidateUsers.map((u) => ({
            value: u.id,
            label: `${u.nickname || u.username} (${u.email || u.username})`,
          }))}
        />
      </Modal>
    </div>
  );
}
