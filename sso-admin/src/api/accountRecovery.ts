import { get, post, put, del } from './request';

export interface AccountRecoveryRule {
  id: string;
  app_id: string;
  app_name: string;
  enabled: boolean;
  last_executed_at: string;

  // Go 脚本
  fetch_users_enabled: boolean; // 是否启用获取用户能力
  fetch_users_script: string;   // 获取全量用户脚本
  disable_user_enabled: boolean; // 是否启用禁用用户能力
  disable_user_script: string;  // 禁用用户脚本
  delete_user_enabled: boolean; // 是否启用删除用户能力
  delete_user_script: string;   // 删除用户脚本

  timeout_seconds: number;
  retry_count: number;
  created_at: string;
  updated_at: string;
}

export interface AccountReconciliation {
  id: string;
  rule_id: string;
  app_id: string;
  app_name: string;
  username: string;
  display_name: string;
  email: string;
  sso_status: string;         // active, locked, deleted
  third_party_user_id: string; // 第三方系统用户ID
  third_party_status: string; // active, locked, disabled, deleted, not_found
  third_party_display_name: string; // 第三方系统的显示名称
  third_party_email: string;        // 第三方系统的邮箱
  attribute_mismatch: string;       // 不一致的属性，如 "display_name,email"
  reconcile_result: string;   // consistent, orphan, missing
  last_synced_at: string;
  created_at: string;
}

export interface AccountRecoveryLog {
  id: string;
  rule_id: string;
  rule_name: string;
  app_name: string;
  username: string;
  user_email: string;
  third_party_user_id: string;
  event_type: string; // fetch, disable, delete, reconcile, test
  status: string;     // success, failed, pending, retrying
  stdout: string;
  stderr: string;
  error_message: string;
  retry_count: number;
  execution_time: number;
  triggered_by: string;
  created_at: string;
}

export interface PageData<T> {
  total: number;
  items: T[];
}

export const accountRecoveryApi = {
  // Rules
  listRules: (page = 1, pageSize = 20) =>
    get<PageData<AccountRecoveryRule>>('/account-recovery', { page, page_size: pageSize }),

  getRule: (id: string) =>
    get<AccountRecoveryRule>(`/account-recovery/rules/${id}`),

  createRule: (data: Partial<AccountRecoveryRule>) =>
    post<AccountRecoveryRule>('/account-recovery', data),

  updateRule: (id: string, data: Partial<AccountRecoveryRule>) =>
    put<AccountRecoveryRule>(`/account-recovery/rules/${id}`, data),

  deleteRule: (id: string) =>
    del<void>(`/account-recovery/rules/${id}`),

  toggleRule: (id: string, enabled: boolean) =>
    post<AccountRecoveryRule>(`/account-recovery/rules/${id}/toggle`, { enabled }),

  testRun: (id: string) =>
    post<AccountRecoveryLog>(`/account-recovery/rules/${id}/test`),

  // Reconciliation
  listReconciliation: (page = 1, pageSize = 20, appId?: string, filter?: string, search?: string) =>
    get<PageData<AccountReconciliation>>('/account-recovery/reconciliation', {
      page,
      page_size: pageSize,
      app_id: appId,
      filter,
      search,
    }),

  reconciliationStats: (appId?: string) =>
    get<Record<string, number>>('/account-recovery/reconciliation/stats', { app_id: appId }),

  runReconciliation: (appId: string) =>
    post<{ message: string }>('/account-recovery/reconciliation/run', { app_id: appId }),

  batchCleanup: (ids: string[]) =>
    post<{ cleaned: number }>('/account-recovery/reconciliation/batch-cleanup', { ids }),

  batchDisableUser: (appId: string, thirdPartyUserIds: string[]) =>
    post<{ success: number; failed: number }>('/account-recovery/reconciliation/batch-disable', {
      app_id: appId,
      third_party_user_ids: thirdPartyUserIds,
    }),

  batchDeleteUser: (appId: string, thirdPartyUserIds: string[]) =>
    post<{ success: number; failed: number }>('/account-recovery/reconciliation/batch-delete', {
      app_id: appId,
      third_party_user_ids: thirdPartyUserIds,
    }),

  // Logs
  listLogs: (page = 1, pageSize = 20, ruleId?: string) =>
    get<PageData<AccountRecoveryLog>>('/account-recovery/logs', { page, page_size: pageSize, rule_id: ruleId }),

  getLog: (id: string) =>
    get<AccountRecoveryLog>(`/account-recovery/logs/${id}`),

  // 清除策略
  getRetentionConfig: () =>
    get<{ retention_days: number }>('/account-recovery/logs/retention'),

  setRetentionConfig: (retentionDays: number) =>
    post<{ retention_days: number }>('/account-recovery/logs/retention', { retention_days: retentionDays }),

  cleanupLogs: (days: number) =>
    post<{ deleted: number; before: string }>('/account-recovery/logs/cleanup', { days }),
};

