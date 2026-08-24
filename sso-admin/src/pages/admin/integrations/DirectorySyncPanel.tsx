import { useEffect, useMemo, useState } from 'react';
import {
  App as AntdApp,
  AutoComplete,
  Button,
  Card,
  Form,
  Input,
  Modal,
  Pagination,
  Progress,
  Select,
  Space,
  Statistic,
  Switch,
  Table,
  Tag,
  Tooltip,
  Tree,
  TreeSelect,
} from 'antd';
import {
  ApiOutlined,
  ApartmentOutlined,
  EditOutlined,
  HistoryOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  SaveOutlined,
  SyncOutlined,
} from '@ant-design/icons';
import {
  directorySyncApi,
  type DepartmentMapping,
  type DirectoryDepartment,
  type DirectorySyncConfig,
  type DirectorySyncLog,
  type DirectorySyncSummary,
  type SyncPreviewDept,
  type UserImportPreview,
  type UserImportPreviewItem,
  type BufferConflictInfo,
} from '@/api/directorySync';
import { orgApi, userGroupApi, type Department, type UserGroup } from '@/api/misc';
import { cardStyle, footerStyle, SectionHead } from './_shared';

const defaultMapping: Record<string, string> = {
  external_id: 'externalId',
  username: 'userId',
  nickname: 'userName',
  email: 'email',
  given_name: 'givenName',
  surname: 'surname',
  phone: 'phone',
  position: 'position',
  department_path: 'departmentPath',
  department_paths: 'departmentPaths',
  active: 'isActive',
};

const mappingRows = [
  { key: 'external_id', label: '外部唯一 ID', required: true },
  { key: 'username', label: '登录账号来源', required: true },
  { key: 'nickname', label: '姓名' },
  { key: 'email', label: '邮箱' },
  { key: 'given_name', label: '名（given name，可选）' },
  { key: 'surname', label: '姓（surname，可选）' },
  { key: 'phone', label: '手机号' },
  { key: 'position', label: '职位' },
  { key: 'department_path', label: '主部门路径' },
  { key: 'department_paths', label: '多部门路径' },
  { key: 'active', label: '在职状态' },
];

const remoteFieldOptions = [
  'externalId',
  'userId',
  'userName',
  'name',
  'email',
  'givenName',
  'surname',
  'firstName',
  'lastName',
  'phone',
  'mobile',
  'position',
  'department',
  'departmentPath',
  'departmentPaths',
  'isActive',
  'active',
  'officeCity',
].map((v) => ({ label: v, value: v }));

function deptTreeData(list: DirectoryDepartment[]): any[] {
  return list.map((d) => ({
    title: d.name,
    value: d.path,
    key: d.path,
    children: d.children?.length ? deptTreeData(d.children) : undefined,
  }));
}

function localDeptTreeData(list: Department[]): any[] {
  return list.map((d) => ({
    title: d.name,
    value: d.id,
    key: d.id,
    children: d.children?.length ? localDeptTreeData(d.children) : undefined,
  }));
}

// 将后端返回的「选中部门 → 用户」预览树转换为 AntD Tree 数据。
function toPreviewTreeData(depts: SyncPreviewDept[]): any[] {
  return depts.map((d) => {
    const children: any[] = [];
    if (d.children?.length) {
      children.push(...toPreviewTreeData(d.children));
    }
    (d.users || []).forEach((u, idx) => {
      children.push({
        key: `${d.remote_path}::u::${u.username || idx}`,
        isLeaf: true,
        title: (
          <span>
            <span style={{ fontWeight: 500 }}>{u.name || u.username}</span>
            {u.username ? <span style={{ color: '#94a3b8', margin: '0 6px' }}>@{u.username}</span> : null}
            <Tag color={u.status === 'create' ? 'green' : 'blue'} style={{ marginInlineStart: 4 }}>
              {u.status === 'create' ? '新建' : '更新'}
            </Tag>
          </span>
        ),
      });
    });
    return {
      key: d.remote_path,
      title: (
        <span>
          <b>{d.remote_name}</b>
          <Tag style={{ marginInlineStart: 6 }}>{d.user_count} 用户</Tag>
        </span>
      ),
      children: children.length ? children : undefined,
    };
  });
}

// 待创建部门：在「部门匹配」中登记，但不立即建库；真正落库要等到立即同步且该部门下有用户时才创建。
interface PendingDept {
  key: string; // `${parent_id || 'root'}::${name}` 去重键
  id: string; // 临时 ID（pending-xxx），仅前端会话内使用
  name: string;
  parent_id?: string;
}

// 把「待创建部门」合并进本地部门树，供匹配下拉展示与选择（不调用后端，不真正建库）。
function mergePendingDepts(list: Department[], pending: Record<string, PendingDept>): any[] {
  const byParent: Record<string, PendingDept[]> = {};
  Object.values(pending).forEach((p) => {
    const pk = p.parent_id || '';
    (byParent[pk] = byParent[pk] || []).push(p);
  });
  const build = (arr: Department[]): any[] =>
    arr.map((d) => {
      const kids = d.children?.length ? build(d.children) : [];
      const pend = (byParent[d.id] || []).map((p) => ({
        title: `🆕 ${p.name}（待创建）`,
        value: p.id,
        key: p.id,
      }));
      const children = [...kids, ...pend];
      return {
        title: d.name,
        value: d.id,
        key: d.id,
        children: children.length ? children : undefined,
      };
    });
  const roots = build(list);
  const rootPend = (byParent[''] || []).map((p) => ({
    title: `🆕 ${p.name}（待创建）`,
    value: p.id,
    key: p.id,
  }));
  return [...roots, ...rootPend];
}

function emptyConfig(): DirectorySyncConfig {
  return {
    enabled: false,
    platform_type: 'wecom_attendance',
    base_url: '',
    api_key: '',
    selected_department_paths: [],
    strip_prefix: '',
    mount_department_id: '',
    deactivate_missing: true,
    username_strategy: 'smart_pinyin',
    email_strategy: '',
    email_domain: '',
    field_mapping: defaultMapping,
    mapping_mode: false,
    department_mappings: [],
    default_group_ids: [],
  };
}

function flattenRemoteDepts(
  list: DirectoryDepartment[],
  depth = 0,
): { path: string; name: string; external_id: string; depth: number }[] {
  const out: { path: string; name: string; external_id: string; depth: number }[] = [];
  list.forEach((d) => {
    out.push({ path: d.path, name: d.name, external_id: d.external_id || d.id, depth });
    if (d.children?.length) {
      out.push(...flattenRemoteDepts(d.children, depth + 1));
    }
  });
  return out;
}

