import { get, post, put } from './request';

export interface DirectorySyncConfig {
  enabled: boolean;
  platform_type: string;
  base_url: string;
  api_key?: string;
  api_key_set?: boolean;
  selected_department_paths: string[];
  strip_prefix: string;
  mount_department_id: string;
  deactivate_missing: boolean;
  username_strategy: string;
  email_strategy: string;
  email_domain: string;
  field_mapping: Record<string, string>;
  mapping_mode: boolean;
  department_mappings: DepartmentMapping[];
  /** 同步导入的用户自动加入的用户组 ID 列表（默认用户组） */
  default_group_ids?: string[];
}

export interface DepartmentMapping {
  remote_external_id: string;
  remote_path: string;
  remote_name: string;
  local_department_id: string;
  /** 标记为「待创建部门」：同步且有用户归属时才真正新建本地部门 */
  create_local?: boolean;
  /** 待创建部门的名称 */
  new_dept_name?: string;
  /** 待创建部门的上级本地部门 ID（空表示根目录） */
  new_dept_parent_id?: string;
  include: boolean;
}

export interface DirectoryDepartment {
  external_id?: string;
  id: string;
  name: string;
  path: string;
  parent_path?: string;
  children?: DirectoryDepartment[];
}

export interface SyncPreviewUser {
  name: string;
  username: string;
  email: string;
  /** "create" 新建 | "update" 更新 */
  status: string;
}

export interface SyncPreviewDept {
  remote_path: string;
  remote_name: string;
  user_count: number;
  users: SyncPreviewUser[];
  children: SyncPreviewDept[];
}

export interface DirectorySyncSummary {
  dry_run: boolean;
  status: string;
  department_created: number;
  department_matched: number;
  user_created: number;
  user_updated: number;
  user_disabled: number;
  user_skipped: number;
  message: string;
  details: string[];
  mapping_preview?: SyncPreviewDept[];
}

export interface UserImportPreviewItem {
  external_id: string;
  /** "create" 新建 | "update" 更新 */
  status: string;
  /** 将落库的真实用户名（经策略换算，全小写） */
  username: string;
  name: string;
  email: string;
  groups: string[];
  /** 解析后将要落库的本地部门名称（所见即所得，而非源端远端部门路径） */
  department: string;
  exists: boolean;
}

export interface UserImportPreview {
  sync_at: string;
  /** 0-100，拉取未完成时显示进度 */
  progress: number;
  total: number;
  page: number;
  page_size: number;
  users: UserImportPreviewItem[];
}

/** 编辑用户名/邮箱结果：无冲突时已写回；冲突时 conflict 非空、未写回 */
export interface EditBufferFieldResult {
  value: string;
  conflict?: BufferConflictInfo;
}

/** 用户名/邮箱与已存在用户冲突时的冲突信息 */
export interface BufferConflictInfo {
  user_id: string;
  username: string;
  name: string;
  email: string;
  phone: string;
}

export interface DirectorySyncLog {
  id: string;
  provider: string;
  status: string;
  dry_run: boolean;
  started_at: string;
  finished_at: string | null;
  department_created: number;
  department_matched: number;
  user_created: number;
  user_updated: number;
  user_disabled: number;
  user_skipped: number;
  message: string;
}

// 同步/导入/预览都是「同步执行 + 可能拉取大量远端部门」的耗时操作，
// 默认 15s 的 axios 超时会让前端提前报"超时"，而此时后端其实仍在运行。
// 这里给这些调用单独放宽超时到 5 分钟，避免误报超时。
const SYNC_LONG_TIMEOUT = { timeout: 300000 };

export const directorySyncApi = {
  config: () => get<DirectorySyncConfig>('/directory-sync/config'),
  saveConfig: (data: DirectorySyncConfig) => put<DirectorySyncConfig>('/directory-sync/config', data),
  departments: () => get<DirectoryDepartment[]>('/directory-sync/departments'),
  preview: () => post<DirectorySyncSummary>('/directory-sync/preview', undefined, SYNC_LONG_TIMEOUT),
  userImportPreview: (params?: { keyword?: string; page?: number; page_size?: number }) =>
    get<UserImportPreview>('/directory-sync/user-import-preview', params, SYNC_LONG_TIMEOUT),
  run: () => post<DirectorySyncSummary>('/directory-sync/run', undefined, SYNC_LONG_TIMEOUT),
  // 同步用户（仅拉取）：拉取远端通讯录 → 写入缓冲表 → 刷新预览，不创建/修改/禁用用户
  pull: () => post<DirectorySyncSummary>('/directory-sync/pull', undefined, SYNC_LONG_TIMEOUT),
  // 完整同步：拉取远端 → 写缓冲 → 应用到用户 → 禁用缺失（与每日 2:00 定时任务一致）
  syncUsers: () => post<DirectorySyncSummary>('/directory-sync/sync-users', undefined, SYNC_LONG_TIMEOUT),
  importUsers: (data: { external_ids?: string[]; group_ids?: string[] }) =>
    post<DirectorySyncSummary>('/directory-sync/import', data, SYNC_LONG_TIMEOUT),
  // 行内编辑缓冲字段（用户名/邮箱）：写回缓冲表（含 edited 标记），pull 重建时保留编辑值；
  // 若与已存在用户冲突则不写回、返回 conflict 信息，由前端弹窗让用户选择处理方式。
  editField: (external_id: string, field: 'username' | 'email', value: string) =>
    post<{ username?: string; email?: string; conflict?: BufferConflictInfo }>('/directory-sync/buffer/edit-field', { external_id, field, value }, SYNC_LONG_TIMEOUT),
  // 冲突处理：link=关联到已有用户（建立绑定，导入时更新而非新建）；rename=重命名加序号
  resolveConflict: (data: { external_id: string; field: 'username' | 'email'; action: 'link' | 'rename'; conflict_user_id?: string; username?: string }) =>
    post<{ username?: string; email?: string }>('/directory-sync/buffer/resolve-conflict', data, SYNC_LONG_TIMEOUT),
  logs: () => get<DirectorySyncLog[]>('/directory-sync/logs'),
};
