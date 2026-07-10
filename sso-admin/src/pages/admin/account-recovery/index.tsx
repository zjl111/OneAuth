import { useEffect, useState } from 'react';
import {
  Card,
  Table,
  Button,
  Space,
  Tag,
  Drawer,
  Form,
  Input,
  InputNumber,
  Select,
  Popconfirm,
  Tabs,
  Modal,
  Descriptions,
  Tooltip,
  Switch,
  App as AntdApp,
  Alert,
} from 'antd';
import {
  PlusOutlined,
  ReloadOutlined,
  SyncOutlined,
  EyeOutlined,
  CopyOutlined,
  FullscreenOutlined,
  FullscreenExitOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import CodeMirror from '@uiw/react-codemirror';
import { go } from '@codemirror/lang-go';
import { oneDark } from '@codemirror/theme-one-dark';
import {
  accountRecoveryApi,
  SCRIPT_DOCS,
  type AccountRecoveryRule,
  type AccountReconciliation,
  type AccountRecoveryLog,
} from '@/api/accountRecovery';
import { appsApi, type OAuth2Client } from '@/api/apps';
import './account-recovery.css';

// 对账结果标签映射
const RECONCILE_LABELS: Record<string, { label: string; color: string }> = {
  consistent: { label: '状态一致', color: 'green' },
  orphan: { label: '待清理 (孤儿账号)', color: 'warning' },
  missing: { label: '缺失账号', color: 'error' },
};

// SSO 状态标签
const SSO_STATUS_LABELS: Record<string, { label: string; color: string }> = {
  active: { label: '正常', color: 'green' },
  locked: { label: '已锁定', color: 'red' },
  deleted: { label: '已删除', color: 'red' },
};

// 第三方状态标签
const THIRD_PARTY_STATUS_LABELS: Record<string, { label: string; color: string }> = {
  active: { label: '正常 (Active)', color: 'green' },
  locked: { label: '已锁定', color: 'red' },
  deleted: { label: '已删除', color: 'red' },
  not_found: { label: '不存在', color: 'default' },
};

// 事件类型标签
const EVENT_TYPE_LABELS: Record<string, { label: string; color: string }> = {
  fetch: { label: '获取用户', color: 'blue' },
  disable: { label: '禁用用户', color: 'orange' },
  delete: { label: '删除用户', color: 'red' },
  reconcile: { label: '对账同步', color: 'purple' },
  test: { label: '测试运行', color: 'default' },
};

// 执行状态标签
const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  success: { label: '成功', color: 'green' },
  failed: { label: '失败', color: 'red' },
  pending: { label: '等待中', color: 'default' },
  retrying: { label: '重试中', color: 'orange' },
};

