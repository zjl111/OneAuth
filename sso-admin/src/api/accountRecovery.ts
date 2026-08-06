import { get, post, put, del } from './request';

export interface AccountRecoveryRule {
  id: string;
  app_id: string;
  app_name: string;
  enabled: boolean;
  last_executed_at: string;

  // Python 脚本
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
    description: '获取第三方系统的全量用户列表。username 字段必须与 SSO 登录账号完全一致，否则对账无法匹配。',
    input: '无输入参数',
    output: `# 必须输出 JSON 数组到 stdout（调试信息请输出到 stderr）：
[
  {
    "user_id": "tp_12345",           # 第三方系统用户ID（推荐填写，禁用/删除操作用）
    "username": "zhangsan",          # 用户名，必须与 SSO 登录账号一致（必填）
    "display_name": "张三",          # 显示名称（可选）
    "email": "zhangsan@company.com", # 邮箱（可选）
    "status": "active"               # 状态：active / locked / disabled / deleted（必填）
  }
]`,
    example: `import json, sys, os
import urllib.request
import ssl

# 本地调试跳过 SSL 验证（生产环境如证书正常可删除这两行）
_ssl_ctx = ssl.create_default_context()
_ssl_ctx.check_hostname = False
_ssl_ctx.verify_mode = ssl.CERT_NONE

# ============ 按需修改以下配置 ============
API_URL = "https://your-system.com/api/users"
API_TOKEN = os.environ.get("API_TOKEN", "")  # 可选：在规则配置里传入或硬编码
# =========================================

def fetch_page(url):
    """请求单页数据，自动处理分页（如无需分页可忽略）"""
    req = urllib.request.Request(url)
    if API_TOKEN:
        req.add_header("Authorization", f"Bearer {API_TOKEN}")
    with urllib.request.urlopen(req, timeout=30, context=_ssl_ctx) as resp:
        return json.loads(resp.read().decode())

def map_status(u):
    """将第三方系统状态映射为标准状态，按实际字段调整"""
    if u.get("deleted"):
        return "deleted"
    if u.get("locked"):
        return "locked"
    if u.get("disabled") or not u.get("active", True):
        return "disabled"
    return "active"

def main():
    all_users = []
    page, page_size = 1, 100

    while True:
        url = f"{API_URL}?page={page}&page_size={page_size}"
        data = fetch_page(url)

        # ---- 按实际返回结构调整取数路径 ----
        # 情况 A：直接返回数组  → items = data
        # 情况 B：嵌套在字段里  → items = data["data"]["list"]
        items = data if isinstance(data, list) else data.get("data", data.get("results", []))
        if not items:
            break

        for u in items:
            all_users.append({
                "user_id":      str(u.get("id", "")),
                "username":     u.get("username", u.get("login_name", "")),  # 必须与 SSO 账号一致
                "display_name": u.get("display_name", u.get("name", "")),
                "email":        u.get("email", ""),
                "status":       map_status(u),
            })

        # 无分页 或 已取完则退出
        if isinstance(data, list) or len(items) < page_size:
            break
        page += 1

    print(f"[fetch] 共获取 {len(all_users)} 个用户", file=sys.stderr)
    print(json.dumps(all_users, ensure_ascii=False))

if __name__ == "__main__":
    main()`
  },

  disableUser: {
    description: '禁用第三方系统中的指定用户',
    input: `# 通过环境变量接收用户信息：
# RECOVERY_USERNAME       - 用户名（与 SSO 登录账号一致）
# RECOVERY_EMAIL          - 邮箱
# RECOVERY_USER_ID        - SSO 用户ID（UUID）
# RECOVERY_THIRD_PARTY_ID - 第三方系统用户ID（推荐用于 API 调用）`,
    output: `# 必须输出 JSON 对象到 stdout：
{
  "success": True,         # 是否成功（必填）
  "message": "用户已禁用"   # 结果消息（可选）
}`,
    example: `import json, sys, os
import urllib.request
import ssl

_ssl_ctx = ssl.create_default_context()
_ssl_ctx.check_hostname = False
_ssl_ctx.verify_mode = ssl.CERT_NONE

# ============ 按需修改 ============
API_URL = "https://your-system.com/api/users"
API_TOKEN = os.environ.get("API_TOKEN", "")
# ====================================

def main():
    tp_id = os.environ.get("RECOVERY_THIRD_PARTY_ID", "")
    username = os.environ.get("RECOVERY_USERNAME", "")

    if not tp_id:
        print(json.dumps({"success": False, "message": "缺少 RECOVERY_THIRD_PARTY_ID"}))
        return

    url = f"{API_URL}/{tp_id}/disable"
    req = urllib.request.Request(url, method="POST", data=b"")
    req.add_header("Content-Type", "application/json")
    if API_TOKEN:
        req.add_header("Authorization", f"Bearer {API_TOKEN}")

    try:
        with urllib.request.urlopen(req, timeout=30, context=_ssl_ctx) as resp:
            pass
        print(f"[disable] {username} 成功", file=sys.stderr)
        print(json.dumps({"success": True, "message": "用户已禁用"}))
    except Exception as e:
        print(f"[disable] {username} 失败: {e}", file=sys.stderr)
        print(json.dumps({"success": False, "message": str(e)}))

if __name__ == "__main__":
    main()`
  },

  deleteUser: {
    description: '删除第三方系统中的指定用户',
    input: `# 通过环境变量接收用户信息：
# RECOVERY_USERNAME       - 用户名（与 SSO 登录账号一致）
# RECOVERY_EMAIL          - 邮箱
# RECOVERY_USER_ID        - SSO 用户ID（UUID）
# RECOVERY_THIRD_PARTY_ID - 第三方系统用户ID（推荐用于 API 调用）`,
    output: `# 必须输出 JSON 对象到 stdout：
{
  "success": True,         # 是否成功（必填）
  "message": "用户已删除"   # 结果消息（可选）
}`,
    example: `import json, sys, os
import urllib.request
import ssl

_ssl_ctx = ssl.create_default_context()
_ssl_ctx.check_hostname = False
_ssl_ctx.verify_mode = ssl.CERT_NONE

# ============ 按需修改 ============
API_URL = "https://your-system.com/api/users"
API_TOKEN = os.environ.get("API_TOKEN", "")
# ====================================

def main():
    tp_id = os.environ.get("RECOVERY_THIRD_PARTY_ID", "")
    username = os.environ.get("RECOVERY_USERNAME", "")

    if not tp_id:
        print(json.dumps({"success": False, "message": "缺少 RECOVERY_THIRD_PARTY_ID"}))
        return

    url = f"{API_URL}/{tp_id}"
    req = urllib.request.Request(url, method="DELETE")
    if API_TOKEN:
        req.add_header("Authorization", f"Bearer {API_TOKEN}")

    try:
        with urllib.request.urlopen(req, timeout=30, context=_ssl_ctx) as resp:
            pass
        print(f"[delete] {username} 成功", file=sys.stderr)
        print(json.dumps({"success": True, "message": "用户已删除"}))
    except Exception as e:
        print(f"[delete] {username} 失败: {e}", file=sys.stderr)
        print(json.dumps({"success": False, "message": str(e)}))

if __name__ == "__main__":
    main()`
  }
};
