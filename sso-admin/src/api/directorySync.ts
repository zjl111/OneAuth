import { get, post, put } from './request';

export interface DirectorySyncConfig {
  enabled: boolean;
  platform_type: string;
  base_url: string;
  api_key?: string;
  selected_department_paths: string[];
  strip_prefix: string;
  mount_department_id: string;
  deactivate_missing: boolean;
  username_strategy: string;
  field_mapping: Record<string, string>;
}

export interface DirectoryDepartment {
  external_id?: string;
  id: string;
  name: string;
  path: string;
  parent_path?: string;
  children?: DirectoryDepartment[];
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

export const directorySyncApi = {
  config: () => get<DirectorySyncConfig>('/directory-sync/config'),
  saveConfig: (data: DirectorySyncConfig) => put<DirectorySyncConfig>('/directory-sync/config', data),
  departments: () => get<DirectoryDepartment[]>('/directory-sync/departments'),
  preview: () => post<DirectorySyncSummary>('/directory-sync/preview'),
  run: () => post<DirectorySyncSummary>('/directory-sync/run'),
  logs: () => get<DirectorySyncLog[]>('/directory-sync/logs'),
};