// 按名称（忽略大小写/空格）在本地部门树中查找同名部门，返回其 ID；找不到返回空串。
function findLocalDeptByName(list: Department[], name: string): string {
  const target = name.trim().toLowerCase();
  const search = (arr: Department[]): string => {
    for (const d of arr) {
      if ((d.name || '').trim().toLowerCase() === target) {
        return d.id;
      }
      if (d.children?.length) {
        const r = search(d.children);
        if (r) return r;
      }
    }
    return '';
  };
  return search(list);
}

// 连接配置相关字段，单独保存 / 测试时只校验这些
const CONNECTION_FIELDS = [
  'enabled',
  'platform_type',
  'base_url',
  'api_key',
  'deactivate_missing',
  'username_strategy',
  'email_strategy',
  'email_domain',
];

export default function DirectorySyncPanel() {
  const { message, modal } = AntdApp.useApp();
  const [form] = Form.useForm<DirectorySyncConfig>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingConn, setSavingConn] = useState(false);
  const [testing, setTesting] = useState(false);
  const [loadingRemote, setLoadingRemote] = useState(false);
  const [syncing, setSyncing] = useState<'preview' | 'run' | 'import' | 'sync' | null>(null);
  const [remoteDepartments, setRemoteDepartments] = useState<DirectoryDepartment[]>([]);
  const [localDepartments, setLocalDepartments] = useState<Department[]>([]);
  const [userGroups, setUserGroups] = useState<UserGroup[]>([]);
  const [summary, setSummary] = useState<DirectorySyncSummary | null>(null);
  const [importPreview, setImportPreview] = useState<UserImportPreview | null>(null);
  const [importKeyword, setImportKeyword] = useState('');
  const [importPage, setImportPage] = useState(1);
  const [importPageSize, setImportPageSize] = useState(15);
  const [importLoading, setImportLoading] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);
  const [importGroupIds, setImportGroupIds] = useState<string[]>([]);
  // 默认用户组：独立状态驱动下拉显示，保证重开弹窗不回退（与 form.default_group_ids 双向同步）
  const [defaultGroupIds, setDefaultGroupIds] = useState<string[]>([]);
  // 用户名/邮箱行内编辑态
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editField, setEditField] = useState<'username' | 'email'>('username');
  const [editValue, setEditValue] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  // 用户名/邮箱冲突处理态（关联/重命名/取消）
  const [conflictOpen, setConflictOpen] = useState(false);
  const [conflictRecord, setConflictRecord] = useState<UserImportPreviewItem | null>(null);
  const [conflictField, setConflictField] = useState<'username' | 'email'>('username');
  const [conflictInfo, setConflictInfo] = useState<BufferConflictInfo | null>(null);
  const [conflictSaving, setConflictSaving] = useState(false);
  const [logs, setLogs] = useState<DirectorySyncLog[]>([]);
  const [mappingOpen, setMappingOpen] = useState(false);
  const [logsOpen, setLogsOpen] = useState(false);
  const [matchOpen, setMatchOpen] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  // 新建本地部门（用于映射时本地不存在对应部门）
  const [createOpen, setCreateOpen] = useState(false);
  const [createForPath, setCreateForPath] = useState<string | null>(null);
  const [createName, setCreateName] = useState('');
  const [createParent, setCreateParent] = useState<string | undefined>(undefined);
  const [creating, setCreating] = useState(false);
  const [createSearch, setCreateSearch] = useState(''); // 下拉框搜索词，作为新建默认值
  // 部门匹配（手动映射模式）状态，单独保存，避免与表单字段耦合
  const [mappingMode, setMappingMode] = useState(false);
  const [departmentMappings, setDepartmentMappings] = useState<DepartmentMapping[]>([]);
  const [mappingDraft, setMappingDraft] = useState<Record<string, { include: boolean; local_id: string }>>({});
  // 待创建部门（仅登记，不立即建库；立即同步且有用户时才真正创建）
  const [pendingDepts, setPendingDepts] = useState<Record<string, PendingDept>>({});

  const platformType = Form.useWatch('platform_type', form);
  const localTree = useMemo(() => localDeptTreeData(localDepartments), [localDepartments]);
  // 合并待创建部门后的下拉树，供「映射到本地部门」选择
  const combinedLocalTree = useMemo(
    () => mergePendingDepts(localDepartments, pendingDepts),
    [localDepartments, pendingDepts],
  );
  const matchedCount = useMemo(
    () =>
      departmentMappings.filter(
        (m) => m.include && (m.local_department_id || (m.create_local && m.new_dept_name)),
      ).length,
    [departmentMappings],
  );

  const load = async () => {
    setLoading(true);
    try {
      const [cfg, depts, syncLogs, groups] = await Promise.all([
        directorySyncApi.config(),
        orgApi.tree(),
        directorySyncApi.logs(),
        userGroupApi.list(),
      ]);
      // 用户组按 sort_order、名称排序，保证「默认一个用户组」取的是稳定且合理的第一组
      const sortedGroups = [...groups].sort(
        (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name),
      );
      setUserGroups(sortedGroups);
      // 未配置默认用户组时，自动默认选中第一个用户组，免去手动选择
      const resolvedDefaultGroupIds =
        cfg.default_group_ids && cfg.default_group_ids.length > 0
          ? cfg.default_group_ids
          : sortedGroups.length > 0
            ? [sortedGroups[0].id]
            : [];
      setDefaultGroupIds(resolvedDefaultGroupIds);
      form.setFieldsValue({
        ...emptyConfig(),
        ...cfg,
        api_key: '',
        api_key_set: !!cfg.api_key_set,
        field_mapping: { ...defaultMapping, ...cfg.field_mapping },
        default_group_ids: resolvedDefaultGroupIds,
      });
      setLocalDepartments(depts);
      setLogs(syncLogs);
      setMappingMode(!!cfg.mapping_mode);
      setDepartmentMappings(cfg.department_mappings || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const buildSavePayload = (values: DirectorySyncConfig): DirectorySyncConfig => {
    const payload: DirectorySyncConfig = {
      ...emptyConfig(),
      ...values,
      api_key_set: undefined,
      selected_department_paths: values.selected_department_paths || [],
      field_mapping: { ...defaultMapping, ...(values.field_mapping || {}) },
    };
    return payload;
  };

  // 通用保存：校验指定字段（缺省则校验全表单），并补齐其他字段避免误清空
  const saveConfig = async (fields?: string[], silent = false) => {
    const values = await form.validateFields(fields);
    // 无论指定字段还是完整保存，都先合并 form.getFieldsValue(true)——
    // 保证 default_group_ids 等未绑定 Form.Item、仅由 setFieldsValue 维护的字段，
    // 在完整保存(fields=undefined)时也能进入 payload，避免被空值冲掉后端配置。
    const allValues: DirectorySyncConfig = {
      ...(form.getFieldsValue(true) as DirectorySyncConfig),
      ...(values as DirectorySyncConfig),
    };
    setSaving(true);
    try {
      const payload = buildSavePayload(allValues);
      payload.mapping_mode = mappingMode;
      payload.department_mappings = departmentMappings;
      const saved = await directorySyncApi.saveConfig(payload);
      form.setFieldsValue({
        ...saved,
        api_key: '',
        field_mapping: { ...defaultMapping, ...saved.field_mapping },
      });
      setDefaultGroupIds(saved.default_group_ids || []);
      if (!silent) message.success('已保存');
    } finally {
      setSaving(false);
    }
  };

  // 连接配置区：只保存连接相关字段
  const saveConnection = async () => {
    setSavingConn(true);
    try {
      await saveConfig(CONNECTION_FIELDS);
    } finally {
      setSavingConn(false);
    }
  };

  // 测试连接：先保存，再拉一次部门检验连通性
  const testConnection = async () => {
    setTesting(true);
    try {
      await saveConfig(CONNECTION_FIELDS);
      const depts = await directorySyncApi.departments();
      const count = Array.isArray(depts) ? depts.length : 0;
      message.success(`连接成功，已读取到 ${count} 个顶级部门`);
    } catch (e: any) {
      message.error(e?.message || '连接测试失败，请检查 CorpID / Secret 是否正确');
    } finally {
      setTesting(false);
    }
  };

  const loadRemoteDepartments = async () => {
    // 拉取部门时不能要求「同步部门」已选，只校验连接相关字段
    setLoadingRemote(true);
    try {
      await saveConfig(CONNECTION_FIELDS);
      const depts = await directorySyncApi.departments();
      setRemoteDepartments(depts);
      message.success('已拉取部门');
    } catch (e: any) {
      message.error(e?.message || '拉取远端部门失败');
    } finally {
      setLoadingRemote(false);
    }
  };

  // 用户导入：一次性拉取全部待同步用户（后端按页返回，这里循环取完），仅分析不修改数据库。
  // 拉回后翻页与搜索均在本地完成，不再请求后端。
  const loadImportPreview = async () => {
    setImportLoading(true);
    setImportProgress(0);
    setSelectedRowKeys([]);
    try {
      // 静默保存当前表单配置（不弹"已保存"，避免与导入动作混淆），使预览反映最新选择
      await saveConfig(undefined, true);
      const progressTimer = setInterval(() => {
        setImportProgress((p) => {
          if (p >= 90) return p;
          return p + 10;
        });
      }, 300);
      // 循环拉取所有页，拼接成完整列表
      const all: UserImportPreviewItem[] = [];
      const seen = new Set<string>();
      let total = 0;
      let syncAt = '';
      let p = 1;
      do {
        const r = await directorySyncApi.userImportPreview({ page: p, page_size: 200 });
        if (p === 1) {
          total = r.total;
          syncAt = r.sync_at;
        }
        if (r.users.length === 0) break; // 防止 total 与实际不符时的死循环
        for (const u of r.users) {
          if (!u.external_id || seen.has(u.external_id)) continue;
          seen.add(u.external_id);
          all.push(u);
        }
        p++;
      } while (all.length < total && total > 0);
      clearInterval(progressTimer);
      setImportProgress(100);
      setImportPreview({
        sync_at: syncAt,
        progress: 100,
        total: all.length,
        page: 1,
        page_size: importPageSize,
        users: all,
      });
      setImportPage(1);
      setImportKeyword('');
      setImportOpen(true);
    } catch (e: any) {
      message.error(e?.message || '加载用户导入预览失败');
    } finally {
      setImportLoading(false);
    }
  };

  const doPreview = async () => {
    await loadImportPreview();
  };

  // 本地过滤 + 本地分页：全部用户已在 loadImportPreview 中拉回，翻页/搜索不再请求后端
  const filteredImportItems = useMemo(() => {
    const kw = importKeyword.trim().toLowerCase();
    if (!kw) return importPreview?.users || [];
    return (importPreview?.users || []).filter(
      (it) =>
        it.username.toLowerCase().includes(kw) ||
        it.name.toLowerCase().includes(kw) ||
        (it.email || '').toLowerCase().includes(kw) ||
        it.external_id.toLowerCase().includes(kw) ||
        (it.source_username || '').toLowerCase().includes(kw),
    );
  }, [importPreview, importKeyword]);

  const importPageItems = useMemo(() => {
    const start = (importPage - 1) * importPageSize;
    return filteredImportItems.slice(start, start + importPageSize);
  }, [filteredImportItems, importPage, importPageSize]);

  const doRun = async () => {
    await saveConfig();
    modal.confirm({
      title: '确认执行通讯录同步？',
      content: '同步会创建或更新部门与用户，并按配置禁用远端缺失的已同步用户。',
      okText: '执行同步',
      onOk: async () => {
        setSyncing('run');
        try {
          const r = await directorySyncApi.run();
          setSummary(r);
          setSummaryOpen(true);
          setLogs(await directorySyncApi.logs());
          message.success('同步完成');
        } finally {
          setSyncing(null);
        }
      },
    });
  };

  // 用户导入：按勾选的 external_id 列表导入；空数组表示导入全部待同步用户。
  const doImportUsers = async (ids: string[]) => {
    modal.confirm({
      title: ids.length === 0 ? '确认导入全部待同步用户？' : `确认导入选中的 ${ids.length} 位用户？`,
      content: '将创建或更新这些用户并按其部门匹配落库；未勾选的用户不会被处理、也不会被禁用。',
      okText: '导入',
      onOk: async () => {
        setSyncing('import');
        try {
          const groupIds = defaultGroupIds;
          const r = await directorySyncApi.importUsers({ external_ids: ids, group_ids: groupIds });
          setSummary(r);
          setSummaryOpen(true);
          setLogs(await directorySyncApi.logs());
          setImportOpen(false);
          setSelectedRowKeys([]);
          message.success('导入完成');
        } finally {
          setSyncing(null);
        }
      },
    });
  };

  // 行内编辑用户名/邮箱：写回缓冲表（含 edited 标记），pull 重建时保留编辑值。
  // 若与已存在用户冲突，则弹出选择框（关联 / 重命名 / 取消），不静默加后缀。
  const saveEdit = async (record: UserImportPreviewItem) => {
    const val = editValue.trim();
    const field = editField;
    const label = field === 'email' ? '邮箱' : '用户名';
    if (!val) {
      message.warning(`${label}不能为空`);
      return;
    }
    setEditSaving(true);
    try {
      const result = await directorySyncApi.editField(record.external_id, field, val);
      setEditingKey(null);
      if (result.conflict) {
        setConflictRecord(record);
        setConflictField(field);
        setConflictInfo(result.conflict);
        setConflictOpen(true);
        return;
      }
      const newValue = field === 'email' ? result.email : result.username;
      setImportPreview((prev) =>
        prev
          ? {
              ...prev,
              users: prev.users.map((u) =>
                u.external_id === record.external_id
                  ? { ...u, [field]: newValue }
                  : u,
              ),
            }
          : prev,
      );
      if (newValue && newValue.toLowerCase() !== val.toLowerCase()) {
        message.warning(`${label}「${val}」不可用，已自动调整为「${newValue}」`);
      } else {
        message.success(`已修改${label}`);
      }
    } catch (e: any) {
      message.error(e?.message || `修改${label}失败`);
    } finally {
      setEditSaving(false);
    }
  };

  // 冲突处理：link=关联到已有用户（建立绑定，导入时更新而非新建）；rename=重命名加序号。
  const doResolveConflict = async (action: 'link' | 'rename') => {
    if (!conflictRecord || !conflictInfo) return;
    const field = conflictField;
    setConflictSaving(true);
    try {
      const res = await directorySyncApi.resolveConflict({
        external_id: conflictRecord.external_id,
        field,
        action,
        conflict_user_id: conflictInfo.user_id,
        username: field === 'username' ? conflictInfo.username : undefined,
      });
      const finalValue = field === 'email' ? res.email : res.username;
      setImportPreview((prev) =>
        prev
          ? {
              ...prev,
              users: prev.users.map((u) =>
                u.external_id === conflictRecord.external_id
                  ? { ...u, [field]: finalValue, exists: action === 'link' ? true : u.exists }
                  : u,
              ),
            }
          : prev,
      );
      setConflictOpen(false);
      setConflictRecord(null);
      setConflictInfo(null);
      if (action === 'link') {
        message.success('已关联到已有用户：导入时将更新该用户，不再新建');
      } else {
        message.success(`已重命名为「${finalValue}」`);
      }
    } catch (e: any) {
      message.error(e?.message || '处理失败');
    } finally {
      setConflictSaving(false);
    }
  };

  const closeConflict = () => {
    setConflictOpen(false);
    setConflictRecord(null);
    setConflictInfo(null);
  };

  const saveMapping = async () => {
    await saveConfig([...CONNECTION_FIELDS, 'field_mapping']);
    setMappingOpen(false);
  };

  // 同步用户（仅拉取）：拉取远端通讯录 → 写入缓冲表 → 刷新下方预览；不创建/修改/禁用任何用户。
  // 真正建号由「导入选中/导入全部」负责（区别于「用户导入」按钮本身，它只读缓冲表、不触发同步）。
  const doSyncUsers = async () => {
    modal.confirm({
      title: '仅拉取同步数据？',
      content:
        '将拉取远端通讯录并写入缓冲表、刷新下方可导入的通讯录列表（仅同步数据，不创建/修改/禁用任何用户）。如需创建用户，请在列表中选择后点击「导入选中」或「导入全部」。',
      okText: '同步用户',
      onOk: async () => {
        setSyncing('sync');
        try {
          await directorySyncApi.pull();
          // 同步用户仅拉取，不弹结果汇总窗（汇总留给「导入选中/导入全部」触发）
          setLogs(await directorySyncApi.logs());
          message.success('拉取完成，已刷新可导入的通讯录');
          // 拉取后刷新弹窗里的缓冲预览，展示本次结果
          await loadImportPreview();
        } catch (e: any) {
          message.error(e?.message || '拉取失败');
        } finally {
          setSyncing(null);
        }
      },
    });
  };

  const openMatchModal = () => {
    const draft: Record<string, { include: boolean; local_id: string }> = {};
    const pending: Record<string, PendingDept> = {};
    const prev = new Map(departmentMappings.map((m) => [m.remote_path, m]));
    // 同一 (名, 上级) 的待创建部门去重为同一临时 ID，便于父子远端部门共用
    const ensurePending = (name: string, parent?: string): string => {
      const key = `${parent || 'root'}::${name}`;
      if (pending[key]) return pending[key].id;
      const id = `pending-${Math.random().toString(36).slice(2, 10)}`;
      pending[key] = { key, id, name, parent_id: parent };
      return id;
    };
    flattenRemoteDepts(remoteDepartments).forEach((d) => {
      const existing = prev.get(d.path);
      if (existing && existing.create_local && existing.new_dept_name) {
        // 已登记的待创建部门：重建为下拉可选项
        const pid = ensurePending(existing.new_dept_name, existing.new_dept_parent_id || undefined);
        draft[d.path] = { include: existing.include, local_id: pid };
      } else if (existing) {
        draft[d.path] = { include: existing.include, local_id: existing.local_department_id };
      } else {
        const guess = findLocalDeptByName(localDepartments, d.name);
        draft[d.path] = { include: !!guess, local_id: guess };
      }
    });
    setPendingDepts(pending);
    setMappingDraft(draft);
    // 默认展开第一级，避免全部展开太乱；其余由用户自行点开
    setExpandedPaths(new Set(remoteDepartments.map((d) => d.path)));
    setMatchOpen(true);
  };

  const saveMatchModal = async () => {
    const all: DepartmentMapping[] = flattenRemoteDepts(remoteDepartments).map((d) => {
      const row = mappingDraft[d.path] || { include: false, local_id: '' };
      const include = !!row.include && !!row.local_id;
      const base: DepartmentMapping = {
        remote_external_id: d.external_id,
        remote_path: d.path,
        remote_name: d.name,
        local_department_id: row.local_id || '',
        include,
      };
      // 映射到「待创建部门」：序列化为 create_local，真正建库推迟到立即同步且有用户时
      if (row.local_id && row.local_id.startsWith('pending-')) {
        const pd = Object.values(pendingDepts).find((p) => p.id === row.local_id);
        if (pd) {
          return {
            ...base,
            local_department_id: '',
            create_local: true,
            new_dept_name: pd.name,
            new_dept_parent_id: pd.parent_id || '',
          };
        }
      }
      return base;
    });
    setSaving(true);
    try {
      const values = form.getFieldsValue(true) as DirectorySyncConfig;
      const payload = buildSavePayload(values);
      payload.mapping_mode = true;
      payload.department_mappings = all;
      const saved = await directorySyncApi.saveConfig(payload);
      form.setFieldsValue({
        ...saved,
        api_key: '',
        field_mapping: { ...defaultMapping, ...saved.field_mapping },
      });
      setDefaultGroupIds(saved.default_group_ids || []);
      setMappingMode(true);
      setDepartmentMappings(saved.department_mappings || all);
      message.success('已保存部门匹配');
      setMatchOpen(false);
    } catch (e: any) {
      message.error(e?.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  // 部门匹配弹窗：远端部门树相关
  const allRemoteFlat = useMemo(() => flattenRemoteDepts(remoteDepartments), [remoteDepartments]);

  const toggleExpand = (path: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const setDraftBatch = (updates: Record<string, Partial<{ include: boolean; local_id: string }>>) => {
    setMappingDraft((prev) => {
      const next = { ...prev };
      for (const [path, patch] of Object.entries(updates)) {
        next[path] = { ...(prev[path] || { include: false, local_id: '' }), ...patch };
      }
      return next;
    });
  };

  const descendantPaths = (parentPath: string) =>
    allRemoteFlat.filter((d) => d.path !== parentPath && d.path.startsWith(parentPath + '/')).map((d) => d.path);

  const handleIncludeChange = (path: string, include: boolean) => {
    const selfLocal = mappingDraft[path]?.local_id || '';
    const updates: Record<string, Partial<{ include: boolean; local_id: string }>> = {};
    updates[path] = { include };
    for (const childPath of descendantPaths(path)) {
      const child = mappingDraft[childPath] || { include: false, local_id: '' };
      updates[childPath] = {
        include,
        local_id: include ? (selfLocal || child.local_id) : child.local_id,
      };
    }
    setDraftBatch(updates);
  };

  const handleLocalChange = (path: string, local_id: string) => {
    const updates: Record<string, Partial<{ include: boolean; local_id: string }>> = {};
    updates[path] = { local_id };
    for (const childPath of descendantPaths(path)) {
      const child = mappingDraft[childPath] || { include: false, local_id: '' };
      if (child.include) {
        updates[childPath] = { local_id };
      }
    }
    setDraftBatch(updates);
  };

  const renderRemoteTree = (nodes: DirectoryDepartment[], depth = 0) => {
    return nodes.map((d) => {
      const row = mappingDraft[d.path] || { include: false, local_id: '' };
      const hasChildren = !!d.children?.length;
      const expanded = expandedPaths.has(d.path);
      return (
        <div key={d.path}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '10px 12px',
              borderBottom: '1px solid #f5f5f5',
              paddingLeft: 12 + depth * 18,
            }}
          >
            <div
              style={{
                width: 18,
                flex: '0 0 auto',
                cursor: hasChildren ? 'pointer' : 'default',
                color: hasChildren ? '#64748b' : 'transparent',
                textAlign: 'center',
                fontSize: 12,
              }}
              onClick={() => hasChildren && toggleExpand(d.path)}
            >
              {hasChildren ? (expanded ? '▼' : '▶') : ''}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {d.name}
              </div>
              <div style={{ fontSize: 12, color: '#94a3b8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {d.path}
              </div>
            </div>
            <Switch
              checked={row.include}
              size="small"
              onChange={(v) => handleIncludeChange(d.path, v)}
            />
            <TreeSelect
              style={{ width: 240, flex: '0 0 auto' }}
              allowClear
              showSearch
              treeNodeFilterProp="title"
              placeholder="映射到本地部门（下拉底部可新建）"
              treeData={combinedLocalTree}
              value={row.local_id || undefined}
              disabled={!row.include}
              onSearch={(v) => setCreateSearch(v)}
              onChange={(v) => handleLocalChange(d.path, v || '')}
              dropdownRender={(menu) => (
                <>
                  {menu}
                  <div
                    style={{
                      borderTop: '1px solid #f0f0f0',
                      padding: '8px 12px',
                      color: '#1677ff',
                      cursor: 'pointer',
                      fontSize: 13,
                    }}
                    onClick={() => openCreate(d.path)}
                  >
                    ＋ 新建本地部门…
                  </div>
                </>
              )}
            />
          </div>
          {hasChildren && expanded && renderRemoteTree(d.children!, depth + 1)}
        </div>
      );
    });
  };

  const reloadLocalDepts = async () => {
    try {
      const depts = await orgApi.tree();
      setLocalDepartments(depts);
    } catch {
      /* 忽略：不影响匹配弹窗其余功能 */
    }
  };

  const openCreate = (path: string) => {
    const node = allRemoteFlat.find((d) => d.path === path);
    setCreateForPath(path);
    setCreateName(createSearch.trim() || node?.name || '');
    setCreateParent(undefined);
    setCreateSearch('');
    setCreateOpen(true);
  };

  const doCreateDepartment = async () => {
    if (!createForPath) return;
    const name = createName.trim();
    if (!name) {
      message.warning('请输入部门名称');
      return;
    }
    setCreating(true);
    try {
      // 不直接创建：登记为「待创建部门」，真正建库推迟到立即同步且该部门下有用户时
      const parent = createParent || undefined;
      const key = `${parent || 'root'}::${name}`;
      let pd = pendingDepts[key];
      if (!pd) {
        pd = { key, id: `pending-${Math.random().toString(36).slice(2, 10)}`, name, parent_id: parent };
        setPendingDepts((prev) => ({ ...prev, [key]: pd! }));
      }
      setMappingDraft((prev) => {
        const next = { ...prev };
        next[createForPath] = { include: true, local_id: pd!.id };
        for (const childPath of descendantPaths(createForPath)) {
          const child = next[childPath] || { include: false, local_id: '' };
          if (child.include) next[childPath] = { ...child, local_id: pd!.id };
        }
        return next;
      });
      message.success(`已登记待创建部门「${name}」：立即同步且该部门下有用户时才会真正创建`);
      setCreateOpen(false);
    } catch (e: any) {
      message.error(e?.message || '操作失败');
    } finally {
      setCreating(false);
    }
  };

  if (loading) {
    return <Card><div style={{ minHeight: 360 }} /></Card>;
  }

  return (
    <Form form={form} layout="vertical" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* 连接配置 */}
      <div style={cardStyle}>
        <SectionHead title="连接配置" />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', columnGap: 32 }}>
          <Form.Item label="启用同步" name="enabled" valuePropName="checked">
            <Switch checkedChildren="启用" unCheckedChildren="禁用" />
          </Form.Item>
          <Form.Item
            label="平台类型"
            name="platform_type"
            tooltip="选择「企业微信通讯录」可直接使用企业微信配置同步通讯录，无需填写第三方平台地址与 API Key；「考勤系统 (Attendance 桥接)」需配置第三方平台地址与 API Key。"
          >
            <Select
              options={[
                { label: '企业微信通讯录', value: 'wecom' },
                { label: '考勤系统 (Attendance 桥接)', value: 'wecom_attendance' },
              ]}
            />
          </Form.Item>
          {platformType !== 'wecom' && (
            <Form.Item label="第三方平台地址" name="base_url" rules={[{ required: true, message: '请输入第三方平台地址' }]}>
              <Input placeholder="https://north-maxkb2.fit2cloud.cn:8666/attendance" />
            </Form.Item>
          )}
          {platformType !== 'wecom' && (
            <Form.Item
              label="API Key"
              name="api_key"
              rules={[({ getFieldValue: gfv }) => ({
                required: gfv('platform_type') === 'wecom_attendance' && !gfv('api_key_set'),
                message: '请填写 API Key（首次配置必填）',
              })]}
            >
              <Input.Password visibilityToggle={false} placeholder="从第三方平台复制填入；修改时填写新值，否则留空" autoComplete="new-password" />
            </Form.Item>
          )}
          <Form.Item label="用户名策略" name="username_strategy">
            <Select
              options={[
                { label: '智能生成：大小写转小写，数字 ID 转姓名拼音', value: 'smart_pinyin' },
                { label: '始终使用姓名拼音', value: 'pinyin' },
                { label: '使用来源账号小写', value: 'source_lower' },
              ]}
            />
          </Form.Item>
          <Form.Item
            label="邮箱策略"
            name="email_strategy"
            tooltip="填写邮箱的后缀生成规则；配合下方邮件后缀使用。"
            extra="企业微信新版本，用户手机号、邮箱等敏感字段默认不会在同步结果中返回，所以无法获取到用户名，需手动设置策略进行调整。"
          >
            <Select
              options={[
                { label: '跟随远端邮箱（默认，不生成）', value: '' },
                { label: '名字.姓氏@域名', value: 'given_surname' },
                { label: '姓名@域名', value: 'fullname' },
              ]}
            />
          </Form.Item>
        </div>
        <div style={{ marginTop: 12, display: 'flex', alignItems: 'flex-start', gap: 32, flexWrap: 'wrap' }}>
          <Form.Item
            label="邮件后缀"
            name="email_domain"
            style={{ marginBottom: 0, width: 'calc((100% - 32px) / 2)' }}
            tooltip="配合上方邮箱策略使用，例如 oneauth.com。远端无邮箱的用户将按策略生成 本地名@该后缀 的邮箱。"
            rules={[({ getFieldValue: gfv }) => ({
              required: gfv('email_strategy') !== '' && !gfv('email_domain'),
              message: '启用邮箱策略后请填写邮件后缀',
            })]}
          >
            <Input placeholder="oneauth.com" style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item
            label="远端缺失用户"
            name="deactivate_missing"
            valuePropName="checked"
            style={{ marginBottom: 0 }}
          >
            <Switch checkedChildren="自动禁用" unCheckedChildren="保留" />
          </Form.Item>
          <Form.Item
            label="手动部门匹配"
            tooltip="开启后，同步不再自动创建部门，也不会修改你已有的本地部门；改为由你手动把远端部门一对一映射到本地部门，仅同步已勾选的部门。"
            style={{ marginBottom: 0 }}
          >
            <Switch
              checked={mappingMode}
              checkedChildren="已开启（不自动建部门）"
              unCheckedChildren="关闭（按路径自动建部门）"
              onChange={(v) => setMappingMode(v)}
            />
          </Form.Item>
        </div>
        <Space style={{ marginTop: 12 }} wrap>
          <Button type="primary" ghost loading={savingConn} onClick={saveConnection}>
            保存连接
          </Button>
          <Button icon={<ApiOutlined />} loading={testing} onClick={testConnection}>
            测试连接
          </Button>
          <Button icon={<ApartmentOutlined />} loading={loadingRemote} onClick={loadRemoteDepartments}>
            拉取远端部门
          </Button>
        </Space>
      </div>

      <Modal
        title="用户导入"
        open={importOpen && !!importPreview}
        width={900}
        footer={
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Space>
              <Button type="primary" icon={<SyncOutlined />} loading={syncing === 'sync'} onClick={doSyncUsers}>
                同步用户
              </Button>
              <span style={{ fontSize: 13, color: '#475569', whiteSpace: 'nowrap' }}>默认用户组：</span>
              <Select
                mode="multiple"
                allowClear
                placeholder={userGroups.length ? '选择用户组' : '暂无用户组'}
                options={userGroups.map((g) => ({ label: g.name, value: g.id }))}
                showSearch
                optionFilterProp="label"
                value={defaultGroupIds}
                onChange={async (v) => {
                  setDefaultGroupIds(v);
                  form.setFieldsValue({ default_group_ids: v });
                  await saveConfig(['default_group_ids'], true);
                }}
                style={{ width: 280 }}
              />
            </Space>
            <Space>
              <Button onClick={() => setImportOpen(false)}>取消</Button>
              <Button
                disabled={selectedRowKeys.length === 0}
                loading={syncing === 'import'}
                onClick={() => doImportUsers(selectedRowKeys)}
              >
                导入选中（{selectedRowKeys.length}）
              </Button>
              <Button
                type="primary"
                loading={syncing === 'import'}
                onClick={() => doImportUsers([])}
              >
                导入全部
              </Button>
            </Space>
          </div>
        }
        onCancel={() => setImportOpen(false)}
      >
        {importPreview && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <div style={{ fontSize: 13, color: '#475569' }}>
                同步时间：<b>{importPreview.sync_at || '—'}</b>，共 <b>{importPreview.total}</b> 位用户待导入
                <span style={{ color: '#64748b', marginLeft: 12 }}>已选 {selectedRowKeys.length} 位</span>
                {importPreview.total === 0 && (
                  <span style={{ color: '#94a3b8', marginLeft: 8 }}>
                    （尚无缓冲数据，请先点击左上角「同步用户」拉取远端通讯录）
                  </span>
                )}
              </div>
              <Input.Search
                placeholder="搜索用户名 / 姓名 / 邮箱"
                allowClear
                value={importKeyword}
                onChange={(e) => {
                  setImportKeyword(e.target.value);
                  setImportPage(1);
                }}
                onSearch={(v) => {
                  setImportKeyword(v);
                  setImportPage(1);
                }}
                style={{ width: 260 }}
              />
            </div>
            {importLoading && importProgress < 100 && (
              <div style={{ marginBottom: 12 }}>
                <Progress percent={importProgress} status="active" showInfo={false} />
                <div style={{ fontSize: 12, color: '#94a3b8', textAlign: 'center' }}>正在从远端拉取用户…</div>
              </div>
            )}
            <Table
              rowKey="external_id"
              loading={importLoading}
              dataSource={importPageItems}
              pagination={false}
              scroll={{ y: 380 }}
              rowSelection={{
                selectedRowKeys,
                onChange: (keys) => setSelectedRowKeys(keys as string[]),
                preserveSelectedRowKeys: true,
              }}
              columns={[
                {
                  title: '用户名',
                  dataIndex: 'username',
                  width: 160,
                  render: (v: string, record: UserImportPreviewItem) => {
                    if (editingKey === record.external_id && editField === 'username') {
                      return (
                        <Input
                          size="small"
                          autoFocus
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onPressEnter={() => saveEdit(record)}
                          style={{ width: 150 }}
                          suffix={
                            <Space size={4} style={{ color: '#94a3b8' }}>
                              <Button type="link" size="small" loading={editSaving} onClick={() => saveEdit(record)}>
                                保存
                              </Button>
                              <Button type="link" size="small" onClick={() => setEditingKey(null)}>
                                取消
                              </Button>
                            </Space>
                          }
                        />
                      );
                    }
                    return (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, maxWidth: '100%' }}>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {v || '-'}
                        </span>
                        <Button
                          type="text"
                          size="small"
                          icon={<EditOutlined />}
                          onClick={() => {
                            setEditingKey(record.external_id);
                            setEditField('username');
                            setEditValue(v);
                          }}
                        />
                      </span>
                    );
                  },
                },
                { title: '名称', dataIndex: 'name', width: 120, ellipsis: true },
                {
                  title: '源用户名',
                  dataIndex: 'source_username',
                  width: 150,
                  ellipsis: true,
                  render: (v: string) => (
                    <Tooltip title={v ? `第三方平台原始账号：${v}` : undefined}>
                      <span style={{ fontSize: 12, color: '#64748b' }}>{v || '-'}</span>
                    </Tooltip>
                  ),
                },
                {
                  title: '邮箱',
                  dataIndex: 'email',
                  width: 180,
                  render: (v: string, record: UserImportPreviewItem) => {
                    if (editingKey === record.external_id && editField === 'email') {
                      return (
                        <Input
                          size="small"
                          autoFocus
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onPressEnter={() => saveEdit(record)}
                          style={{ width: 170 }}
                          suffix={
                            <Space size={4} style={{ color: '#94a3b8' }}>
                              <Button type="link" size="small" loading={editSaving} onClick={() => saveEdit(record)}>
                                保存
                              </Button>
                              <Button type="link" size="small" onClick={() => setEditingKey(null)}>
                                取消
                              </Button>
                            </Space>
                          }
                        />
                      );
                    }
                    return (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, maxWidth: '100%' }}>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {v || '-'}
                        </span>
                        <Button
                          type="text"
                          size="small"
                          icon={<EditOutlined />}
                          onClick={() => {
                            setEditingKey(record.external_id);
                            setEditField('email');
                            setEditValue(v);
                          }}
                        />
                      </span>
                    );
                  },
                },
                {
                  title: '部门（落库）',
                  dataIndex: 'department',
                  width: 140,
                  ellipsis: true,
                  render: (dept: string, record: any) => {
                    const src = (record.groups || []).join('、');
                    const text = dept || '-';
                    return (
                      <Tooltip title={src ? `源部门：${src}` : undefined}>
                        <span style={{ fontSize: 12, color: '#475569' }}>{text}</span>
                      </Tooltip>
                    );
                  },
                },
                {
                  title: '已存在',
                  dataIndex: 'exists',
                  width: 90,
                  render: (v) => (v ? <Tag color="success">是</Tag> : <Tag>否</Tag>),
                },
              ]}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
              <Pagination
                current={importPage}
                pageSize={importPageSize}
                total={filteredImportItems.length}
                showSizeChanger
                pageSizeOptions={[10, 15, 30, 50]}
                onChange={(p, ps) => {
                  setImportPage(p);
                  if (ps !== importPageSize) setImportPageSize(ps);
                }}
              />
            </div>
          </>
        )}
      </Modal>

      <Modal
        title={summary?.dry_run ? '预览结果' : '同步结果'}
        open={summaryOpen && !!summary}
        width={680}
        footer={[
          <Button key="close" onClick={() => setSummaryOpen(false)}>
            关闭
          </Button>,
        ]}
        onCancel={() => setSummaryOpen(false)}
      >
        {summary && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 16 }}>
              <Statistic title="新增部门" value={summary.department_created} />
              <Statistic title="匹配部门" value={summary.department_matched} />
              <Statistic title="新增用户" value={summary.user_created} />
              <Statistic title="更新用户" value={summary.user_updated} />
              <Statistic title="禁用用户" value={summary.user_disabled} />
              {!summary.mapping_preview?.length ? (
                <Statistic title="跳过用户" value={summary.user_skipped} />
              ) : null}
            </div>
            {summary.mapping_preview && summary.mapping_preview.length > 0 ? (
              <div style={{ marginTop: 16 }}>
                <div style={{ marginBottom: 8, fontSize: 13, color: '#475569' }}>
                  以下为勾选部门下的全部待同步用户（未勾选部门的用户已忽略，不参与同步）：
                </div>
                <Tree
                  showLine
                  defaultExpandAll
                  treeData={toPreviewTreeData(summary.mapping_preview)}
                  style={{
                    maxHeight: 440,
                    overflow: 'auto',
                    border: '1px solid #e2e8f0',
                    borderRadius: 8,
                    padding: 8,
                  }}
                />
              </div>
            ) : summary.details?.length > 0 ? (
              <div style={{ marginTop: 16, padding: '12px 14px', border: '1px solid #fee2e2', background: '#fff7f7', color: '#b42318', fontSize: 13, lineHeight: 1.8 }}>
                {summary.details.slice(0, 8).map((d) => (
                  <div key={d}>{d}</div>
                ))}
              </div>
            ) : null}
          </>
        )}
      </Modal>

      <div style={footerStyle}>
        <Button icon={<ReloadOutlined />} onClick={load}>
          刷新
        </Button>
        <Space wrap>
          <Button icon={<ApartmentOutlined />} onClick={openMatchModal} disabled={remoteDepartments.length === 0}>
            部门匹配（{matchedCount}）
          </Button>
          <Button icon={<EditOutlined />} onClick={() => setMappingOpen(true)}>
            字段映射
          </Button>
          <Button icon={<HistoryOutlined />} onClick={() => setLogsOpen(true)}>
            同步日志
          </Button>
          <Button icon={<PlayCircleOutlined />} loading={importLoading} onClick={doPreview}>
            {importLoading ? '查询用户中…' : '用户导入'}
          </Button>
        </Space>
      </div>

      {/* 字段映射弹窗 */}
      <Modal
        title="编辑字段映射"
        open={mappingOpen}
        width={640}
        onCancel={() => setMappingOpen(false)}
        onOk={saveMapping}
        okText="保存"
        cancelText="取消"
        confirmLoading={saving}
      >
        <Table
          rowKey="key"
          pagination={false}
          dataSource={mappingRows}
          columns={[
            { title: 'OneAuth 字段', dataIndex: 'label', width: 220 },
            {
              title: '第三方字段',
              render: (_, row) => (
                <Form.Item
                  name={['field_mapping', row.key]}
                  rules={row.required ? [{ required: true, message: '请选择或输入字段' }] : undefined}
                  style={{ marginBottom: 0 }}
                >
                  <AutoComplete options={remoteFieldOptions} placeholder="选择或输入字段" />
                </Form.Item>
              ),
            },
          ]}
        />
        <div style={{ marginTop: 12, color: '#94a3b8', fontSize: 12 }}>
          修改后点击「保存」生效；留空表示使用默认映射。
        </div>
      </Modal>

      {/* 同步日志弹窗 */}
      <Modal
        title="同步日志"
        open={logsOpen}
        width={960}
        footer={[
          <Button key="close" onClick={() => setLogsOpen(false)}>
            关闭
          </Button>,
        ]}
        onCancel={() => setLogsOpen(false)}
      >
        <Table
          rowKey="id"
          dataSource={logs}
          pagination={false}
          scroll={{ y: 420 }}
          columns={[
            { title: '时间', dataIndex: 'started_at', render: (v) => (v ? new Date(v).toLocaleString('zh-CN', { hour12: false }) : '-') },
            { title: '状态', dataIndex: 'status' },
            { title: '模式', dataIndex: 'dry_run', render: (v) => (v ? '预览' : '正式') },
            { title: '新增部门', dataIndex: 'department_created' },
            { title: '新增用户', dataIndex: 'user_created' },
            { title: '更新用户', dataIndex: 'user_updated' },
            { title: '禁用用户', dataIndex: 'user_disabled' },
            { title: '消息', dataIndex: 'message', render: (v) => v || '-' },
          ]}
        />
      </Modal>

      {/* 部门匹配弹窗：手动把远端部门一对一映射到本地已存在的部门 */}
      <Modal
        title="部门匹配（手动映射）"
        open={matchOpen}
        width={860}
        onCancel={() => setMatchOpen(false)}
        onOk={saveMatchModal}
        okText="保存匹配"
        cancelText="取消"
        confirmLoading={saving}
      >
        <div style={{ marginBottom: 8, color: '#64748b', fontSize: 12 }}>
          左侧为远端部门树，点击 ▶/▼ 展开或收起；勾选父部门并映射到本地部门后，其下所有子部门（小组/团队）的用户会一并同步，不需要逐一勾选。本地若无对应部门，可展开右侧「映射到本地部门」下拉框，在底部点「＋ 新建本地部门」登记为待创建部门——该部门**不会立即建库**，而是等到你点「立即同步」且确实有用户归属它时才会真正创建，避免产生空部门。
        </div>
        <div style={{ maxHeight: 440, overflowY: 'auto', border: '1px solid #f0f0f0', borderRadius: 6 }}>
          {renderRemoteTree(remoteDepartments)}
          {remoteDepartments.length === 0 && (
            <div style={{ padding: 24, textAlign: 'center', color: '#94a3b8' }}>请先拉取远端部门</div>
          )}
        </div>
      </Modal>

      {/* 新建本地部门弹窗 */}
      <Modal
        title="新建本地部门"
        open={createOpen}
        width={520}
        onCancel={() => setCreateOpen(false)}
        onOk={doCreateDepartment}
        okText="新建并映射"
        cancelText="取消"
        confirmLoading={creating}
      >
        <Form layout="vertical">
          <Form.Item label="部门名称" required>
            <Input
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              placeholder="部门名称，默认取远端部门名"
              maxLength={50}
            />
          </Form.Item>
          <Form.Item label="上级部门（可选）" extra="不选则创建到本地部门根目录">
            <TreeSelect
              allowClear
              showSearch
              treeNodeFilterProp="title"
              placeholder="根目录"
              treeData={localTree}
              value={createParent}
              onChange={(v) => setCreateParent(v || undefined)}
            />
          </Form.Item>
          <div style={{ fontSize: 12, color: '#94a3b8' }}>
            该部门不会立即建库，仅在「立即同步」且确实有用户归属它时才真正创建；其下子部门（小组/团队）的用户会一并同步到该部门。
          </div>
        </Form>
      </Modal>

      {/* 用户名/邮箱冲突弹窗：关联已有用户 / 重命名 / 取消 */}
      <Modal
        title={conflictField === 'email' ? '邮箱冲突' : '用户名冲突'}
        open={conflictOpen}
        width={520}
        onCancel={closeConflict}
        footer={
          <Space style={{ float: 'right' }} wrap>
            <Button onClick={closeConflict}>取消</Button>
            <Button loading={conflictSaving} onClick={() => doResolveConflict('rename')}>
              重命名加序号
            </Button>
            <Button type="primary" loading={conflictSaving} onClick={() => doResolveConflict('link')}>
              关联到已有用户
            </Button>
          </Space>
        }
      >
        {conflictInfo && conflictRecord && (
          <div style={{ fontSize: 13, lineHeight: 1.9 }}>
            <div style={{ marginBottom: 8 }}>
              {conflictField === 'email' ? '邮箱' : '用户名'}「<b>{conflictField === 'email' ? conflictInfo.email : conflictInfo.username}</b>」已被现有用户占用，该远端用户可能与之是同一人：
            </div>
            <div style={{ padding: '10px 12px', background: '#f8fafc', borderRadius: 6, color: '#475569' }}>
              <div>姓名：{conflictInfo.name || '-'}</div>
              <div>登录账号：{conflictInfo.username}</div>
              <div>邮箱：{conflictInfo.email || '-'}</div>
              <div>手机：{conflictInfo.phone || '-'}</div>
            </div>
            <div style={{ marginTop: 10, color: '#64748b' }}>
              当前远端账号：{conflictRecord.name || conflictRecord.username}（{conflictRecord.external_id}）
            </div>
            <div style={{ marginTop: 8, color: '#94a3b8' }}>
              「关联」= 导入时更新该已有用户、不再新建；「重命名」= 给该远端账号追加序号新建独立账号；「取消」= 放弃本次编辑、恢复原值。
            </div>
          </div>
        )}
      </Modal>
    </Form>
  );
}
