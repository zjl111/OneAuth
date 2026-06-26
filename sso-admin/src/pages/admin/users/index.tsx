import { useEffect, useState } from 'react';
import {
  Table,
  Card,
  Button,
  Input,
  Space,
  Modal,
  Form,
  Switch,
  Select,
  TreeSelect,
  Drawer,
  Upload,
  Checkbox,
  Dropdown,
  Tooltip,
  App as AntdApp,
} from 'antd';
import {
  PlusOutlined,
  ReloadOutlined,
  LockOutlined,
  UnlockOutlined,
  KeyOutlined,
  UploadOutlined,
  ImportOutlined,
  DownloadOutlined,
  MoreOutlined,
  DeleteOutlined,
  EditOutlined,
  ExclamationCircleOutlined,
} from '@ant-design/icons';
import './users.css';
import { usersApi, type User, type ImportUsersResult } from '@/api/users';
import { orgApi, roleApi, type Department, type Role } from '@/api/misc';
import PageToolbar from '@/components/PageToolbar';
import UserAvatar from '@/components/UserAvatar';
import { useAuthStore } from '@/store/authStore';

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

export default function UserListPage() {
  const { message, modal } = AntdApp.useApp();
  const [data, setData] = useState<User[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [pagination, setPagination] = useState({ current: 1, pageSize: 10 });

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importResult, setImportResult] = useState<ImportUsersResult | null>(null);
  const [importing, setImporting] = useState(false);
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);
  const [form] = Form.useForm();
  const accessToken = useAuthStore((s) => s.accessToken);
  const [avatarUrl, setAvatarUrl] = useState<string>('');

  const [depts, setDepts] = useState<Department[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);


  const toDeptTreeData = (list: Department[]): any[] =>
    list.map((d) => ({
      value: d.id,
      title: d.name,
      key: d.id,
      children: d.children ? toDeptTreeData(d.children) : [],
    }));

  const load = () => {
    setLoading(true);
    usersApi
      .list({
        page: pagination.current,
        page_size: pagination.pageSize,
        keyword,
      })
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

  useEffect(() => {
    orgApi.tree().then(setDepts);
    roleApi.list().then(setRoles);
  }, []);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ is_active: true, is_admin: false });
    setAvatarUrl('');
    setModalOpen(true);
  };

  const openEdit = (u: User) => {
    setEditing(u);
    const superAdminRoleID = roles.find((r) => r.code === 'super_admin')?.id;
    const userRoles = u.roles || [];
    form.setFieldsValue({
      ...u,
      is_admin: !!superAdminRoleID && userRoles.some((r) => r.id === superAdminRoleID),
    });
    setAvatarUrl(u.avatar || '');
    setModalOpen(true);
  };

  const handleSave = async () => {
    const values = await form.validateFields();
    const superAdminRoleID = roles.find((r) => r.code === 'super_admin')?.id;
    const payload: any = { ...values };
    delete payload.is_admin;
    payload.role_ids = values.is_admin && superAdminRoleID ? [superAdminRoleID] : [];
    // Select allowClear 清空后 form 给的是 undefined → JSON 里直接缺字段 → 后端
    // *DepartmentID == nil 跳过更新。改用全零 UUID 当哨兵，后端识别后真清空。
    if (editing && payload.department_id === undefined) {
      payload.department_id = '00000000-0000-0000-0000-000000000000';
    }
    try {
      if (editing) {
        await usersApi.update(editing.id, payload);
        message.success('已更新');
      } else {
        await usersApi.create(payload);
        message.success('已创建');
      }
      setModalOpen(false);
      load();
    } catch (e: any) {
      message.error(e?.response?.data?.message || '保存失败');
    }
  };

  const handleDelete = async (u: User) => {
    if (u.is_staff) {
      message.warning('管理员用户不允许删除');
      return;
    }
    await usersApi.delete(u.id);
    message.success('已删除');
    load();
  };

  const handleBatchDelete = () => {
    if (selectedRowKeys.length === 0) return;
    const protectedCount = data.filter((u) => selectedRowKeys.includes(u.id) && u.is_staff).length;
    if (protectedCount > 0) {
      message.warning('已选中管理员用户，不允许删除，请先取消选择');
      return;
    }
    modal.confirm({
      title: `确认删除选中的 ${selectedRowKeys.length} 个用户？`,
      content: '删除后不可恢复，关联角色与会话也会一并清理。',
      okType: 'danger',
      onOk: async () => {
        try {
          const r = await usersApi.batchDelete(selectedRowKeys);
          if (r.failed.length === 0) {
            message.success(`已删除 ${r.deleted} 个用户`);
          } else {
            message.warning(`删除 ${r.deleted} 成功，${r.failed.length} 失败`);
          }
          setSelectedRowKeys([]);
          load();
        } catch (e: any) {
          message.error(e?.response?.data?.message || '批量删除失败');
        }
      },
    });
  };

  const handleLock = async (u: User) => {
    await usersApi.lock(u.id, !u.is_locked);
    message.success(u.is_locked ? '已解锁' : '已锁定');
    load();
  };

  const handleResetPwd = (u: User) => {
    let val = '';
    modal.confirm({
      title: `重置 ${u.username} 的密码`,
      content: (
        <Input.Password
          placeholder="新密码（至少 8 位，含 2 类字符）"
          onChange={(e) => (val = e.target.value)}
        />
      ),
      onOk: async () => {
        if (val.length < 8) {
          message.error('密码长度至少 8 位');
          return Promise.reject();
        }
        await usersApi.resetPassword(u.id, val);
        message.success('已重置');
      },
    });
  };

  return (
    <>
      <PageToolbar>
        <Input
          placeholder="搜索 账号 / 姓名 / 邮箱 / 手机号"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onPressEnter={load}
          allowClear
          onClear={() => { setKeyword(''); load(); }}
          style={{ width: 280 }}
        />
        <Button icon={<ReloadOutlined />} onClick={load} style={{ borderColor: '#e5e7eb', color: '#6b7280' }}>
          刷新
        </Button>
        <Button icon={<ImportOutlined />} onClick={() => { setImportResult(null); setImportOpen(true); }} style={{ borderColor: '#e5e7eb', color: '#6b7280' }}>
          批量导入
        </Button>
        <Button
          danger
          disabled={selectedRowKeys.length === 0}
          onClick={handleBatchDelete}
        >
          批量删除{selectedRowKeys.length > 0 ? `（${selectedRowKeys.length}）` : ''}
        </Button>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={openCreate}
          style={{ boxShadow: '0 2px 8px rgba(22,119,255,0.25)' }}
        >
          新建用户
        </Button>
      </PageToolbar>
      <Card className="user-card">
      <Table
        className="user-table"
        rowKey="id"
        loading={loading}
        dataSource={data}
        scroll={{ x: 1100 }}
        rowSelection={{
          selectedRowKeys,
          onChange: (keys) => setSelectedRowKeys(keys as string[]),
        }}
        pagination={{
          current: pagination.current,
          pageSize: pagination.pageSize,
          total,
          showSizeChanger: true,
          onChange: (page, pageSize) => setPagination({ current: page, pageSize }),
        }}
        columns={[
          { title: '登录账号', dataIndex: 'username', width: 140 },
          { title: '姓名', dataIndex: 'nickname', width: 140 },
          { title: '邮箱', dataIndex: 'email', width: 200, render: (v) => v || '-' },
          {
            title: '部门',
            dataIndex: ['department', 'name'],
            width: 140,
            render: (_, r) => r.department?.name || '-',
          },
          {
            title: '管理员',
            dataIndex: 'is_staff',
            width: 90,
            render: (v) =>
              v ? (
                <span className="user-admin-dot">管理员</span>
              ) : (
                <span className="user-admin-no">—</span>
              ),
          },
          {
            title: '状态',
            width: 100,
            render: (_, r) =>
              r.is_locked ? (
                <span className="user-tag user-tag--red">锁定</span>
              ) : r.is_active ? (
                <span className="user-tag user-tag--green">正常</span>
              ) : (
                <span className="user-tag user-tag--gray">禁用</span>
              ),
          },
          {
            title: '最后登录',
            dataIndex: 'last_login',
            width: 160,
            render: (v: string | null) =>
              v ? new Date(v).toLocaleString('zh-CN', { hour12: false }) : '—',
          },
          {
            title: '操作',
            width: 140,
            fixed: 'right',
            render: (_, r) => (
              <Space size={4}>
                <Tooltip title="编辑">
                  <Button type="text" size="small" icon={<EditOutlined />} onClick={() => openEdit(r)} style={{ color: '#6b7280' }} />
                </Tooltip>
                <Dropdown
                  trigger={['click']}
                  menu={{
                    items: [
                      {
                        key: 'resetPwd',
                        label: '重置密码',
                        icon: <KeyOutlined />,
                        onClick: () => handleResetPwd(r),
                      },
                      {
                        key: 'lock',
                        label: r.is_locked ? '解锁' : '锁定',
                        icon: r.is_locked ? <UnlockOutlined /> : <LockOutlined />,
                        onClick: () => handleLock(r),
                      },
                      { type: 'divider' },
                      {
                        key: 'delete',
                        label: r.is_staff ? '管理员不可删除' : '删除',
                        icon: <DeleteOutlined />,
                        danger: true,
                        disabled: r.is_staff,
                        onClick: () => {
                          if (r.is_staff) return;
                          modal.confirm({
                            title: `确认删除 ${r.username}？`,
                            content: '删除后不可恢复。',
                            okType: 'danger',
                            onOk: () => handleDelete(r),
                          });
                        },
                      },
                    ],
                  }}
                >
                  <Button type="text" size="small" icon={<MoreOutlined />} className="user-more-btn" />
                </Dropdown>
              </Space>
            ),
          },
        ]}
      />

      <Drawer
        title={editing ? '编辑用户' : '新增用户'}
        open={modalOpen}
        onClose={() => setModalOpen(false)}
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
                  form.setFieldValue('avatar', url);
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
                  <UserAvatar src={avatarUrl} name={form.getFieldValue('nickname') || form.getFieldValue('username') || '新用户'} size={44} />
                  <div className="avatar-circle-overlay">
                    <UploadOutlined style={{ fontSize: 14 }} />
                  </div>
                </div>
                <div className="avatar-header-info">
                  <div className="avatar-header-name">{form.getFieldValue('nickname') || form.getFieldValue('username') || '新用户'}</div>
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
            form={form}
            layout="vertical"
            className="user-form-compact"
            initialValues={{
              is_active: true,
              user_type: 'internal',
            }}
          >
            {/* 隐藏字段：注册 avatar 到表单，确保保存时包含头像 URL */}
            <Form.Item name="avatar" style={{ display: 'none' }}>
              <input type="hidden" />
            </Form.Item>

            <div className="form-grid-container">
              {/* Row 1: 登录账号 | 姓名 */}
              {!editing && (
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
              )}
              <div className={`grid-cell${editing ? ' grid-cell-full' : ''}`}>
                <Form.Item name="nickname" label="姓名" rules={[{ required: true, message: '请输入姓名' }]}>
                  <Input placeholder="请输入姓名" />
                </Form.Item>
              </div>

              {/* Row 2: 密码 (flex group) | 手机号码 (flex group) */}
              {!editing && (
                <>
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
                        onClick={() => form.setFieldValue('password', randomPassword(12))}
                      >
                        生成
                      </Button>
                    </div>
                  </div>
                  <div className="grid-cell grid-cell-spaced">
                    <Form.Item name="phone" label="手机号码">
                      <div className="phone-flex-group">
                        <span className="phone-prefix">+86</span>
                        <Input placeholder="请输入手机号码" />
                      </div>
                    </Form.Item>
                  </div>
                </>
              )}

              {/* Row 3: 电子邮箱 | 所属部门 */}
              <div className="grid-cell">
                <Form.Item name="email" label="电子邮箱" rules={[{ required: true, message: '请输入电子邮箱' }]}>
                  <Input placeholder="请输入电子邮箱" />
                </Form.Item>
              </div>
              <div className="grid-cell">
                <Form.Item name="department_id" label="所属部门">
                  <TreeSelect
                    allowClear
                    placeholder="选择部门"
                    treeData={toDeptTreeData(depts)}
                    treeDefaultExpandAll
                    showSearch
                    treeNodeFilterProp="title"
                    getPopupContainer={() => document.body}
                    suffixIcon={<span className="custom-select-arrow"></span>}
                    className="dept-tree-select"
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

              {/* Row 6: 管理员权限 (full width) */}
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
          <Button onClick={() => setModalOpen(false)}>取消</Button>
          <Button type="primary" onClick={handleSave}>
            提交
          </Button>
        </div>
      </Drawer>

      <Modal
        title="批量导入用户"
        open={importOpen}
        onCancel={() => { setImportOpen(false); setImportResult(null); }}
        footer={null}
        width={640}
        destroyOnClose
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ background: '#f8fafc', padding: 12, borderRadius: 6, border: '1px solid #e2e8f0' }}>
            <div style={{ fontSize: 13, color: '#475569', lineHeight: 1.7 }}>
              先下载模板填好再上传，**带 <span style={{ color: '#ef4444' }}>*</span> 的列必填**：
              <br />
              · 登录账号<span style={{ color: '#ef4444' }}>*</span> · 姓名<span style={{ color: '#ef4444' }}>*</span> · 密码<span style={{ color: '#ef4444' }}>*</span> · 邮箱 · 手机号 · 部门 · 用户类型 · 管理员
              <br />
              · 部门按"名称"匹配（与系统中的部门同名）；用户类型 internal/external；管理员是/否
              <br />
              · 文件 ≤ 5MB，支持 .csv 和 .xlsx
            </div>
            <Space style={{ marginTop: 10 }}>
              <Button
                size="small"
                icon={<DownloadOutlined />}
                href={usersApi.templateURL('xlsx')}
                target="_blank"
                rel="noopener"
              >
                下载 XLSX 模板
              </Button>
              <Button
                size="small"
                icon={<DownloadOutlined />}
                href={usersApi.templateURL('csv')}
                target="_blank"
                rel="noopener"
              >
                下载 CSV 模板
              </Button>
            </Space>
          </div>

          <Upload.Dragger
            multiple={false}
            showUploadList={false}
            accept=".csv,.xlsx"
            beforeUpload={(file) => {
              if (file.size > 5 * 1024 * 1024) {
                message.error('文件超过 5MB');
                return Upload.LIST_IGNORE;
              }
              setImporting(true);
              setImportResult(null);
              usersApi
                .importFile(file)
                .then((r) => {
                  setImportResult(r);
                  if (r.failed === 0) {
                    message.success(`已导入 ${r.success} 个用户`);
                  } else {
                    message.warning(`导入完成：成功 ${r.success}，失败 ${r.failed}`);
                  }
                  load();
                })
                .catch((e) => {
                  message.error(e?.response?.data?.message || '导入失败');
                })
                .finally(() => setImporting(false));
              return false; // 拦截默认上传
            }}
            disabled={importing}
          >
            <p style={{ margin: 0, fontSize: 32, color: '#1677ff' }}>
              <UploadOutlined />
            </p>
            <p style={{ margin: '8px 0 4px', fontSize: 14 }}>
              {importing ? '正在导入…' : '点击或拖拽文件到这里上传'}
            </p>
            <p style={{ margin: 0, fontSize: 12, color: '#94a3b8' }}>仅支持 .csv / .xlsx</p>
          </Upload.Dragger>

          {importResult && (
            <div>
              <Space size="large" style={{ marginBottom: 8 }}>
                <span>共 <b>{importResult.total}</b> 行</span>
                <span style={{ color: '#10b981' }}>成功 <b>{importResult.success}</b></span>
                <span style={{ color: '#ef4444' }}>失败 <b>{importResult.failed}</b></span>
              </Space>
              {importResult.errors.length > 0 && (
                <Table
                  size="small"
                  rowKey={(r) => `${r.row}-${r.username}`}
                  dataSource={importResult.errors}
                  pagination={false}
                  scroll={{ y: 200 }}
                  columns={[
                    { title: '行号', dataIndex: 'row', width: 60 },
                    { title: '账号', dataIndex: 'username', width: 140 },
                    { title: '失败原因', dataIndex: 'reason' },
                  ]}
                />
              )}
            </div>
          )}
        </div>
      </Modal>

      </Card>
    </>
  );
}
