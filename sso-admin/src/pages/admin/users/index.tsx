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
  Popover,
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
  CloseCircleOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  WarningOutlined,
  FilterOutlined,
  LinkOutlined,
} from '@ant-design/icons';
import * as XLSX from 'xlsx';
import './users.css';
import { usersApi, type User, type ImportUsersResult, type ImportExisting } from '@/api/users';
import { orgApi, roleApi, userGroupApi, type Department, type Role, type UserGroup } from '@/api/misc';
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
  userSource: string;
  admin: string;
  groups: string;
  status: 'pending' | 'existing' | 'error' | 'success';
  error?: string;
  errorDetail?: string;
}

function lockReasonText(reason?: string): string {
  switch (reason) {
    case 'inactivity':
      return '超过30天未登录，系统自动锁定';
    case 'login_failure':
      return '登录失败次数过多，被自动锁定';
    case 'wecom_missing':
      return '企业微信同步时账号不存在，被自动锁定';
    case 'source_missing':
      return '离职禁用';
    case 'manual':
      return '管理员手动锁定';
    default:
      return '已锁定';
  }
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
  const [importError, setImportError] = useState<string | null>(null);
  const [existingSelected, setExistingSelected] = useState<number[]>([]);
  const [updatingExisting, setUpdatingExisting] = useState(false);
  const [updateResult, setUpdateResult] = useState<{ updated: number; failed: number; errors: { row: number; username: string; reason: string }[] } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);
  const [form] = Form.useForm();
  const accessToken = useAuthStore((s) => s.accessToken);
  const [avatarUrl, setAvatarUrl] = useState<string>('');

  // 企微账号绑定弹窗
  const [wecomOpen, setWecomOpen] = useState(false);
  const [wecomUser, setWecomUser] = useState<User | null>(null);
  const [wecomValue, setWecomValue] = useState('');
  const [wecomSaving, setWecomSaving] = useState(false);

  const [depts, setDepts] = useState<Department[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [userGroups, setUserGroups] = useState<UserGroup[]>([]);

  // 筛选状态
  const [filterDeptId, setFilterDeptId] = useState<string | undefined>(undefined);
  const [filterRoleId, setFilterRoleId] = useState<string | undefined>(undefined);
  const [filterGroupId, setFilterGroupId] = useState<string | undefined>(undefined);
  const [filterStatus, setFilterStatus] = useState<string | undefined>(undefined);

  // 排序状态
  const [sortField, setSortField] = useState<string>('');
  const [sortOrder, setSortOrder] = useState<'ascend' | 'descend' | null>(null);

  // 批量修改状态
  const [batchEditOpen, setBatchEditOpen] = useState(false);
  const [batchEditForm] = Form.useForm();
  const [batchEditing, setBatchEditing] = useState(false);


  const toDeptTreeData = (list: Department[]): any[] =>
    list.map((d) => ({
      value: d.id,
      title: d.name,
      key: d.id,
      children: d.children ? toDeptTreeData(d.children) : [],
    }));

  const load = () => {
    setLoading(true);
    const params: Record<string, unknown> = {
      page: pagination.current,
      page_size: pagination.pageSize,
      keyword,
    };
    if (filterDeptId) params.department_id = filterDeptId;
    if (filterRoleId) params.role_id = filterRoleId;
    if (filterGroupId) params.group_id = filterGroupId;
    if (filterStatus) params.status = filterStatus;
    if (sortField && sortOrder) {
      const order = sortOrder === 'ascend' ? '' : '-';
      params.ordering = order + sortField;
    }
    usersApi
      .list(params)
      .then((d) => {
        setData(d.items || []);
        setTotal(d.total);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagination.current, pagination.pageSize, filterDeptId, filterRoleId, filterGroupId, filterStatus, sortField, sortOrder]);

  useEffect(() => {
    orgApi.tree().then(setDepts);
    roleApi.list().then(setRoles);
    userGroupApi.list().then(setUserGroups);
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
      // 锁定用户的状态开关显示为关闭，开启开关等同于解锁
      is_active: u.is_locked ? false : u.is_active,
      group_ids: (u.groups || []).map((g) => g.id),
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
    // group_ids 走单独的 setGroups 接口，不进 create/update payload
    const groupIds: string[] | undefined = payload.group_ids;
    delete payload.group_ids;
    // Select allowClear 清空后 form 给的是 undefined → JSON 里直接缺字段 → 后端
    // *DepartmentID == nil 跳过更新。改用全零 UUID 当哨兵，后端识别后真清空。
    if (editing && payload.department_id === undefined) {
      payload.department_id = '00000000-0000-0000-0000-000000000000';
    }
    try {
      if (editing) {
        // 锁定用户开启状态开关 → 等同于解锁
        if (editing.is_locked && payload.is_active) {
          await usersApi.lock(editing.id, false);
        }
        await usersApi.update(editing.id, payload);
        if (groupIds !== undefined) {
          await usersApi.setGroups(editing.id, groupIds);
        }
        message.success('已更新');
      } else {
        const created = await usersApi.create(payload);
        if (groupIds && groupIds.length > 0) {
          await usersApi.setGroups(created.id, groupIds);
        }
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
    const protectedIds = data
      .filter((u) => selectedRowKeys.includes(u.id) && u.username === 'admin')
      .map((u) => u.id);
    const deletableIds = selectedRowKeys.filter((id) => !protectedIds.includes(id));
    modal.confirm({
      title: `确认删除选中的 ${deletableIds.length} 个用户？`,
      content: '删除后不可恢复，关联角色与会话也会一并清理。',
      okType: 'danger',
      onOk: async () => {
        try {
          if (deletableIds.length === 0) {
            message.warning('已选择的都是受保护账号，未执行删除');
            return;
          }
          const r = await usersApi.batchDelete(deletableIds);
          if (r.failed.length === 0) {
            message.success(`已删除 ${r.deleted} 个用户`);
          } else {
            message.warning(`删除 ${r.deleted} 成功，${r.failed.length} 失败`);
          }
          if (protectedIds.length > 0) {
            message.info('已跳过 admin 账号');
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

  // 打开企微绑定弹窗：先查当前绑定的 userid 回填
  const openWecom = async (u: User) => {
    setWecomUser(u);
    setWecomValue('');
    setWecomOpen(true);
    try {
      const r = await usersApi.getWeCom(u.id);
      setWecomValue(r?.wecom_userid || '');
    } catch {
      // 查询失败不阻塞，留空由用户填写
    }
  };

  const handleSaveWeCom = async () => {
    if (!wecomUser) return;
    setWecomSaving(true);
    try {
      const r = await usersApi.bindWeCom(wecomUser.id, wecomValue.trim());
      setWecomValue(r?.wecom_userid || '');
      message.success(wecomValue.trim() ? '已绑定企业微信账号' : '已解绑企业微信账号');
      load();
    } catch (e: any) {
      message.error(e?.response?.data?.message || '操作失败');
    } finally {
      setWecomSaving(false);
    }
  };

  const handleUnbindWeCom = async () => {
    if (!wecomUser) return;
    const u = wecomUser;
    modal.confirm({
      title: `解绑 ${u.username} 的企业微信账号？`,
      content: '解绑后该用户将无法用企业微信扫码登录到本账号。',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await usersApi.bindWeCom(u.id, '');
          setWecomValue('');
          message.success('已解绑企业微信账号');
          load();
        } catch (e: any) {
          message.error(e?.response?.data?.message || '解绑失败');
        }
      },
    });
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

  const parseImportFile = async (file: File, mode: 'create' | 'update'): Promise<ImportPreviewRow[]> => {
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
    for (const c of ['登录账号', '姓名', '密码', '邮箱']) {
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
      const userSource = getCell(row, '用户来源');
      const admin = getCell(row, '管理员');
      const groups = getCell(row, '用户组');

      // 全空行跳过
      if (!username && !nickname && !password && !email && !phone && !department && !groups) continue;

      let status: ImportPreviewRow['status'] = 'pending';
      let error: string | undefined;

      if (!username) { status = 'error'; error = '登录账号不能为空'; }
      else if (!nickname) { status = 'error'; error = '姓名不能为空'; }
      else if (!password) { status = 'error'; error = '密码不能为空'; }
      else if (!email) { status = 'error'; error = '邮箱不能为空'; }
      else if (mode === 'create' && existingUsernames.has(username)) { status = 'existing'; }

      previewRows.push({
        row: i + 1, username, nickname, password, email, phone,
        department, userSource, admin, groups, status, error,
      });
    }
    return previewRows;
  };

  const loadImportPreview = async (file: File, mode: 'create' | 'update') => {
    if (file.size > 5 * 1024 * 1024) {
      message.error('文件超过 5MB');
      return false;
    }
    setImporting(true);
    setImportResult(null);
    setImportError(null);
    setUpdateResult(null);
    setExistingSelected([]);
    try {
      const rows = await parseImportFile(file, mode);
      setPreviewRows(rows);
      setImportFile(file);
    } catch (e: any) {
      message.error(e?.message || '文件解析失败');
    } finally {
      setImporting(false);
    }
    return false;
  };

  const handleFileSelect = async (file: File) => loadImportPreview(file, 'create');

  const handleImportConfirm = async () => {
    if (!importFile) return;
    setImporting(true);
    setImportProgress(0);
    setImportError(null);

    // 模拟进度动画
    const progressTimer = setInterval(() => {
      setImportProgress((prev) => {
        if (prev >= 90) return prev;
        return prev + Math.random() * 15;
      });
    }, 200);

    try {
      const r = await usersApi.importFile(importFile, 'create');
      clearInterval(progressTimer);
      setImportProgress(100);
      setImportResult(r);
      setImportError(null);

      console.log('[Import] API response:', r);
      console.log('[Import] total:', r?.total, 'success:', r?.success, 'failed:', r?.failed);

      // 在原表格上更新每行状态
      const errorMap = new Map<string, string>();
      (r.errors || []).forEach((e) => errorMap.set(e.username, e.reason));
      const existingSet = new Set((r.existing || []).map((e) => e.username));

      console.log('[Import] errors:', r.errors?.length, 'existing:', r.existing?.length);

      setPreviewRows((prev) => {
        const updated = prev.map((row) => {
          if (row.status === 'error') return row; // 前端校验失败的保持不变
          if (errorMap.has(row.username)) {
            return { ...row, status: 'error' as const, error: '导入失败', errorDetail: errorMap.get(row.username) };
          }
          if (existingSet.has(row.username)) {
            return { ...row, status: 'existing' as const, error: '已存在' };
          }
          return { ...row, status: 'success' as const };
        });
        console.log('[Import] Updated rows - success:', updated.filter(r => r.status === 'success').length, 'pending:', updated.filter(r => r.status === 'pending').length);
        return updated;
      });
      load();
    } catch (e: any) {
      clearInterval(progressTimer);
      setImportProgress(0);
      setImportResult(null);
      setImportError(e?.response?.data?.message || e?.message || '导入失败');
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
    setImportError(null);
  };

  const backToImportStart = () => {
    if (importing) return;
    setPreviewRows([]);
    setImportFile(null);
    setImportResult(null);
    setImportProgress(0);
    setExistingSelected([]);
    setUpdateResult(null);
    setImportError(null);
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
        <Popover
          content={
            <div style={{ width: 280 }}>
              <div style={{ marginBottom: 12 }}>
                <div style={{ marginBottom: 6, fontSize: 12, color: '#8c8c8c' }}>部门</div>
                <TreeSelect
                  placeholder="选择部门"
                  allowClear
                  value={filterDeptId}
                  onChange={(v) => setFilterDeptId(v)}
                  treeData={toDeptTreeData(depts)}
                  style={{ width: '100%' }}
                  treeNodeFilterProp="title"
                />
              </div>
              <div style={{ marginBottom: 12 }}>
                <div style={{ marginBottom: 6, fontSize: 12, color: '#8c8c8c' }}>角色</div>
                <Select
                  placeholder="选择角色"
                  allowClear
                  value={filterRoleId}
                  onChange={(v) => setFilterRoleId(v)}
                  style={{ width: '100%' }}
                  options={roles
                    .filter((r) => !['app_admin', 'auditor'].includes(r.code))
                    .map((r) => ({ label: r.name, value: r.id }))}
                />
              </div>
              <div style={{ marginBottom: 12 }}>
                <div style={{ marginBottom: 6, fontSize: 12, color: '#8c8c8c' }}>用户组</div>
                <Select
                  placeholder="选择用户组"
                  allowClear
                  value={filterGroupId}
                  onChange={(v) => setFilterGroupId(v)}
                  style={{ width: '100%' }}
                  options={userGroups.map((g) => ({ label: g.name, value: g.id }))}
                />
              </div>
              <div style={{ marginBottom: 12 }}>
                <div style={{ marginBottom: 6, fontSize: 12, color: '#8c8c8c' }}>状态</div>
                <Select
                  placeholder="选择状态"
                  allowClear
                  value={filterStatus}
                  onChange={(v) => setFilterStatus(v)}
                  style={{ width: '100%' }}
                  options={[
                    { label: '活跃', value: 'active' },
                    { label: '已锁定', value: 'locked' },
                    { label: '已禁用', value: 'disabled' },
                  ]}
                />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <Button
                  size="small"
                  onClick={() => {
                    setFilterDeptId(undefined);
                    setFilterRoleId(undefined);
                    setFilterGroupId(undefined);
                    setFilterStatus(undefined);
                  }}
                >
                  重置
                </Button>
                <Button size="small" type="primary" onClick={() => { load(); }}>
                  应用筛选
                </Button>
              </div>
            </div>
          }
          trigger="click"
          placement="bottomLeft"
        >
          <Button icon={<FilterOutlined />} style={{ borderColor: '#e5e7eb', color: '#6b7280' }}>
            筛选
          </Button>
        </Popover>
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
          disabled={selectedRowKeys.length === 0}
          onClick={() => {
            batchEditForm.resetFields();
            setBatchEditOpen(true);
          }}
          style={{ borderColor: '#e5e7eb', color: '#6b7280' }}
        >
          批量修改{selectedRowKeys.length > 0 ? `（${selectedRowKeys.length}）` : ''}
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
          showTotal: (t) => `共 ${t} 条`,
          onChange: (page, pageSize) => setPagination({ current: page, pageSize }),
        }}
        onChange={(pagination, filters, sorter) => {
          if ('field' in sorter && sorter.field) {
            setSortField(sorter.field as string);
            setSortOrder(sorter.order || null);
          } else {
            setSortField('');
            setSortOrder(null);
          }
        }}
        columns={[
          { title: '登录账号', dataIndex: 'username', width: 140, sorter: true },
          { title: '姓名', dataIndex: 'nickname', width: 140, sorter: true },
          { title: '邮箱', dataIndex: 'email', width: 200, render: (v) => v || '-' },
          {
            title: '部门',
            dataIndex: 'department',
            width: 140,
            sorter: true,
            render: (_, r) => r.department?.name || '-',
          },
          {
            title: '用户角色',
            dataIndex: 'roles',
            width: 110,
            sorter: true,
            render: (_, r) => {
              const roles = r.roles || [];
              if (roles.length === 0) return <span className="user-admin-no">普通用户</span>;
              return (
                <Space size={[6, 6]} wrap>
                  {roles.map((role) => (
                    <Tag key={role.id} color={role.code === 'super_admin' ? 'red' : 'blue'}>
                      {role.name}
                    </Tag>
                  ))}
                </Space>
              );
            },
          },
          {
            title: '用户组',
            dataIndex: 'groups',
            width: 180,
            render: (_, r) => {
              const groups = r.groups || [];
              if (groups.length === 0) return <span className="user-admin-no">未加入</span>;
              return (
                <Space size={[6, 6]} wrap>
                  {groups.map((group) => (
                    <Tag key={group.id} color="geekblue">
                      {group.name}
                    </Tag>
                  ))}
                </Space>
              );
            },
          },
          {
            title: '用户来源',
            dataIndex: 'user_source',
            width: 100,
            render: (v?: string) =>
              v === 'platform' ? (
                <span className="user-tag user-tag--green">平台</span>
              ) : v === 'local' ? (
                <span className="user-tag user-tag--gray">本地</span>
              ) : (
                <span className="user-admin-no">—</span>
              ),
          },
          {
            title: '状态',
            dataIndex: 'is_locked',
            width: 100,
            sorter: true,
            render: (_, r) =>
              r.is_locked ? (
                <Tooltip title={lockReasonText(r.lock_reason)}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'help' }}>
                    <span className="user-tag user-tag--red">已锁定</span>
                    <span className="act-link" onClick={(e) => { e.stopPropagation(); handleLock(r); }} style={{ whiteSpace: 'nowrap' }}>
                      解锁
                    </span>
                  </span>
                </Tooltip>
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
                      {
                        key: 'wecom',
                        label: '绑定企微账号',
                        icon: <LinkOutlined />,
                        onClick: () => openWecom(r),
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
              user_source: 'local',
            }}
          >
            {/* 隐藏字段：注册 avatar 到表单，确保保存时包含头像 URL */}
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
                  <Input placeholder="字母/数字/点/下划线" disabled={!!editing} />
                </Form.Item>
              </div>
              <div className="grid-cell">
                <Form.Item name="nickname" label="姓名" rules={[{ required: true, message: '请输入姓名' }]}>
                  <Input placeholder="请输入姓名" />
                </Form.Item>
              </div>

              {/* Row 2: 密码 (flex group) | 电子邮箱 */}
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
                    <Form.Item name="email" label="电子邮箱" rules={[{ required: true, message: '请输入电子邮箱' }]}>
                      <Input placeholder="请输入电子邮箱" />
                    </Form.Item>
                  </div>
                </>
              )}

              {/* Row 3: 手机号码 | 所属部门 */}
              <div className="grid-cell">
                {!editing ? (
                  <Form.Item name="phone" label="手机号码">
                    <div className="phone-flex-group">
                      <span className="phone-prefix">+86</span>
                      <Input placeholder="请输入手机号码" />
                    </div>
                  </Form.Item>
                ) : (
                  <Form.Item name="email" label="电子邮箱" rules={[{ required: true, message: '请输入电子邮箱' }]}>
                    <Input placeholder="请输入电子邮箱" />
                  </Form.Item>
                )}
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
                  <li>登录账号<span style={{ color: '#f54a45' }}>*</span>、姓名<span style={{ color: '#f54a45' }}>*</span>、密码<span style={{ color: '#f54a45' }}>*</span>、邮箱<span style={{ color: '#f54a45' }}>*</span>、手机号、部门、管理员、用户组</li>
                  <li>部门按"名称"匹配（与系统中的部门同名）；用户来源由系统自动标记（本地 local / 平台 platform），无需选择；管理员是/否</li>
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

          {/* ---- 导入失败：居中展示 ---- */}
          {importError && importFile && !importing && (
            <div className="import-error-state">
              <WarningOutlined className="import-error-icon" />
              <div className="import-error-title">导入失败</div>
              <div className="import-error-desc">{importError}</div>
              <div className="import-error-actions">
                <Button onClick={backToImportStart}>返回上传</Button>
                <Button type="primary" onClick={handleImportConfirm} disabled={!importFile}>
                  重试导入
                </Button>
              </div>
            </div>
          )}

          {/* ---- 阶段二：预览表格 + 导入结果（统一展示） ---- */}
          {importFile && !importError && (
            <div className="import-preview-section">
              {/* 统计栏 */}
              <div className="import-stats-bar">
                <div className="import-stats-metrics">
                  <span className="stat-total">总共: {previewRows.length}</span>
                  {!importResult && (
                    <span className="stat-pending">待导入: {previewRows.filter((r) => r.status === 'pending').length}</span>
                  )}
                  {importResult && (
                    <>
                      <span className="stat-success">成功: {previewRows.filter((r) => r.status === 'success').length}</span>
                      <span className="stat-error">失败: {previewRows.filter((r) => r.status === 'error' || r.status === 'existing').length}</span>
                      <span className="stat-pending">待处理: {previewRows.filter((r) => r.status === 'pending').length}</span>
                    </>
                  )}
                </div>
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
                      <th>用户来源</th>
                      <th>管理员</th>
                      <th>用户组</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((row) => (
                      <tr key={row.row} className={row.status === 'error' ? 'row-error' : row.status === 'existing' ? 'row-existing' : row.status === 'success' ? 'row-success' : ''}>
                        <td>
                          {row.status === 'error' ? (
                            <Tooltip title={row.errorDetail || row.error || '导入失败'}>
                              <CloseCircleOutlined style={{ color: '#f54a45' }} />
                            </Tooltip>
                          ) : row.status === 'existing' ? (
                            <Tooltip title="账号已存在">
                              <ExclamationCircleOutlined style={{ color: '#faad14' }} />
                            </Tooltip>
                          ) : row.status === 'success' ? (
                            <Tooltip title="导入成功">
                              <CheckCircleOutlined style={{ color: 'var(--primary-color)' }} />
                            </Tooltip>
                          ) : (
                            <Tooltip title="待导入">
                              <ClockCircleOutlined style={{ color: '#94a3b8' }} />
                            </Tooltip>
                          )}
                        </td>
                        <td>{row.nickname}</td>
                        <td className="col-account">{row.username}</td>
                        <td>{row.email || '-'}</td>
                        <td>{row.phone || '-'}</td>
                        <td>{row.department || '-'}</td>
                        <td>{row.userSource || 'local'}</td>
                        <td>{row.admin || '否'}</td>
                        <td>{row.groups || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* 更新结果 */}
              {updateResult && (
                <div className="import-existing-section">
                  <div className="import-existing-header">
                    <span className="existing-title">更新完成：成功 <strong style={{ color: 'var(--primary-color)' }}>{updateResult.updated}</strong> 个</span>
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
          <Button
            onClick={() => {
              if (importFile || importResult || importError) {
                backToImportStart();
              } else {
                resetImportDrawer();
              }
            }}
            disabled={importing}
          >
            取消
          </Button>
          {!importResult && !importError && (
            <Button
              type="primary"
              loading={importing}
              disabled={importing}
              onClick={handleImportConfirm}
            >
              导入
            </Button>
          )}
          {importError && (
            <Button type="primary" loading={importing} disabled={importing || !importFile} onClick={handleImportConfirm}>
              重试导入
            </Button>
          )}
          {importResult && (
            <Button type="primary" onClick={resetImportDrawer}>继续</Button>
          )}
        </div>
      </Drawer>

      {/* 批量修改弹窗 */}
      <Modal
        title={`批量修改用户（${selectedRowKeys.length}）`}
        open={batchEditOpen}
        onCancel={() => setBatchEditOpen(false)}
        onOk={() => {
          batchEditForm.validateFields().then(async (values) => {
            setBatchEditing(true);
            try {
              const promises: Promise<unknown>[] = [];
              if (values.group_ids) {
                promises.push(...selectedRowKeys.map((id) =>
                  usersApi.setGroups(id, values.group_ids)
                ));
              }
              if (values.is_active !== undefined) {
                promises.push(...selectedRowKeys.map((id) =>
                  usersApi.lock(id, !values.is_active)
                ));
              }
              if (values.user_source !== undefined) {
                promises.push(...selectedRowKeys.map((id) =>
                  usersApi.update(id, { user_source: values.user_source })
                ));
              }
              await Promise.all(promises);
              message.success('批量修改成功');
              setBatchEditOpen(false);
              load();
            } catch (e: any) {
              message.error(e?.response?.data?.message || '批量修改失败');
            } finally {
              setBatchEditing(false);
            }
          });
        }}
        confirmLoading={batchEditing}
        width={480}
      >
        <Form form={batchEditForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="group_ids" label="设置用户组">
            <Select
              mode="multiple"
              placeholder="选择用户组（不选则不修改）"
              options={userGroups.map((g) => ({ label: g.name, value: g.id }))}
            />
          </Form.Item>
          <Form.Item name="is_active" label="设置状态">
            <Select
              placeholder="选择状态（不选则不修改）"
              allowClear
              options={[
                { label: '启用', value: true },
                { label: '禁用', value: false },
              ]}
            />
          </Form.Item>
          <Form.Item name="user_source" label="设置用户来源">
            <Select
              placeholder="选择用户来源（不选则不修改）"
              allowClear
              options={[
                { label: '本地 (local)', value: 'local' },
                { label: '平台 (platform)', value: 'platform' },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={wecomUser ? `绑定企微账号 · ${wecomUser.username}` : '绑定企微账号'}
        open={wecomOpen}
        onCancel={() => setWecomOpen(false)}
        onOk={handleSaveWeCom}
        confirmLoading={wecomSaving}
        okText="保存"
        width={460}
      >
        <div style={{ marginBottom: 12, color: '#64748b', fontSize: 13, lineHeight: 1.7 }}>
          填写该用户在企业微信中的 <b>userid</b>（企业微信管理后台「成员」的账号 ID），
          保存后该用户即可用企业微信扫码登录到此账号。
        </div>
        <Input
          value={wecomValue}
          placeholder="例如 zhangsan"
          onChange={(e) => setWecomValue(e.target.value)}
          allowClear
          onPressEnter={handleSaveWeCom}
        />
        {wecomValue.trim() && (
          <div style={{ marginTop: 12, textAlign: 'right' }}>
            <Button danger size="small" onClick={handleUnbindWeCom}>
              解绑
            </Button>
          </div>
        )}
      </Modal>

      </Card>
    </>
  );
}
