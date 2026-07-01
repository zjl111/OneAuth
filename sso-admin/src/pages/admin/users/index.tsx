import { useEffect, useState, useRef } from 'react';
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
  Tag,
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
  CloseOutlined,
  CheckCircleOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import * as XLSX from 'xlsx';
import './users.css';
import { usersApi, type User, type ImportUsersResult, type ImportExisting } from '@/api/users';
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

/** 前端预览表格中的一行 */
interface ImportPreviewRow {
  row: number;
  username: string;
  nickname: string;
  password: string;
  email: string;
  phone: string;
  department: string;
  userType: string;
  admin: string;
  groups: string;
  status: 'pending' | 'existing' | 'error' | 'success';
  error?: string;
  errorDetail?: string;
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
  const [previewRows, setPreviewRows] = useState<ImportPreviewRow[]>([]);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [importResult, setImportResult] = useState<ImportUsersResult | null>(null);
  const [existingSelected, setExistingSelected] = useState<number[]>([]);
  const [updatingExisting, setUpdatingExisting] = useState(false);
  const [updateResult, setUpdateResult] = useState<{ updated: number; failed: number; errors: { row: number; username: string; reason: string }[] } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
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
    if (u.username === 'admin') {
      message.warning('管理员用户不允许删除');
      return;
    }
    await usersApi.delete(u.id);
    message.success('已删除');
    load();
  };

  const handleBatchDelete = () => {
    if (selectedRowKeys.length === 0) return;
    const protectedCount = data.filter((u) => selectedRowKeys.includes(u.id) && u.username === 'admin').length;
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

  const handleUpdateExisting = async () => {
    if (!importResult || existingSelected.length === 0) return;
    const selectedUsers = (importResult.existing || []).filter((_, idx) => existingSelected.includes(idx));
    setUpdatingExisting(true);
    try {
      const res = await usersApi.updateExisting(selectedUsers);
      setUpdateResult(res);
      if (res.updated > 0) {
        message.success(`已更新 ${res.updated} 个用户`);
      }
      if (res.failed > 0) {
        message.warning(`更新完成：成功 ${res.updated}，失败 ${res.failed}`);
      }
      load();
    } catch (e: any) {
      message.error(e?.response?.data?.message || '更新失败');
    } finally {
      setUpdatingExisting(false);
    }
  };

  // ---- 前端文件解析 ----
  const parseCSVText = (text: string): string[][] => {
    // 去 BOM
    const clean = text.startsWith('\uFEFF') ? text.slice(1) : text;
    const lines: string[][] = [];
    let cur: string[] = [];
    let field = '';
    let inQuotes = false;
    for (let i = 0; i < clean.length; i++) {
      const ch = clean[i];
      if (inQuotes) {
        if (ch === '"' && clean[i + 1] === '"') { field += '"'; i++; }
        else if (ch === '"') { inQuotes = false; }
        else { field += ch; }
      } else {
        if (ch === '"') { inQuotes = true; }
        else if (ch === ',') { cur.push(field.trim()); field = ''; }
        else if (ch === '\n' || ch === '\r') {
          if (ch === '\r' && clean[i + 1] === '\n') i++;
          cur.push(field.trim());
          if (cur.some((c) => c !== '')) lines.push(cur);
          cur = []; field = '';
        } else { field += ch; }
      }
    }
    if (field || cur.length > 0) { cur.push(field.trim()); lines.push(cur); }
    return lines;
  };

  const parseImportFile = async (file: File): Promise<ImportPreviewRow[]> => {
    const lower = file.name.toLowerCase();
    let rows: string[][] = [];

    if (lower.endsWith('.csv')) {
      const text = await file.text();
      rows = parseCSVText(text);
    } else if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: '' });
    } else {
      throw new Error('仅支持 .csv / .xlsx 文件');
    }

    if (rows.length < 2) throw new Error('文件为空或只有表头');

    // 解析表头
    const header = rows[0].map((c) => String(c).trim().replace(/\*$/, '').trim());
    const colIdx: Record<string, number> = {};
    header.forEach((h, i) => { if (h) colIdx[h] = i; });

    // 检查必填列
    for (const c of ['登录账号', '姓名', '密码']) {
      if (!(c in colIdx)) throw new Error(`缺少必填列：${c}`);
    }

    const getCell = (row: string[], key: string) => {
      const i = colIdx[key];
      if (i === undefined || i >= row.length) return '';
      return String(row[i]).trim();
    };

    // 已有用户名集合
    const existingUsernames = new Set(data.map((u) => u.username));

    const previewRows: ImportPreviewRow[] = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const username = getCell(row, '登录账号');
      const nickname = getCell(row, '姓名');
      const password = getCell(row, '密码');
      const email = getCell(row, '邮箱');
      const phone = getCell(row, '手机号');
      const department = getCell(row, '部门');
      const userType = getCell(row, '用户类型');
      const admin = getCell(row, '管理员');
      const groups = getCell(row, '用户组');

      // 全空行跳过
      if (!username && !nickname && !password && !email && !phone && !department && !groups) continue;

      let status: ImportPreviewRow['status'] = 'pending';
      let error: string | undefined;

      if (!username) { status = 'error'; error = '登录账号不能为空'; }
      else if (!nickname) { status = 'error'; error = '姓名不能为空'; }
      else if (!password) { status = 'error'; error = '密码不能为空'; }
      else if (existingUsernames.has(username)) { status = 'existing'; }

      previewRows.push({
        row: i + 1, username, nickname, password, email, phone,
        department, userType, admin, groups, status, error,
      });
    }
    return previewRows;
  };

  const handleFileSelect = async (file: File) => {
    if (file.size > 5 * 1024 * 1024) {
      message.error('文件超过 5MB');
      return false;
    }
    setImporting(true);
    setImportResult(null);
    setUpdateResult(null);
    setExistingSelected([]);
    try {
      const rows = await parseImportFile(file);
      setPreviewRows(rows);
      setImportFile(file);
    } catch (e: any) {
      message.error(e?.message || '文件解析失败');
    } finally {
      setImporting(false);
    }
    return false;
  };

  const handleImportConfirm = async () => {
    if (!importFile) return;
    setImporting(true);
    setImportProgress(0);

    // 模拟进度动画
    const progressTimer = setInterval(() => {
      setImportProgress((prev) => {
        if (prev >= 90) return prev;
        return prev + Math.random() * 15;
      });
    }, 200);

    try {
      const r = await usersApi.importFile(importFile);
      clearInterval(progressTimer);
      setImportProgress(100);
      setImportResult(r);

      // 在原表格上更新每行状态
      const errorMap = new Map<string, string>();
      (r.errors || []).forEach((e) => errorMap.set(e.username, e.reason));
      const existingSet = new Set((r.existing || []).map((e) => e.username));

      setPreviewRows((prev) =>
        prev.map((row) => {
          if (row.status === 'error') return row; // 前端校验失败的保持不变
          if (errorMap.has(row.username)) {
            return { ...row, status: 'error' as const, error: '导入失败', errorDetail: errorMap.get(row.username) };
          }
          if (existingSet.has(row.username)) {
            return { ...row, status: 'existing' as const, error: '已存在' };
          }
          return { ...row, status: 'success' as const };
        }),
      );
      load();
    } catch (e: any) {
      clearInterval(progressTimer);
      setImportProgress(0);
      message.error(e?.response?.data?.message || '导入失败');
    } finally {
      setImporting(false);
    }
  };

  const resetImportDrawer = () => {
    setImportOpen(false);
    setPreviewRows([]);
    setImportFile(null);
    setImportResult(null);
    setImportProgress(0);
    setExistingSelected([]);
    setUpdateResult(null);
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
        <Button icon={<ImportOutlined />} onClick={() => { resetImportDrawer(); setImportOpen(true); }} style={{ borderColor: '#e5e7eb', color: '#6b7280' }}>
          导入
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
            width: 120,
            fixed: 'right',
            render: (_, r) => (
              <div style={{ display: 'flex', alignItems: 'center', gap: 0, flexWrap: 'nowrap' }}>
                <span className="act-link" onClick={() => openEdit(r)}>编辑</span>
                <span className="act-sep" />
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
                        label: '删除',
                        icon: <DeleteOutlined />,
                        danger: true,
                        disabled: r.username === 'admin',
                        onClick: () => {
                          if (r.username === 'admin') return;
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
                  <span className="act-link">···</span>
                </Dropdown>
              </div>
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

      <Drawer
        title={null}
        closable={false}
        open={importOpen}
        onClose={resetImportDrawer}
        width={900}
        destroyOnClose
        className="import-drawer"
      >
        <div className="app-drawer-header">
          <span className="app-drawer-title">导入 & 创建</span>
          <Button type="text" icon={<CloseOutlined />} onClick={resetImportDrawer} className="drawer-close-btn" />
        </div>
        <div className="import-drawer-body">
          {/* ---- 阶段一：上传文件 ---- */}
          {!importFile && !importResult && (
            <>
              <div className="import-rules-panel">
                <div className="import-rules-title">
                  先下载模板填好再上传，<span style={{ color: '#f54a45' }}>*</span> 的列必填：
                </div>
                <ul className="import-rules-list">
                  <li>登录账号<span style={{ color: '#f54a45' }}>*</span>、姓名<span style={{ color: '#f54a45' }}>*</span>、密码<span style={{ color: '#f54a45' }}>*</span>、邮箱、手机号、部门、用户类型、管理员、用户组</li>
                  <li>部门按"名称"匹配（与系统中的部门同名）；用户类型 internal/external；管理员是/否</li>
                  <li>用户组按名称匹配，多个用逗号分隔（如"研发组,测试组"）；不存在的组会跳过并记录警告</li>
                  <li>文件 ≤ 5MB，支持 .csv 和 .xlsx</li>
                </ul>
                <div className="import-template-btns">
                  <Button size="small" icon={<DownloadOutlined />} href={usersApi.templateURL('xlsx')}>
                    下载 XLSX 模板
                  </Button>
                  <Button size="small" icon={<DownloadOutlined />} href={usersApi.templateURL('csv')}>
                    下载 CSV 模板
                  </Button>
                </div>
              </div>

              <Upload.Dragger
                multiple={false}
                showUploadList={false}
                accept=".csv,.xlsx"
                className="import-upload-dragger"
                beforeUpload={handleFileSelect}
                disabled={importing}
              >
                <p className="upload-icon-text">
                  <UploadOutlined style={{ fontSize: 24, color: 'var(--primary-color)' }} />
                </p>
                <p className="upload-main-text">
                  点击或将文件拖拽到这里<span>上传</span>
                </p>
                <p className="upload-hint-text">仅支持 .csv / .xlsx</p>
              </Upload.Dragger>
            </>
          )}

          {/* ---- 阶段二：预览表格 + 导入结果（统一展示） ---- */}
          {importFile && (
            <div className="import-preview-section">
              {/* 统计栏 */}
              <div className="import-stats-bar">
                <span className="stat-total">总共: {previewRows.length}</span>
                <span className="stat-success">成功: {previewRows.filter((r) => r.status === 'success').length}</span>
                <span className="stat-error">失败: {previewRows.filter((r) => r.status === 'error').length}</span>
                <span className="stat-pending">待处理: {previewRows.filter((r) => r.status === 'pending' || r.status === 'existing').length}</span>
              </div>

              {/* 进度条 */}
              {importing && (
                <div className="import-progress-wrap">
                  <div className="import-progress-bar">
                    <div className="import-progress-fill" style={{ width: `${Math.min(importProgress, 100)}%` }} />
                  </div>
                  <span className="import-progress-text">{Math.min(Math.round(importProgress), 100)}%</span>
                </div>
              )}

              {/* 数据表格 */}
              <div className="import-preview-table-wrap">
                <table className="import-preview-table">
                  <thead>
                    <tr>
                      <th style={{ width: 60 }}>状态</th>
                      <th>*名称</th>
                      <th>*用户名</th>
                      <th>*邮箱</th>
                      <th>手机</th>
                      <th>部门</th>
                      <th>用户类型</th>
                      <th>管理员</th>
                      <th>用户组</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((row) => (
                      <tr key={row.row} className={row.status === 'error' ? 'row-error' : row.status === 'existing' ? 'row-existing' : row.status === 'success' ? 'row-success' : ''}>
                        <td>
                          {row.status === 'error' ? (
                            <Tooltip title={row.errorDetail || row.error}><WarningOutlined style={{ color: '#f54a45' }} /></Tooltip>
                          ) : row.status === 'existing' ? (
                            <Tooltip title="账号已存在"><ExclamationCircleOutlined style={{ color: '#faad14' }} /></Tooltip>
                          ) : row.status === 'success' ? (
                            <CheckCircleOutlined style={{ color: '#64894d' }} />
                          ) : (
                            <CheckCircleOutlined style={{ color: '#64894d', opacity: 0.5 }} />
                          )}
                        </td>
                        <td>{row.nickname}</td>
                        <td className="col-account">{row.username}</td>
                        <td>{row.email || '-'}</td>
                        <td>{row.phone || '-'}</td>
                        <td>{row.department || '-'}</td>
                        <td>{row.userType || 'internal'}</td>
                        <td>{row.admin || '否'}</td>
                        <td>{row.groups || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* 已存在用户处理 */}
              {importResult && (importResult.existing?.length ?? 0) > 0 && !updateResult && (
                <div className="import-existing-section">
                  <div className="import-existing-header">
                    <ExclamationCircleOutlined className="existing-icon" />
                    <span className="existing-title">以下账号已存在，是否更新信息？</span>
                  </div>
                  <table className="import-existing-table">
                    <thead>
                      <tr>
                        <th style={{ width: 40 }}>
                          <Checkbox
                            checked={existingSelected.length === (importResult.existing?.length ?? 0)}
                            indeterminate={existingSelected.length > 0 && existingSelected.length < (importResult.existing?.length ?? 0)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setExistingSelected((importResult.existing || []).map((_, idx) => idx));
                              } else {
                                setExistingSelected([]);
                              }
                            }}
                          />
                        </th>
                        <th style={{ width: 60 }}>行号</th>
                        <th>账号</th>
                        <th>姓名</th>
                        <th>邮箱</th>
                        <th>手机号</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(importResult.existing || []).map((item, idx) => (
                        <tr key={`${item.row}-${item.username}`}>
                          <td>
                            <Checkbox
                              checked={existingSelected.includes(idx)}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setExistingSelected([...existingSelected, idx]);
                                } else {
                                  setExistingSelected(existingSelected.filter((i) => i !== idx));
                                }
                              }}
                            />
                          </td>
                          <td>{item.row}</td>
                          <td className="col-account">{item.username}</td>
                          <td>{item.nickname}</td>
                          <td>{item.email || '-'}</td>
                          <td>{item.phone || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="import-existing-actions">
                    <Button
                      size="small"
                      onClick={() => {
                        setImportResult({ ...importResult, existing: [] });
                        setExistingSelected([]);
                      }}
                    >
                      全部跳过
                    </Button>
                    <Button
                      type="primary"
                      size="small"
                      loading={updatingExisting}
                      disabled={existingSelected.length === 0}
                      onClick={handleUpdateExisting}
                    >
                      更新选中{existingSelected.length > 0 ? `（${existingSelected.length}）` : ''}
                    </Button>
                  </div>
                </div>
              )}

              {/* 更新结果 */}
              {updateResult && (
                <div className="import-existing-section">
                  <div className="import-existing-header">
                    <span className="existing-title">更新完成：成功 <strong style={{ color: '#64894d' }}>{updateResult.updated}</strong> 个</span>
                    {updateResult.failed > 0 && (
                      <span style={{ color: '#f54a45', marginLeft: 16 }}>失败 <strong>{updateResult.failed}</strong> 个</span>
                    )}
                  </div>
                  {updateResult.errors.length > 0 && (
                    <table className="import-result-table">
                      <thead>
                        <tr>
                          <th style={{ width: 60 }}>行号</th>
                          <th style={{ width: 120 }}>账号</th>
                          <th>失败原因</th>
                        </tr>
                      </thead>
                      <tbody>
                        {updateResult.errors.map((err) => (
                          <tr key={`update-${err.row}-${err.username}`}>
                            <td>{err.row}</td>
                            <td className="col-account">{err.username}</td>
                            <td className="col-reason">{err.reason}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
        <div className="drawer-footer">
          <Button onClick={resetImportDrawer}>取消</Button>
          {!importResult && (
            <Button
              type="primary"
              loading={importing}
              onClick={handleImportConfirm}
            >
              导入
            </Button>
          )}
          {importResult && (
            <Button type="primary" onClick={resetImportDrawer}>继续</Button>
          )}
        </div>
      </Drawer>

      </Card>
    </>
  );
}