export default function AccountRecoveryPage() {
  const { message, modal } = AntdApp.useApp();
  const [activeTab, setActiveTab] = useState('dashboard');

  // ── 应用列表 ──
  const [apps, setApps] = useState<OAuth2Client[]>([]);

  // ── 对账看板状态 ──
  const [reconciliation, setReconciliation] = useState<AccountReconciliation[]>([]);
  const [reconLoading, setReconLoading] = useState(false);
  const [reconTotal, setReconTotal] = useState(0);
  const [reconPage, setReconPage] = useState(1);
  const [reconPageSize, setReconPageSize] = useState(10);
  const [reconAppId, setReconAppId] = useState<string | undefined>();
  const [reconFilter, setReconFilter] = useState<string | undefined>();
  const [reconSearch, setReconSearch] = useState<string | undefined>();
  const [reconStats, setReconStats] = useState<Record<string, number>>({});
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [syncing, setSyncing] = useState(false);

  // ── 规则配置状态 ──
  const [rules, setRules] = useState<AccountRecoveryRule[]>([]);
  const [rulesLoading, setRulesLoading] = useState(false);

  // ── 日志状态 ──
  const [logs, setLogs] = useState<AccountRecoveryLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsTotal, setLogsTotal] = useState(0);
  const [logsPage, setLogsPage] = useState(1);
  const [logsPageSize, setLogsPageSize] = useState(10);

  // 清除策略
  const [retentionDays, setRetentionDays] = useState(30);
  const [retentionLoading, setRetentionLoading] = useState(false);
  const [cleanupLoading, setCleanupLoading] = useState(false);
  const [cleanupModalOpen, setCleanupModalOpen] = useState(false);
  const [cleanupModalDays, setCleanupModalDays] = useState(30);

  // ── Drawer 状态 ──
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<AccountRecoveryRule | null>(null);
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [scriptTab, setScriptTab] = useState(0); // 0=fetch, 1=disable, 2=delete
  // 用独立 state 管理三个脚本，避免 Form.Item + display:none 导致值丢失
  const [scriptValues, setScriptValues] = useState<Record<string, string>>({
    fetch_users_script: '',
    disable_user_script: '',
    delete_user_script: '',
  });
  // 三个能力开关也用独立 state，避免 Form.Item 动态 name 导致互相干扰
  const [enableValues, setEnableValues] = useState<Record<string, boolean>>({
    fetch_users_enabled: true,
    disable_user_enabled: true,
    delete_user_enabled: true,
  });

  // ── 日志详情 Modal ──
  const [logDetailOpen, setLogDetailOpen] = useState(false);
  const [logDetail, setLogDetail] = useState<AccountRecoveryLog | null>(null);
  const [logDetailLoading, setLogDetailLoading] = useState(false);

  // ── 加载应用列表 ──
  const loadApps = () => {
    appsApi.list({ page: 1, page_size: 500 }).then((res) => {
      setApps(res.items || []);
    });
  };

  // ── 加载对账数据 ──
  const loadReconciliation = (page = reconPage, pageSize = reconPageSize, appId?: string, filter?: string, search?: string) => {
    setReconLoading(true);
    accountRecoveryApi
      .listReconciliation(page, pageSize, appId, filter, search)
      .then((res) => {
        setReconciliation(res.items || []);
        setReconTotal(res.total || 0);
      })
      .finally(() => setReconLoading(false));
  };

  const loadReconStats = (appId?: string) => {
    accountRecoveryApi.reconciliationStats(appId).then(setReconStats).catch(() => {});
  };

  // ── 加载规则 ──
  const loadRules = () => {
    setRulesLoading(true);
    accountRecoveryApi
      .listRules(1, 100)
      .then((res) => {
        setRules(res.items || []);
      })
      .finally(() => setRulesLoading(false));
  };

  // ── 加载日志 ──
  const loadLogs = (page = logsPage, pageSize = logsPageSize) => {
    setLogsLoading(true);
    accountRecoveryApi
      .listLogs(page, pageSize)
      .then((res) => {
        setLogs(res.items || []);
        setLogsTotal(res.total || 0);
      })
      .finally(() => setLogsLoading(false));
  };

  // ── 加载清除策略配置 ──
  const loadRetentionConfig = () => {
    setRetentionLoading(true);
    accountRecoveryApi
      .getRetentionConfig()
      .then((res) => {
        setRetentionDays(res.retention_days || 30);
      })
      .finally(() => setRetentionLoading(false));
  };

  // ─ 保存清除策略 ─
  const handleSaveRetention = async (days: number) => {
    if (days < 1 || days > 3650) {
      message.warning('保留天数必须为 1-3650 之间的整数');
      return;
    }
    setRetentionLoading(true);
    try {
      await accountRecoveryApi.setRetentionConfig(days);
      setRetentionDays(days);
      setCleanupModalOpen(false);
      message.success('已保存清除策略');
    } catch (e: any) {
      message.error(e?.response?.data?.message || '保存失败');
    } finally {
      setRetentionLoading(false);
    }
  };

  // ── 立即清理 ──
  const handleCleanup = (days: number) => {
    modal.confirm({
      title: '确认清理执行历史',
      content: `将删除 ${days} 天前的所有执行记录，此操作不可恢复。`,
      okType: 'danger',
      onOk: async () => {
        setCleanupLoading(true);
        try {
          const res = await accountRecoveryApi.cleanupLogs(days);
          message.success(`已清理 ${res.deleted} 条记录（${res.before} 之前）`);
          loadLogs();
        } catch (e: any) {
          message.error(e?.response?.data?.message || '清理失败');
        } finally {
          setCleanupLoading(false);
        }
      },
    });
  };

  useEffect(() => {
    loadApps();
    loadRules();
  }, []);

  // 切换 Tab 时加载对应数据
  const handleTabChange = (key: string) => {
    setActiveTab(key);
    if (key === 'dashboard') {
      loadReconciliation(1, 10, undefined, undefined, reconSearch);
      loadReconStats();
    } else if (key === 'config') {
      loadRules();
    } else if (key === 'logs') {
      loadLogs(1, 10);
      loadRetentionConfig();
    }
  };

  // ── 对账操作 ──
  const handleSync = async () => {
    if (!reconAppId) {
      message.warning('请先选择一个应用');
      return;
    }
    // 检查该应用的「获取用户」能力是否启用
    const rule = rules.find((r) => r.app_id === reconAppId);
    if (rule && !rule.fetch_users_enabled) {
      message.warning('该应用未启用「获取全量用户」能力，无法执行对账同步');
      return;
    }
    setSyncing(true);
    try {
      await accountRecoveryApi.runReconciliation(reconAppId);
      message.success('对账同步已完成');
      loadReconciliation(reconPage, reconPageSize, reconAppId, reconFilter, reconSearch);
      loadReconStats(reconAppId);
    } catch (e: any) {
      message.error(e?.response?.data?.message || '对账同步失败');
    } finally {
      setSyncing(false);
    }
  };

  // ── 批量禁用/删除第三方用户 ──
  const getSelectedThirdPartyUserIds = (): string[] => {
    return reconciliation
      .filter((r) => selectedIds.includes(r.id))
      .map((r) => r.third_party_user_id)
      .filter(Boolean);
  };

  const handleBatchDisable = () => {
    if (selectedIds.length === 0) {
      message.warning('请先选择要禁用的用户');
      return;
    }
    const userIds = getSelectedThirdPartyUserIds();
    if (userIds.length === 0) {
      message.warning('选中记录中无有效的第三方用户ID');
      return;
    }
    // 检查规则是否启用了禁用能力
    const rule = rules.find((r) => r.app_id === reconAppId);
    if (rule && !rule.disable_user_enabled) {
      message.warning('该应用未启用「禁用用户」能力');
      return;
    }
    modal.confirm({
      title: `确认批量禁用 ${userIds.length} 个第三方用户？`,
      content: '将在第三方系统中禁用这些用户账号。',
      onOk: async () => {
        try {
          const res = await accountRecoveryApi.batchDisableUser(reconAppId!, userIds);
          message.success(`批量禁用完成：成功 ${res.success} 个，失败 ${res.failed} 个`);
          setSelectedIds([]);
          loadReconciliation(reconPage, reconPageSize, reconAppId, reconFilter, reconSearch);
          loadReconStats(reconAppId);
        } catch (e: any) {
          message.error(e?.response?.data?.message || '批量禁用失败');
        }
      },
    });
  };

  const handleBatchDelete = () => {
    if (selectedIds.length === 0) {
      message.warning('请先选择要删除的用户');
      return;
    }
    const userIds = getSelectedThirdPartyUserIds();
    if (userIds.length === 0) {
      message.warning('选中记录中无有效的第三方用户ID');
      return;
    }
    // 检查规则是否启用了删除能力
    const rule = rules.find((r) => r.app_id === reconAppId);
    if (rule && !rule.delete_user_enabled) {
      message.warning('该应用未启用「删除用户」能力');
      return;
    }
    modal.confirm({
      title: `确认批量删除 ${userIds.length} 个第三方用户？`,
      content: '将在第三方系统中永久删除这些用户，此操作不可恢复。',
      okType: 'danger',
      onOk: async () => {
        try {
          const res = await accountRecoveryApi.batchDeleteUser(reconAppId!, userIds);
          message.success(`批量删除完成：成功 ${res.success} 个，失败 ${res.failed} 个`);
          setSelectedIds([]);
          loadReconciliation(reconPage, reconPageSize, reconAppId, reconFilter, reconSearch);
          loadReconStats(reconAppId);
        } catch (e: any) {
          message.error(e?.response?.data?.message || '批量删除失败');
        }
      },
    });
  };

  // ── 规则操作 ──
  const openCreate = () => {
    setEditing(null);
    setScriptTab(0);
    form.resetFields();
    form.setFieldsValue({
      fetch_users_enabled: true,
      disable_user_enabled: true,
      delete_user_enabled: true,
      timeout_seconds: 60,
      retry_count: 3,
    });
    setScriptValues({
      fetch_users_script: '',
      disable_user_script: '',
      delete_user_script: '',
    });
    setEnableValues({
      fetch_users_enabled: true,
      disable_user_enabled: true,
      delete_user_enabled: true,
    });
    setDrawerOpen(true);
  };

  const openEdit = (r: AccountRecoveryRule) => {
    setEditing(r);
    setScriptTab(0);
    setScriptValues({
      fetch_users_script: r.fetch_users_script || '',
      disable_user_script: r.disable_user_script || '',
      delete_user_script: r.delete_user_script || '',
    });
    setEnableValues({
      fetch_users_enabled: r.fetch_users_enabled,
      disable_user_enabled: r.disable_user_enabled,
      delete_user_enabled: r.delete_user_enabled,
    });
    setDrawerOpen(true);
  };

  // Drawer 动画完成后填充表单（脚本和开关字段由独立 state 管理）
  const handleDrawerAfterOpenChange = (open: boolean) => {
    if (open && editing) {
      form.setFieldsValue({
        app_id: editing.app_id,
        timeout_seconds: editing.timeout_seconds,
        retry_count: editing.retry_count,
      });
    }
  };

  const handleSave = async () => {
    const v = await form.validateFields();

    // 合并脚本值和开关值（来自独立 state，确保所有字段都被保存）
    const payload = {
      ...v,
      ...scriptValues,
      ...enableValues,
    };

    // 创建时检查是否已存在该应用的规则
    if (!editing) {
      const existingRule = rules.find((r) => r.app_id === payload.app_id);
      if (existingRule) {
        message.warning('该应用已配置回收规则，不能重复创建。如需修改，请编辑现有规则。');
        return;
      }
    }

    setSaving(true);
    try {
      if (editing) {
        await accountRecoveryApi.updateRule(editing.id, payload);
        message.success('已更新');
      } else {
        await accountRecoveryApi.createRule(payload);
        message.success('已创建');
      }
      setDrawerOpen(false);
      loadRules();
    } catch (e: any) {
      message.error(e?.response?.data?.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (r: AccountRecoveryRule) => {
    await accountRecoveryApi.deleteRule(r.id);
    message.success('已删除');
    loadRules();
  };

  // ── 日志操作 ──
  const openLogDetail = async (log: AccountRecoveryLog) => {
    setLogDetailLoading(true);
    setLogDetailOpen(true);
    try {
      const detail = await accountRecoveryApi.getLog(log.id);
      setLogDetail(detail);
    } catch {
      message.error('加载日志详情失败');
      setLogDetailOpen(false);
    } finally {
      setLogDetailLoading(false);
    }
  };

  // ── 应用选项（仅 SSO 协议类应用，排除 link 跳转类型和内置管理后台） ──
  const SSO_PROTOCOLS = ['oidc', 'oauth2', 'saml', 'cas'];
  const PROTOCOL_LABEL: Record<string, string> = {
    oidc: 'OIDC',
    oauth2: 'OAuth2',
    saml: 'SAML',
    cas: 'CAS',
  };
  const appOptions = apps
    .filter((app) => {
      const proto = app.protocol || 'oidc';
      // 排除非SSO协议和内置管理后台
      if (!SSO_PROTOCOLS.includes(proto) || app.client_id === 'sso-admin') return false;
      // 创建时排除已有规则的应用
      if (!editing) {
        const hasRule = rules.some((r) => r.app_id === app.client_id);
        if (hasRule) return false;
      }
      return true;
    })
    .map((app) => {
      const proto = app.protocol || 'oidc';
      return {
        value: app.client_id,
        label: `${app.client_name || app.client_id}（${PROTOCOL_LABEL[proto] || proto}）`,
      };
    });

  // ── 对账看板应用选项（来自已配置的回收规则） ──
  const reconAppOptions = rules.map((r) => ({
    value: r.app_id,
    label: r.app_name || r.app_id,
  }));

  // ── 对账看板表格列 ──
  const reconColumns = [
    {
      title: '账号 / 姓名',
      width: 220,
      render: (_: unknown, r: AccountReconciliation) => {
        const hasMismatch = r.attribute_mismatch && r.attribute_mismatch.length > 0;
        const mismatchFields = hasMismatch ? r.attribute_mismatch.split(',') : [];
        const mismatchLabels = mismatchFields.map(f => f === 'display_name' ? '姓名' : f === 'email' ? '邮箱' : f);
        
        return (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ fontWeight: 500 }}>{r.username}</span>
              {hasMismatch && (
                <Tooltip title={`属性不一致: ${mismatchLabels.join(', ')}`}>
                  <span style={{ color: '#faad14', fontSize: 14 }}>⚠</span>
                </Tooltip>
              )}
            </div>
            <div style={{ color: '#8f959e', fontSize: 12 }}>
              {r.display_name} · {r.email}
            </div>
            {hasMismatch && (
              <div style={{ color: '#faad14', fontSize: 11, marginTop: 2 }}>
                第三方: {r.third_party_display_name} · {r.third_party_email}
              </div>
            )}
          </div>
        );
      },
    },
    {
      title: 'SSO 本地状态',
      dataIndex: 'sso_status',
      width: 120,
      render: (v: string) => {
        const st = SSO_STATUS_LABELS[v];
        return st ? <Tag color={st.color}>{st.label}</Tag> : <Tag>{v}</Tag>;
      },
    },
    {
      title: '第三方系统状态',
      dataIndex: 'third_party_status',
      width: 130,
      render: (v: string) => {
        const st = THIRD_PARTY_STATUS_LABELS[v];
        return st ? <Tag color={st.color}>{st.label}</Tag> : <Tag>{v}</Tag>;
      },
    },
    {
      title: '对账判定结果',
      dataIndex: 'reconcile_result',
      width: 150,
      render: (v: string, r: AccountReconciliation) => {
        const st = RECONCILE_LABELS[v];
        const hasMismatch = r.attribute_mismatch && r.attribute_mismatch.length > 0;
        return (
          <div>
            {st ? <Tag color={st.color}>{st.label}</Tag> : <Tag>{v}</Tag>}
            {hasMismatch && <Tag color="warning" style={{ marginLeft: 4 }}>属性不一致</Tag>}
          </div>
        );
      },
    },
    {
      title: '同步时间',
      dataIndex: 'last_synced_at',
      width: 160,
      render: (v: string) => (v ? new Date(v).toLocaleString('zh-CN') : '-'),
    },
    {
      title: '操作',
      width: 140,
      render: (_: unknown, r: AccountReconciliation) => {
        const rule = rules.find((ru) => ru.app_id === r.app_id);
        if (!rule) return <span style={{ color: '#bbbfc4' }}>-</span>;
        const existsInThirdParty =
          r.third_party_status && r.third_party_status !== 'not_found' && !!r.third_party_user_id;
        if (!existsInThirdParty) return <span style={{ color: '#bbbfc4' }}>-</span>;
        const canDisable = rule.disable_user_enabled;
        const canDelete = rule.delete_user_enabled;
        if (!canDisable && !canDelete) return <span style={{ color: '#bbbfc4' }}>-</span>;
        return (
          <Space size={4}>
            {canDisable && (
              <Button
                size="small"
                onClick={() => {
                  modal.confirm({
                    title: `确认禁用第三方用户「${r.username}」？`,
                    content: '将在第三方系统中禁用该用户账号。',
                    onOk: async () => {
                      try {
                        const res = await accountRecoveryApi.batchDisableUser(r.app_id, [r.third_party_user_id]);
                        message.success(`禁用完成：成功 ${res.success} 个，失败 ${res.failed} 个`);
                        loadReconciliation(reconPage, reconPageSize, reconAppId, reconFilter, reconSearch);
                        loadReconStats(reconAppId);
                      } catch (e: any) {
                        message.error(e?.response?.data?.message || '禁用失败');
                      }
                    },
                  });
                }}
              >
                禁用
              </Button>
            )}
            {canDelete && (
              <Button
                size="small"
                danger
                onClick={() => {
                  modal.confirm({
                    title: `确认删除第三方用户「${r.username}」？`,
                    content: '将在第三方系统中永久删除该用户，此操作不可恢复。',
                    okType: 'danger',
                    onOk: async () => {
                      try {
                        const res = await accountRecoveryApi.batchDeleteUser(r.app_id, [r.third_party_user_id]);
                        message.success(`删除完成：成功 ${res.success} 个，失败 ${res.failed} 个`);
                        loadReconciliation(reconPage, reconPageSize, reconAppId, reconFilter, reconSearch);
                        loadReconStats(reconAppId);
                      } catch (e: any) {
                        message.error(e?.response?.data?.message || '删除失败');
                      }
                    },
                  });
                }}
              >
                删除
              </Button>
            )}
          </Space>
        );
      },
    },
  ];

  // ── 规则配置表格列 ──
  const ruleColumns = [
    {
      title: '应用名称',
      dataIndex: 'app_name',
      width: 200,
      render: (v: string) => <span style={{ fontWeight: 500 }}>{v}</span>,
    },
    {
      title: '已配置能力',
      width: 300,
      render: (_: unknown, r: AccountRecoveryRule) => {
        const items: { label: string; enabled: boolean; hasScript: boolean }[] = [
          { label: '获取用户', enabled: r.fetch_users_enabled, hasScript: !!r.fetch_users_script },
          { label: '禁用用户', enabled: r.disable_user_enabled, hasScript: !!r.disable_user_script },
          { label: '删除用户', enabled: r.delete_user_enabled, hasScript: !!r.delete_user_script },
        ];
        return (
          <Space size={4} wrap>
            {items.map((it) => {
              if (!it.hasScript) return null;
              return (
                <Tag key={it.label} color={it.enabled ? 'green' : 'default'}>
                  {it.label}{it.enabled ? '' : ' (已禁用)'}
                </Tag>
              );
            })}
            {!items.some((it) => it.hasScript) && <span style={{ color: '#646a73' }}>未配置</span>}
          </Space>
        );
      },
    },
    {
      title: '更新时间',
      dataIndex: 'updated_at',
      width: 170,
      render: (v: string) => new Date(v).toLocaleString('zh-CN'),
    },
    {
      title: '操作',
      width: 120,
      render: (_: unknown, r: AccountRecoveryRule) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 0, flexWrap: 'nowrap' }}>
          <span className="act-link" onClick={() => openEdit(r)}>
            编辑
          </span>
          <span className="act-sep" />
          <Popconfirm
            title={`确定删除「${r.app_name}」的回收配置？`}
            okType="danger"
            onConfirm={() => handleDelete(r)}
          >
            <span className="act-link" style={{ color: '#ef4444' }}>
              删除
            </span>
          </Popconfirm>
        </div>
      ),
    },
  ];

  // ── 日志列表表格列 ──
  const logColumns = [
    {
      title: '执行时间',
      dataIndex: 'created_at',
      width: 170,
      render: (v: string) => new Date(v).toLocaleString('zh-CN'),
    },
    {
      title: '应用名称',
      dataIndex: 'app_name',
      width: 150,
    },
    {
      title: '事件类型',
      dataIndex: 'event_type',
      width: 120,
      render: (v: string) => {
        const evt = EVENT_TYPE_LABELS[v];
        return evt ? <Tag color={evt.color}>{evt.label}</Tag> : <Tag>{v}</Tag>;
      },
    },
    {
      title: '用户',
      dataIndex: 'username',
      width: 120,
      render: (v: string, r: AccountRecoveryLog) =>
        r.user_email ? (
          <Tooltip title={r.user_email}>
            <span>{v}</span>
          </Tooltip>
        ) : (
          v || '-'
        ),
    },
    {
      title: '执行状态',
      dataIndex: 'status',
      width: 100,
      render: (v: string) => {
        const st = STATUS_LABELS[v];
        return st ? <Tag color={st.color}>{st.label}</Tag> : <Tag>{v}</Tag>;
      },
    },
    {
      title: '耗时',
      dataIndex: 'execution_time',
      width: 90,
      align: 'right' as const,
      render: (v: number) => (v > 0 ? `${v}ms` : '-'),
    },
    {
      title: '操作',
      width: 80,
      render: (_: unknown, r: AccountRecoveryLog) => (
        <span className="act-link" onClick={() => openLogDetail(r)}>
          <EyeOutlined /> 详情
        </span>
      ),
    },
  ];

  // ── Drawer 内脚本子 Tab ──
  const scriptTabs = [
    { key: 'fetch', label: '获取全量用户', scriptField: 'fetch_users_script', enableField: 'fetch_users_enabled' },
    { key: 'disable', label: '禁用指定用户', scriptField: 'disable_user_script', enableField: 'disable_user_enabled' },
    { key: 'delete', label: '删除指定用户', scriptField: 'delete_user_script', enableField: 'delete_user_enabled' },
  ];

  const getCurrentExample = () => {
    if (scriptTab === 0) return SCRIPT_DOCS.fetchUsers.example;
    if (scriptTab === 1) return SCRIPT_DOCS.disableUser.example;
    return SCRIPT_DOCS.deleteUser.example;
  };

  const copyExample = () => {
    navigator.clipboard.writeText(getCurrentExample()).then(() => {
      message.success('示例代码已复制到剪贴板');
    });
  };

  // ── 全屏编辑 ──
  const [fullscreen, setFullscreen] = useState(false);

  return (
    <Card className="ar-page">
      <Tabs
        activeKey={activeTab}
        onChange={handleTabChange}
        items={[
          {
            key: 'dashboard',
            label: '应用用户管理',
            children: (() => {
              const selectedRule = rules.find((r) => r.app_id === reconAppId);
              const fetchDisabled = !!reconAppId && !!selectedRule && !selectedRule.fetch_users_enabled;

              return (
                <>
                  <div
                    style={{
                      marginBottom: 12,
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      flexWrap: 'wrap',
                      gap: 12,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                      <span style={{ color: '#646a73', fontSize: 13 }}>选择应用：</span>
                      <Select
                        allowClear
                        placeholder={rules.length === 0 ? '暂无已配置规则的应用' : '请选择应用'}
                        style={{ width: 200 }}
                        value={reconAppId}
                        onChange={(v) => {
                          setReconAppId(v);
                          if (v) {
                            loadReconciliation(1, reconPageSize, v, reconFilter, reconSearch);
                            loadReconStats(v);
                          } else {
                            setReconciliation([]);
                            setReconTotal(0);
                            setReconStats({});
                            setSelectedIds([]);
                          }
                        }}
                        options={reconAppOptions}
                      />
                      {!fetchDisabled && (
                        <Select
                          allowClear
                          placeholder="状态筛选"
                          style={{ width: 220 }}
                          value={reconFilter}
                          onChange={(v) => {
                            setReconFilter(v);
                            loadReconciliation(1, reconPageSize, reconAppId, v, reconSearch);
                          }}
                          options={[
                            {
                              label: '对账结果',
                              options: [
                                { value: 'orphan', label: '孤儿账号（待清理）' },
                                { value: 'consistent', label: '状态一致' },
                                { value: 'missing', label: '缺失账号' },
                              ],
                            },
                            {
                              label: 'SSO 本地状态',
                              options: [
                                { value: 'sso_locked', label: '已锁定' },
                                { value: 'sso_active', label: '正常' },
                                { value: 'sso_deleted', label: '已删除' },
                              ],
                            },
                            {
                              label: '第三方状态',
                              options: [
                                { value: 'tp_disabled', label: '已禁用' },
                                { value: 'tp_locked', label: '已锁定' },
                                { value: 'tp_not_found', label: '不存在' },
                                { value: 'tp_deleted', label: '已删除' },
                                { value: 'tp_active', label: '正常' },
                              ],
                            },
                          ]}
                        />
                      )}
                      {!fetchDisabled && (
                        <Input
                          allowClear
                          placeholder="搜索用户名 / 姓名 / 邮箱"
                          style={{ width: 220 }}
                          prefix={<SearchOutlined style={{ color: '#94a3b8' }} />}
                          value={reconSearch ?? ''}
                          onChange={(e) => setReconSearch(e.target.value || undefined)}
                          onPressEnter={() => {
                            setReconPage(1);
                            loadReconciliation(1, reconPageSize, reconAppId, reconFilter, reconSearch);
                          }}
                          onClear={() => {
                            setReconSearch(undefined);
                            setReconPage(1);
                            loadReconciliation(1, reconPageSize, reconAppId, reconFilter, undefined);
                          }}
                        />
                      )}
                      {reconAppId && !fetchDisabled && (
                        <span style={{ color: '#646a73', fontSize: 13 }}>
                          待清理 <strong style={{ color: '#d97706' }}>{reconStats['orphan'] || 0}</strong> 个 ·
                          状态一致 <strong style={{ color: '#059669' }}>{reconStats['consistent'] || 0}</strong> 个 ·
                          属性不一致 <strong style={{ color: '#faad14' }}>{reconStats['mismatch'] || 0}</strong> 个 ·
                          缺失 <strong style={{ color: '#dc2626' }}>{reconStats['missing'] || 0}</strong> 个
                        </span>
                      )}
                    </div>
                    <Space>
                      <Button icon={<SyncOutlined />} onClick={handleSync} loading={syncing} disabled={fetchDisabled}>
                        发起对账同步
                      </Button>
                      {!fetchDisabled && selectedIds.length > 0 && (() => {
                        const rule = rules.find((r) => r.app_id === reconAppId);
                        const canDisable = rule?.disable_user_enabled;
                        const canDelete = rule?.delete_user_enabled;
                        return (
                          <>
                            {canDisable && (
                              <Button onClick={handleBatchDisable}>
                                批量禁用选中 ({selectedIds.length})
                              </Button>
                            )}
                            {canDelete && (
                              <Button danger onClick={handleBatchDelete}>
                                批量删除选中 ({selectedIds.length})
                              </Button>
                            )}
                          </>
                        );
                      })()}
                    </Space>
                  </div>

                  {fetchDisabled ? (
                    <Alert
                      type="info"
                      showIcon
                      message="「获取全量用户」能力未启用"
                      description="该应用未开启获取用户列表功能，无法执行对账同步和展示用户列表。请前往「应用配置」启用该能力。"
                      style={{ marginTop: 24 }}
                    />
                  ) : (
                    <Table<AccountReconciliation>
                      rowKey="id"
                      loading={reconLoading}
                      dataSource={reconAppId ? reconciliation : []}
                      columns={reconColumns}
                      rowSelection={{
                        selectedRowKeys: selectedIds,
                        onChange: (keys) => setSelectedIds(keys as string[]),
                      }}
                      pagination={{
                        current: reconPage,
                        pageSize: reconPageSize,
                        total: reconTotal,
                        showSizeChanger: true,
                        showTotal: (t) => `共 ${t} 条`,
                        onChange: (page, pageSize) => {
                          setReconPage(page);
                          setReconPageSize(pageSize);
                          loadReconciliation(page, pageSize, reconAppId, reconFilter, reconSearch);
                        },
                      }}
                    />
                  )}
                </>
              );
            })(),
          },
          {
            key: 'config',
            label: '应用配置',
            children: (
              <>
                <div
                  style={{
                    marginBottom: 12,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <div style={{ fontWeight: 600, fontSize: 15 }}>应用清理配置</div>
                  <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
                    新增应用配置
                  </Button>
                </div>

                <Table<AccountRecoveryRule>
                  rowKey="id"
                  loading={rulesLoading}
                  dataSource={rules}
                  columns={ruleColumns}
                  pagination={false}
                />
              </>
            ),
          },
          {
            key: 'logs',
            label: '执行历史',
            children: (
              <>
                <div
                  style={{
                    marginBottom: 12,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <div style={{ color: '#646a73', fontSize: 13 }}>查看用户清理相关的所有执行记录</div>
                  <Space>
                    <Button onClick={() => { setCleanupModalDays(retentionDays); setCleanupModalOpen(true); }}>
                      清除策略
                    </Button>
                    <Button icon={<ReloadOutlined />} onClick={() => loadLogs()}>
                      刷新
                    </Button>
                  </Space>
                </div>

                <Table<AccountRecoveryLog>
                  rowKey="id"
                  loading={logsLoading}
                  dataSource={logs}
                  columns={logColumns}
                  pagination={{
                    current: logsPage,
                    pageSize: logsPageSize,
                    total: logsTotal,
                    showSizeChanger: true,
                    showTotal: (t) => `共 ${t} 条`,
                    onChange: (page, pageSize) => {
                      setLogsPage(page);
                      setLogsPageSize(pageSize);
                      loadLogs(page, pageSize);
                    },
                  }}
                />
              </>
            ),
          },
        ]}
      />

      {/* ── 规则编辑 Drawer ── */}
      <Drawer
        title={editing ? '编辑第三方回收能力' : '新增第三方清理能力'}
        className="ar-drawer"
        width={680}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        afterOpenChange={handleDrawerAfterOpenChange}
        destroyOnClose
        closable
      >
        <div className="ar-form-container">
          <Form form={form} layout="vertical">
            <div className="ar-rule-section">
              <div className="ar-rule-section-title">基本配置</div>
              <Form.Item
                name="app_id"
                label="关联第三方应用"
                rules={[{ required: true, message: '请选择应用' }]}
              >
                <Select
                  showSearch
                  placeholder="选择应用"
                  optionFilterProp="label"
                  options={appOptions}
                />
              </Form.Item>
            </div>

            <div className="ar-rule-section">
              <div className="ar-rule-section-title">脚本能力配置</div>
              <div className="ar-script-tabs">
                {scriptTabs.map((tab, idx) => (
                  <div
                    key={tab.key}
                    className={`ar-script-tab ${scriptTab === idx ? 'active' : ''}`}
                    onClick={() => setScriptTab(idx)}
                  >
                    {tab.label}
                  </div>
                ))}
              </div>

              {/* 脚本格式说明 */}
              <div style={{
                background: '#f8fafc',
                border: '1px solid #e5e7eb',
                borderRadius: 6,
                padding: '10px 14px',
                marginBottom: 12,
                fontSize: 12,
                lineHeight: 1.6,
              }}>
                <div style={{ fontWeight: 600, marginBottom: 4, color: '#374151' }}>
                  {scriptTab === 0 ? SCRIPT_DOCS.fetchUsers.description : scriptTab === 1 ? SCRIPT_DOCS.disableUser.description : SCRIPT_DOCS.deleteUser.description}
                </div>
                <div style={{ color: '#6b7280', whiteSpace: 'pre-wrap', fontFamily: "'SF Mono', 'Monaco', 'Menlo', 'Consolas', monospace" }}>
                  {scriptTab === 0 ? SCRIPT_DOCS.fetchUsers.input : scriptTab === 1 ? SCRIPT_DOCS.disableUser.input : SCRIPT_DOCS.deleteUser.input}
                </div>
                <div style={{ marginTop: 6, color: '#2C6AA5', whiteSpace: 'pre-wrap', fontFamily: "'SF Mono', 'Monaco', 'Menlo', 'Consolas', monospace" }}>
                  {scriptTab === 0 ? SCRIPT_DOCS.fetchUsers.output : scriptTab === 1 ? SCRIPT_DOCS.disableUser.output : SCRIPT_DOCS.deleteUser.output}
                </div>
              </div>

              {/* 启用开关 */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                background: '#f8fafc',
                border: '1px solid #e5e7eb',
                borderRadius: 8,
                padding: '10px 16px',
                marginBottom: 14,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Switch
                    size="small"
                    checked={enableValues[scriptTabs[scriptTab].enableField] ?? true}
                    onChange={(checked) => {
                      setEnableValues((prev) => ({ ...prev, [scriptTabs[scriptTab].enableField]: checked }));
                    }}
                  />
                  <span style={{ fontSize: 14, fontWeight: 500, color: '#374151' }}>
                    是否启用「{scriptTabs[scriptTab].label.replace(/^\d+\.\s*/, '')}」能力
                  </span>
                </div>
              </div>

              {/* 脚本标签 + 示例按钮 */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontWeight: 500, fontSize: 14 }}>Go 脚本代码</span>
                <Space size={4}>
                  <Button type="text" size="small" icon={<CopyOutlined />} onClick={copyExample} title="复制示例代码">
                    示例
                  </Button>
                </Space>
              </div>

              {/* 三个编辑器同时渲染，切换 Tab 只显示当前一个 */}
              {scriptTabs.map((tab, idx) => (
                <div key={tab.scriptField} style={{ display: scriptTab === idx ? undefined : 'none', position: 'relative' }}>
                  <CodeMirror
                    value={scriptValues[tab.scriptField] || ''}
                    height="260px"
                    theme={oneDark}
                    extensions={[go()]}
                    onChange={(val) => {
                      setScriptValues((prev) => ({ ...prev, [tab.scriptField]: val }));
                    }}
                    basicSetup={{
                      lineNumbers: true,
                      foldGutter: true,
                      highlightActiveLine: true,
                      highlightActiveLineGutter: true,
                    }}
                  />
                  <Button
                    type="primary"
                    size="small"
                    icon={<FullscreenOutlined />}
                    onClick={() => setFullscreen(true)}
                    title="放大编辑"
                    style={{
                      position: 'absolute',
                        bottom: 8,
                        right: 8,
                        zIndex: 10,
                        opacity: 0.85,
                      }}
                    >
                      放大
                    </Button>
                </div>
              ))}

              {/* 提示文字，跟随当前 Tab 切换 */}
              {scriptTab === 0 ? (
                <div style={{ color: '#2C6AA5', fontSize: 12, marginTop: 4 }}>
                  提示：后端 Go 程序会将返回的 JSON 数据与 SSO 数据库做 Diff 交叉对比，并在应用用户管理展现"待清理"账号。
                </div>
              ) : (
                <div style={{ color: '#94a3b8', fontSize: 12, marginTop: 4 }}>
                  可用环境变量：RECOVERY_USERNAME, RECOVERY_EMAIL, RECOVERY_USER_ID, RECOVERY_THIRD_PARTY_ID
                </div>
              )}
            </div>

            <div className="ar-rule-section">
              <div className="ar-rule-section-title">高级设置</div>
              <Form.Item name="timeout_seconds" label="超时时间（秒）" rules={[{ required: true }]}>
                <InputNumber min={1} max={300} style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item name="retry_count" label="失败重试次数" rules={[{ required: true }]}>
                <InputNumber min={0} max={10} style={{ width: '100%' }} />
              </Form.Item>
            </div>
          </Form>
        </div>
        <div className="ar-drawer-footer">
          <Button onClick={() => setDrawerOpen(false)}>取消</Button>
          <Button type="primary" loading={saving} onClick={handleSave}>
            保存配置
          </Button>
        </div>
      </Drawer>

      {/* ── 日志详情 Modal ── */}
      <Modal
        title="执行日志详情"
        open={logDetailOpen}
        onCancel={() => {
          setLogDetailOpen(false);
          setLogDetail(null);
        }}
        footer={
          <Button
            onClick={() => {
              setLogDetailOpen(false);
              setLogDetail(null);
            }}
          >
            关闭
          </Button>
        }
        width={640}
        loading={logDetailLoading}
      >
        {logDetail && (
          <div className="ar-log-detail">
            <Descriptions column={2} size="small" bordered>
              <Descriptions.Item label="应用名称">{logDetail.app_name}</Descriptions.Item>
              <Descriptions.Item label="事件类型">
                {(() => {
                  const evt = EVENT_TYPE_LABELS[logDetail.event_type];
                  return evt ? <Tag color={evt.color}>{evt.label}</Tag> : logDetail.event_type;
                })()}
              </Descriptions.Item>
              <Descriptions.Item label="用户名">{logDetail.username || '-'}</Descriptions.Item>
              <Descriptions.Item label="第三方用户ID">{logDetail.third_party_user_id || '-'}</Descriptions.Item>
              <Descriptions.Item label="邮箱">{logDetail.user_email || '-'}</Descriptions.Item>
              <Descriptions.Item label="执行状态">
                {(() => {
                  const st = STATUS_LABELS[logDetail.status];
                  return st ? <Tag color={st.color}>{st.label}</Tag> : logDetail.status;
                })()}
              </Descriptions.Item>
              <Descriptions.Item label="执行耗时">
                {logDetail.execution_time > 0 ? `${logDetail.execution_time}ms` : '-'}
              </Descriptions.Item>
              <Descriptions.Item label="重试次数">{logDetail.retry_count}</Descriptions.Item>
              <Descriptions.Item label="触发人">{logDetail.triggered_by || '-'}</Descriptions.Item>
              <Descriptions.Item label="执行时间" span={2}>
                {new Date(logDetail.created_at).toLocaleString('zh-CN')}
              </Descriptions.Item>
              {logDetail.error_message && (
                <Descriptions.Item label="错误信息" span={2}>
                  <span style={{ color: '#dc2626' }}>{logDetail.error_message}</span>
                </Descriptions.Item>
              )}
            </Descriptions>

            {logDetail.stdout && (
              <div style={{ marginTop: 16 }}>
                <div style={{ fontWeight: 500, marginBottom: 6, color: '#374151' }}>
                  标准输出 (stdout)
                </div>
                <div className="ar-log-stdout">{logDetail.stdout}</div>
              </div>
            )}

            {logDetail.stderr && (
              <div style={{ marginTop: 16 }}>
                <div style={{ fontWeight: 500, marginBottom: 6, color: '#374151' }}>
                  错误输出 (stderr)
                </div>
                <div className="ar-log-stderr">{logDetail.stderr}</div>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* ── 全屏脚本编辑 ── */}
      <Modal
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <FullscreenExitOutlined />
            <span>编辑脚本 — {scriptTabs[scriptTab].label}</span>
          </div>
        }
        open={fullscreen}
        onCancel={() => setFullscreen(false)}
        width="92vw"
        style={{ top: 20 }}
        styles={{ body: { padding: 0 } }}
        footer={
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button onClick={() => setFullscreen(false)}>关闭</Button>
          </div>
        }
        destroyOnClose={false}
      >
        {scriptTabs.map((tab, idx) => (
          <div key={tab.scriptField} style={{ display: scriptTab === idx ? undefined : 'none' }}>
            <CodeMirror
              value={scriptValues[tab.scriptField] || ''}
              height="calc(85vh - 120px)"
              theme={oneDark}
              extensions={[go()]}
              onChange={(val) => {
                setScriptValues((prev) => ({ ...prev, [tab.scriptField]: val }));
              }}
              basicSetup={{
                lineNumbers: true,
                foldGutter: true,
                highlightActiveLine: true,
                highlightActiveLineGutter: true,
              }}
            />
          </div>
        ))}
      </Modal>

      {/* ─ 清除策略 Modal ── */}
      <Modal
        title="清除策略"
        open={cleanupModalOpen}
        onCancel={() => setCleanupModalOpen(false)}
        footer={
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button onClick={() => setCleanupModalOpen(false)}>取消</Button>
            <Button
              type="primary"
              loading={retentionLoading}
              onClick={() => handleSaveRetention(cleanupModalDays)}
            >
              保存
            </Button>
          </div>
        }
        width={480}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '8px 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ minWidth: 40 }}>删除</span>
            <InputNumber
              min={1}
              max={3650}
              value={cleanupModalDays}
              onChange={(v) => setCleanupModalDays(v ?? 30)}
              style={{ width: 100 }}
            />
            <span>天之前的执行记录</span>
          </div>
        </div>
      </Modal>
    </Card>
  );
}
