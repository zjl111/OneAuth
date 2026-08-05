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
  Switch,
  Checkbox,
  Tooltip,
  Upload,
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
  UploadOutlined,
  ExclamationCircleOutlined,
} from '@ant-design/icons';
import { orgApi, roleApi, userGroupApi, type Department, type Role, type UserGroup } from '@/api/misc';
import { usersApi, type User } from '@/api/users';
import UserAvatar from '@/components/UserAvatar';
import { useAuthStore } from '@/store/authStore';
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

function randomPassword(length = 12): string {
  const upper = 'ABCDEFGHJKMNPQRSTUVWXYZ';
  const lower = 'abcdefghjkmnpqrstuvwxyz';
  const digit = '23456789';
  const symbol = '!@#$%^&*';
  const all = upper + lower + digit + symbol;
  const pick = (s: string) => s[Math.floor(Math.random() * s.length)];
  let out = pick(upper) + pick(lower) + pick(digit) + pick(symbol);
  for (let i = 4; i < length; i++) out += pick(all);
  return out
    .split('')
    .sort(() => Math.random() - 0.5)
    .join('');
}

export default function OrgPage() {
  const { message, modal } = AntdApp.useApp();
  const accessToken = useAuthStore((s) => s.accessToken);

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
  const [userGroups, setUserGroups] = useState<UserGroup[]>([]);

  // 新建用户 Drawer
  const [createUserOpen, setCreateUserOpen] = useState(false);
  const [createUserForm] = Form.useForm();
  const [creatingUser, setCreatingUser] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string>('');

  const toDeptTreeData = (list: Department[]): any[] =>
    list.map((d) => ({
      value: d.id,
      title: d.name,
      key: d.id,
      children: d.children ? toDeptTreeData(d.children) : [],
    }));

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
    userGroupApi.list().then(setUserGroups);
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
        parent_id: d.parent_id || null,
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

  // 新建用户
  const openCreateUser = () => {
    createUserForm.resetFields();
    setAvatarUrl('');
    setCreateUserOpen(true);
    // 使用 setTimeout 确保表单渲染后再设置值
    setTimeout(() => {
      createUserForm.setFieldsValue({
        department_id: selectedDept?.id,
        is_active: true,
        user_type: 'internal',
      });
    }, 0);
  };

  const handleCreateUser = async () => {
    const values = await createUserForm.validateFields();
    setCreatingUser(true);
    try {
      const payload: any = {
        username: values.username,
        nickname: values.nickname,
        password: values.password,
        email: values.email,
        phone: values.phone || null,
        department_id: selectedDept?.id || null,
        user_type: values.user_type || 'internal',
        is_active: values.is_active !== false,
        is_staff: values.is_admin || false,
        avatar: avatarUrl || '',
      };
      const result = await usersApi.create(payload);
      // 如果选择了用户组，创建后设置用户组
      if (values.group_ids && values.group_ids.length > 0 && result?.id) {
        await usersApi.setGroups(result.id, values.group_ids);
      }
      message.success('用户创建成功');
      setCreateUserOpen(false);
      loadMembers(selectedDept?.id);
    } catch (e: any) {
      message.error(e?.response?.data?.message || '创建失败');
    } finally {
      setCreatingUser(false);
    }
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
                icon={<UserAddOutlined />}
                disabled={!selectedDept}
                onClick={openAddMember}
                style={{ borderColor: '#e5e7eb', color: '#6b7280' }}
              >
                添加成员
              </Button>
              <Button
                type="primary"
                icon={<PlusOutlined />}
                disabled={!selectedDept}
                onClick={openCreateUser}
              >
                新建用户
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
                  <Tag>普通用户</Tag>
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

      {/* 新建用户 Drawer */}
      <Drawer
        title="新建用户"
        open={createUserOpen}
        onClose={() => setCreateUserOpen(false)}
        width={760}
        destroyOnClose
        className="user-drawer"
        closable
      >
        {/* ---- 头像头部：横向布局 ---- */}
        <div className="avatar-header-row">
          <Upload
            name="file"
            action="/api/v1/configs/upload-image"
            headers={{ Authorization: `Bearer ${accessToken}` }}
            data={{ prefix: 'avatar' }}
            accept=".png,.jpg,.jpeg,.webp,.gif"
            showUploadList={false}
            beforeUpload={(file) => {
              if (file.size > 5 * 1024 * 1024) {
                message.error('头像不能超过 5MB');
                return Upload.LIST_IGNORE;
              }
              return true;
            }}
            onChange={(info) => {
              if (info.file.status === 'done') {
                const url = info.file.response?.data?.url;
                if (url) {
                  createUserForm.setFieldValue('avatar', url);
                  setAvatarUrl(url);
                  message.success('头像已上传');
                }
              } else if (info.file.status === 'error') {
                message.error(info.file.response?.message || '上传失败');
              }
            }}
          >
            <div className="avatar-header-inner">
              <div className="avatar-header-left">
                <div className="avatar-circle-wrap">
                  <UserAvatar src={avatarUrl} name={createUserForm.getFieldValue('nickname') || createUserForm.getFieldValue('username') || '新用户'} size={44} />
                  <div className="avatar-circle-overlay">
                    <UploadOutlined style={{ fontSize: 14 }} />
                  </div>
                </div>
                <div className="avatar-header-info">
                  <div className="avatar-header-name">{createUserForm.getFieldValue('nickname') || createUserForm.getFieldValue('username') || '新用户'}</div>
                  <div className="avatar-header-hint">点击上传/更换头像</div>
                </div>
              </div>
              <div className="avatar-header-right">
                <Button icon={<UploadOutlined />} size="small">
                  上传头像
                </Button>
              </div>
            </div>
          </Upload>
        </div>

        {/* ---- 表单主体：CSS Grid 双列骨架 ---- */}
        <div className="user-form-container">
          <Form
            form={createUserForm}
            layout="vertical"
            className="user-form-compact"
            initialValues={{
              is_active: true,
              user_type: 'internal',
            }}
          >
            <Form.Item name="avatar" style={{ display: 'none' }}>
              <input type="hidden" />
            </Form.Item>

            <div className="form-grid-container">
              {/* Row 1: 登录账号 | 姓名 */}
              <div className="grid-cell">
                <Form.Item
                  name="username"
                  label={
                    <span>
                      <span>登录账号</span>
                      <Tooltip title="登录账号为唯一标识，创建后不可更改" placement="top">
                        <ExclamationCircleOutlined className="label-tip-icon" />
                      </Tooltip>
                    </span>
                  }
                  rules={[{ required: true, message: '请输入登录账号' }]}
                >
                  <Input placeholder="字母/数字/点/下划线" />
                </Form.Item>
              </div>
              <div className="grid-cell">
                <Form.Item name="nickname" label="姓名" rules={[{ required: true, message: '请输入姓名' }]}>
                  <Input placeholder="请输入姓名" />
                </Form.Item>
              </div>

              {/* Row 2: 密码 (flex group) | 电子邮箱 */}
              <div className="grid-cell">
                <div className="password-flex-group">
                  <Form.Item
                    name="password"
                    label="密码"
                    rules={[{ required: true, min: 8, message: '至少 8 位' }]}
                    style={{ flex: 1, marginBottom: 0 }}
                  >
                    <Input.Password placeholder="请输入密码" />
                  </Form.Item>
                  <Button
                    className="gen-btn"
                    onClick={() => createUserForm.setFieldValue('password', randomPassword(12))}
                  >
                    生成
                  </Button>
                </div>
              </div>
              <div className="grid-cell grid-cell-spaced">
                <Form.Item name="email" label="电子邮箱" rules={[{ required: true, message: '请输入电子邮箱' }]}>
                  <Input placeholder="请输入电子邮箱" />
                </Form.Item>
              </div>

              {/* Row 3: 手机号码 | 所属部门 */}
              <div className="grid-cell">
                <Form.Item name="phone" label="手机号码">
                  <div className="phone-flex-group">
                    <span className="phone-prefix">+86</span>
                    <Input placeholder="请输入手机号码" />
                  </div>
                </Form.Item>
              </div>
              <div className="grid-cell">
                <Form.Item name="department_id" label="所属部门">
                  <TreeSelect
                    allowClear
                    placeholder="选择部门"
                    treeData={toDeptTreeData(tree)}
                    treeDefaultExpandAll
                    showSearch
                    treeNodeFilterProp="title"
                    getPopupContainer={() => document.body}
                    suffixIcon={<span className="custom-select-arrow"></span>}
                    className="dept-tree-select"
                  />
                </Form.Item>
              </div>

              {/* Row 3b: 用户组 (full width) */}
              <div className="grid-cell grid-cell-full">
                <Form.Item name="group_ids" label="用户组">
                  <Select
                    mode="multiple"
                    placeholder="选择用户组（可多选）"
                    options={userGroups.map((g) => ({ label: g.name, value: g.id }))}
                    getPopupContainer={() => document.body}
                  />
                </Form.Item>
              </div>

              {/* Row 4: 用户类型 | 状态 */}
              <div className="grid-cell">
                <Form.Item name="user_type" label="用户类型" rules={[{ required: true }]}>
                  <Select
                    options={[
                      { value: 'internal', label: '内部员工' },
                      { value: 'external', label: '外部协作' },
                    ]}
                    suffixIcon={<span className="custom-select-arrow">▾</span>}
                    getPopupContainer={() => document.body}
                  />
                </Form.Item>
              </div>
              <div className="grid-cell">
                <Form.Item
                  name="is_active"
                  label={
                    <span>
                      <span>状态</span>
                      <Tooltip title="禁用后该用户将无法登录系统" placement="top">
                        <ExclamationCircleOutlined className="label-tip-icon" />
                      </Tooltip>
                    </span>
                  }
                  valuePropName="checked"
                  rules={[{ required: true }]}
                  className="status-switch-item"
                >
                  <Switch checkedChildren="启用" unCheckedChildren="禁用" />
                </Form.Item>
              </div>

              {/* Row 5: 管理员权限 (full width) */}
              <div className="grid-cell grid-cell-full">
                <Form.Item
                  name="is_admin"
                  label="管理员权限"
                  valuePropName="checked"
                  className="admin-checkbox-item"
                >
                  <Checkbox>授予管理员权限</Checkbox>
                </Form.Item>
                <div className="admin-checkbox-hint">
                  勾选后该用户可登录 OneAuth 管理后台；不勾默认为普通用户，仅能访问已授权应用。
                </div>
              </div>
            </div>
          </Form>
        </div>

        {/* ---- 固底按钮栏 ---- */}
        <div className="drawer-footer">
          <Button onClick={() => setCreateUserOpen(false)}>取消</Button>
          <Button type="primary" loading={creatingUser} onClick={handleCreateUser}>
            提交
          </Button>
        </div>
      </Drawer>
    </div>
  );
}