// 脚本格式说明
export const SCRIPT_DOCS = {
  fetchUsers: {
    description: '获取第三方系统的全量用户列表',
    input: '无输入参数',
    output: `// 必须返回 JSON 数组，格式如下：
[
  {
    "user_id": "tp_12345",          // 第三方系统用户ID（推荐填写，用于删除/禁用操作）
    "username": "zhangsan",         // 用户名（用于匹配SSO用户，必填）
    "display_name": "张三",         // 显示名称（可选）
    "email": "zhangsan@company.com", // 邮箱（可选）
    "status": "active"              // 状态：active/locked/disabled/deleted（必填）
  }
]`,
    example: `package main

import (
    "encoding/json"
    "fmt"
    "net/http"
)

// StandardUserDTO 标准用户数据传输对象
type StandardUserDTO struct {
    UserID      string \`json:"user_id"\`
    Username    string \`json:"username"\`
    DisplayName string \`json:"display_name"\`
    Email       string \`json:"email"\`
    Status      string \`json:"status"\` // active, locked, disabled, deleted
}

func main() {
    // 调用第三方 API 获取用户列表
    resp, err := http.Get("https://third-party.com/api/users")
    if err != nil {
        panic(err)
    }
    defer resp.Body.Close()

    // 解析第三方返回的数据
    var thirdPartyUsers []struct {
        ID     string \`json:"id"\`
        Name   string \`json:"name"\`
        Email  string \`json:"email"\`
        Active bool   \`json:"active"\`
    }
    json.NewDecoder(resp.Body).Decode(&thirdPartyUsers)

    // 转换为标准格式
    users := make([]StandardUserDTO, 0, len(thirdPartyUsers))
    for _, u := range thirdPartyUsers {
        status := "active"
        if !u.Active {
            status = "disabled"
        }
        users = append(users, StandardUserDTO{
            UserID:      u.ID,
            Username:    u.Name,
            DisplayName: u.Name,
            Email:       u.Email,
            Status:      status,
        })
    }

    // 输出 JSON 数组
    result, _ := json.Marshal(users)
    fmt.Println(string(result))
}`
  },

  disableUser: {
    description: '禁用第三方系统中的指定用户',
    input: `// 通过环境变量接收用户信息：
// RECOVERY_USERNAME       - 用户名
// RECOVERY_EMAIL          - 邮箱
// RECOVERY_USER_ID        - SSO用户ID
// RECOVERY_THIRD_PARTY_ID - 第三方系统用户ID（推荐用于API调用）`,
    output: `// 必须返回 JSON 对象，格式如下：
{
  "success": true,        // 是否成功（必填）
  "message": "用户已禁用"  // 结果消息（可选）
}`,
    example: `package main

import (
    "encoding/json"
    "fmt"
    "net/http"
    "os"
    "strings"
)

type Result struct {
    Success bool   \`json:"success"\`
    Message string \`json:"message"\`
}

func main() {
    thirdPartyID := os.Getenv("RECOVERY_THIRD_PARTY_ID")
    username := os.Getenv("RECOVERY_USERNAME")

    // 调用第三方 API 禁用用户（推荐使用第三方用户ID）
    url := fmt.Sprintf("https://third-party.com/api/users/%s/disable", thirdPartyID)
    req, _ := http.NewRequest("POST", url, strings.NewReader(""))
    req.Header.Set("Content-Type", "application/json")

    resp, err := http.DefaultClient.Do(req)
    if err != nil {
        result := Result{Success: false, Message: err.Error()}
        data, _ := json.Marshal(result)
        fmt.Println(string(data))
        return
    }
    defer resp.Body.Close()

    result := Result{Success: true, Message: "用户已禁用"}
    data, _ := json.Marshal(result)
    fmt.Println(string(data))
}`
  },

  deleteUser: {
    description: '删除第三方系统中的指定用户',
    input: `// 通过环境变量接收用户信息：
// RECOVERY_USERNAME       - 用户名
// RECOVERY_EMAIL          - 邮箱
// RECOVERY_USER_ID        - SSO用户ID
// RECOVERY_THIRD_PARTY_ID - 第三方系统用户ID（推荐用于API调用）`,
    output: `// 必须返回 JSON 对象，格式如下：
{
  "success": true,        // 是否成功（必填）
  "message": "用户已删除"  // 结果消息（可选）
}`,
    example: `package main

import (
    "encoding/json"
    "fmt"
    "net/http"
    "os"
)

type Result struct {
    Success bool   \`json:"success"\`
    Message string \`json:"message"\`
}

func main() {
    thirdPartyID := os.Getenv("RECOVERY_THIRD_PARTY_ID")

    // 调用第三方 API 删除用户（推荐使用第三方用户ID）
    url := fmt.Sprintf("https://third-party.com/api/users/%s", thirdPartyID)
    req, _ := http.NewRequest("DELETE", url, nil)

    resp, err := http.DefaultClient.Do(req)
    if err != nil {
        result := Result{Success: false, Message: err.Error()}
        data, _ := json.Marshal(result)
        fmt.Println(string(data))
        return
    }
    defer resp.Body.Close()

    result := Result{Success: true, Message: "用户已删除"}
    data, _ := json.Marshal(result)
    fmt.Println(string(data))
}`
  }
};
