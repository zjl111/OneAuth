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
  Drawer,
  Transfer,
  TreeSelect,
} from 'antd';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  ApartmentOutlined,
  SearchOutlined,
  MoreOutlined,
  UserAddOutlined,
  SwapOutlined,
} from '@ant-design/icons';
import { orgApi, roleApi, type Department, type Role } from '@/api/misc';
import { usersApi, type User } from '@/api/users';
import UserAvatar from '@/components/UserAvatar';
import './orgs.css';
import '../user-groups/user-groups.css';

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

function getFirstDepartment(tree: Department[]): Department | null {
  return tree[0]?.children?.[0] || tree[0] || null;
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

  // 添加成员 Drawer
  const [addMemberOpen, setAddMemberOpen] = useState(false);
  const [candidateUsers, setCandidateUsers] = useState<User[]>([]);
  const [pickedUserIds, setPickedUserIds] = useState<string[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);

  // 移动部门 Modal
  const [moveOpen, setMoveOpen] = useState(false);
  const [movingDept, setMovingDept] = useState<Department | null>(null);
  const [moveTargetParent, setMoveTargetParent] = useState<string | null>(null);

  const openDeptMove = (d: Department) => {
    setMovingDept(d);
    setMoveTargetParent(d.parent_id || null);
    setMoveOpen(true);
  };
  const handleDeptMove = async () => {
    if (!movingDept) return;
    try {
      await orgApi.move(movingDept.id, moveTargetParent || null);
      message.success('已移动');
      setMoveOpen(false);
      setMovingDept(null);
      loadTree();
    } catch (e: any) {
      message.error(e?.response?.data?.message || '移动失败');
    }
  };

  const loadTree = () => orgApi.tree().then(setTree);
  useEffect(() => {
    loadTree();
    roleApi.list().then(setRoles);
  }, []);

  const loadMembers = (deptId?: string) => {
    setMemberLoading(true);
    // 如果选中了部门，收集该部门及其所有子部门的 ID
    const deptIds = deptId ? collectSubtreeIds(tree, deptId) : undefined;
    usersApi
      .list({
        page: pagination.current,
        page_size: pagination.pageSize,
        department_ids: deptIds ? deptIds.join(',') : undefined,
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

  // 首次加载时不自动选中任何部门，展示全部用户

  const handleDeptAdd = (p?: Department) => {
    setEditingDept(null);
    // 如果传入了父节点（点击"新建子部门"），使用它；否则默认为根目录
    const defaultParent = p || null;
    setDeptParent(defaultParent);
    deptForm.resetFields();
    setTimeout(() => {
      deptForm.setFieldsValue({ 
        sort_order: 0,
        parent_id: defaultParent?.id || '',
      });
    }, 0);
    setDeptOpen(true);
  };

  const handleDeptEdit = (d: Department) => {
    setEditingDept(d);
    setDeptParent(null);
    deptForm.resetFields();
    // 使用 setTimeout 确保表单字段已渲染后再设置值
    setTimeout(() => {
      deptForm.setFieldsValue({
        name: d.name,
        parent_id: d.parent_id || '',
        sort_order: d.sort_order ?? 0,
        description: d.description || '',
      });
    }, 0);
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
    const payload = { ...v, parent_id: v.parent_id || null };
    if (editingDept) {
      await orgApi.update(editingDept.id, payload);
      message.success('已更新');
    } else {
      await orgApi.create(payload);
      message.success('已创建');
    }
    setDeptOpen(false);
    loadTree();
  };

  // 添加成员：从其他部门的用户里挑选
  const openAddMember = async () => {
    if (!selectedDept) return;
    const all = await usersApi.list({ page: 1, page_size: 1000 });
    setCandidateUsers((all.items || []).filter((u) => u.department_id !== selectedDept.id));
    setPickedUserIds([]);
    setAddMemberOpen(true);
  };
  const handleAddMember = async () => {
    if (pickedUserIds.length === 0 || !selectedDept) return;
    let success = 0;
    for (const uid of pickedUserIds) {
      try {
        await usersApi.update(uid, { department_id: selectedDept.id });
        success++;
      } catch {}
    }
    message.success(`已添加 ${success} 位成员`);
    setAddMemberOpen(false);
    loadMembers(selectedDept.id);
  };

  const transferData = useMemo(
    () =>
      candidateUsers.map((u) => ({
        key: u.id,
        title: u.nickname || u.username,
        description: u.email || u.username,
      })),
    [candidateUsers]
  );

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
                      { key: 'move', icon: <SwapOutlined />, label: '移动', onClick: () => openDeptMove(d) },
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
                {selectedDept ? `${selectedDept.name} 成员` : '全部成员'}
              </div>
              <div style={{ fontSize: 12, color: '#94a3b8' }}>
                {selectedDept ? `共 ${memberTotal} 人` : `共 ${memberTotal} 人`}
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
            showTotal: (t) => `共 ${t} 条`,
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
              width: 160,
              render: (_, r) => (
                <div style={{ display: 'flex', alignItems: 'center', gap: 0, flexWrap: 'nowrap' }}>
                  <Popconfirm
                    title={`将 ${r.nickname || r.username} 移出本部门？`}
                    onConfirm={() => handleRemoveMember(r)}
                  >
                    <span className="act-link">移出部门</span>
                  </Popconfirm>
                  <span className="act-sep" />
                  <Popconfirm
                    title={`删除用户 ${r.nickname || r.username}？`}
                    okType="danger"
                    onConfirm={() => handleDeleteMember(r)}
                  >
                    <span className="act-link" style={{ color: '#ef4444' }}>删除</span>
                  </Popconfirm>
                </div>
              ),
            },
          ]}
        />
      </Card>

      {/* 部门 Drawer */}
      <Drawer
        title={editingDept ? '编辑部门' : '新建部门'}
        className="dept-drawer"
        open={deptOpen}
        onClose={() => setDeptOpen(false)}
        width={760}
        destroyOnClose
        closable
      >
        <Form form={deptForm} layout="vertical" preserve={false}>
          <Form.Item name="name" label="部门名称" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="parent_id" label="上级组织">
            <TreeSelect
              allowClear
              showSearch
              treeDefaultExpandAll
              placeholder="根目录（顶级部门）"
              treeNodeFilterProp="title"
              treeData={[
                { title: '根目录', value: '', key: 'root' },
                ...(() => {
                  // 编辑时排除自身及其子树，防止循环引用
                  const exclude = editingDept ? new Set(collectSubtreeIds(tree, editingDept.id)) : new Set<string>();
                  const build = (list: Department[]): any[] =>
                    list
                      .filter((d) => !exclude.has(d.id))
                      .map((d) => ({
                        title: d.name,
                        value: d.id,
                        key: d.id,
                        children: d.children?.length ? build(d.children) : undefined,
                      }));
                  return build(tree);
                })(),
              ]}
            />
          </Form.Item>
          <Form.Item name="sort_order" label="排序">
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
        <div className="drawer-footer">
          <Button onClick={() => setDeptOpen(false)}>取消</Button>
          <Button type="primary" onClick={handleDeptSave}>保存</Button>
        </div>
      </Drawer>

      {/* 移动部门 Drawer */}
      <Drawer
        title={movingDept ? `移动部门「${movingDept.name}」` : '移动部门'}
        className="dept-drawer"
        open={moveOpen}
        onClose={() => setMoveOpen(false)}
        width={760}
        destroyOnClose
        closable
      >
        <div style={{ marginBottom: 12, color: '#475569', fontSize: 13 }}>
          选择新的上级部门：选"根目录"将变成顶级部门；不能选择自身或自身的子部门。
        </div>
        <TreeSelect
          allowClear
          showSearch
          treeDefaultExpandAll
          style={{ width: '100%' }}
          placeholder="根目录（顶级部门）"
          treeNodeFilterProp="title"
          value={moveTargetParent || undefined}
          onChange={(v) => setMoveTargetParent(v || null)}
          treeData={[
            { title: '根目录', value: '', key: 'root' },
            ...(() => {
              // 排除自己 + 自己子树
              const exclude = movingDept ? new Set(collectSubtreeIds(tree, movingDept.id)) : new Set<string>();
              const build = (list: Department[]): any[] =>
                list
                  .filter((d) => !exclude.has(d.id))
                  .map((d) => ({
                    title: d.name,
                    value: d.id,
                    key: d.id,
                    children: d.children?.length ? build(d.children) : undefined,
                  }));
              return build(tree);
            })(),
          ]}
        />
        <div className="drawer-footer">
          <Button onClick={() => setMoveOpen(false)}>取消</Button>
          <Button type="primary" onClick={handleDeptMove}>确认移动</Button>
        </div>
      </Drawer>

      {/* 添加成员 Drawer */}
      {(() => {
        const rightCount = pickedUserIds.length;
        const leftCount = candidateUsers.length - rightCount;
        return (
          <Drawer
            title={selectedDept ? `添加成员到「${selectedDept.name}」` : '添加成员'}
            className="ug-member-drawer"
            open={addMemberOpen}
            onClose={() => setAddMemberOpen(false)}
            width={760}
            destroyOnClose
            closable
          >
            <div className="ug-member-drawer-body">
              <Transfer
                dataSource={transferData}
                targetKeys={pickedUserIds}
                onChange={(keys) => setPickedUserIds(keys as string[])}
                render={(item) => `${item.title}（${item.description}）`}
                showSearch
                listStyle={{ width: 290, height: 420 }}
                titles={[`可选用户 (${leftCount})`, `已选成员 (${rightCount})`]}
                locale={{
                  itemUnit: '人',
                  itemsUnit: '人',
                  searchPlaceholder: '搜索昵称 / 邮箱',
                }}
              />
            </div>
            <div className="ug-member-drawer-footer">
              <Button onClick={() => setAddMemberOpen(false)}>取消</Button>
              <Button type="primary" onClick={handleAddMember} disabled={pickedUserIds.length === 0}>
                确认添加
              </Button>
            </div>
          </Drawer>
        );
      })()}
    </div>
  );
}
