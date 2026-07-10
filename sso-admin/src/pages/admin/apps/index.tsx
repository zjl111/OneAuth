import { useEffect, useMemo, useState } from 'react';
import {
  Table,
  Card,
  Button,
  Input,
  Form,
  Modal,
  Radio,
  Space,
  Select,
  Divider,
  Tag,
  Dropdown,
  Drawer,
  App as AntdApp,
  Typography,
  type MenuProps,
} from 'antd';
import {
  PlusOutlined,
  ReloadOutlined,
  KeyOutlined,
  CopyOutlined,
  AppstoreOutlined,
  SafetyOutlined,
  LockOutlined,
  ApiOutlined,
  LoginOutlined,
  SelectOutlined,
  DeleteOutlined,
  MoreOutlined,
  InfoCircleOutlined,
  CloseOutlined,
  DownloadOutlined,
  StopOutlined,
  PlayCircleOutlined,
} from '@ant-design/icons';
import { appsApi, type OAuth2Client } from '@/api/apps';
import PageToolbar from '@/components/PageToolbar';
import AppWizard, { type Proto, type ProtoFamily } from './AppWizard';
import Step3Handoff from './wizard/Step3Handoff';
import './apps.css';

const { Paragraph } = Typography;

function fallbackCopyText(text: string, message: any) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.left = '-9999px';
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
    message.success('已复制');
  } catch {
    message.error('复制失败，请手动复制');
  }
  document.body.removeChild(ta);
}

export default function AppListPage() {
  const { message, modal } = AntdApp.useApp();
  const [batchForm] = Form.useForm();
  const [data, setData] = useState<OAuth2Client[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [batchUpdateOpen, setBatchUpdateOpen] = useState(false);
  const [batchUpdateSubmitting, setBatchUpdateSubmitting] = useState(false);
  const [localCategories, setLocalCategories] = useState<string[]>([]);
  const [serverCategories, setServerCategories] = useState<string[]>([]);
  const [batchCategoryModalOpen, setBatchCategoryModalOpen] = useState(false);
  const [batchCategoryDraft, setBatchCategoryDraft] = useState('');

  const handleBatchDelete = () => {
    if (selectedIds.length === 0) return;
    const builtin = data.filter((d) => selectedIds.includes(d.id) && d.is_builtin);
    if (builtin.length > 0) {
      message.warning(`内置应用「${builtin.map((b) => b.client_name).join('、')}」不可删除，请先取消勾选`);
      return;
    }
    modal.confirm({
      title: `确认删除选中的 ${selectedIds.length} 个应用？`,
      content: '删除后该应用将无法再发起 SSO 登录，相关授权与监控数据也会一并清除。',
      okType: 'danger',
      onOk: async () => {
        try {
          const r: any = await appsApi.batchDelete(selectedIds);
          if (r?.failed?.length) {
            message.warning(`已删除 ${r.deleted} 个，${r.failed.length} 个失败`);
          } else {
            message.success(`已删除 ${selectedIds.length} 个应用`);
          }
          setSelectedIds([]);
          load();
          loadCategories();
        } catch (e: any) {
          message.error(e?.response?.data?.message || '批量删除失败');
        }
      },
    });
  };

  const handleBatchUpdate = async () => {
    try {
      const values = await batchForm.validateFields();
      const payload: Record<string, unknown> = { ids: selectedIds };
      if (typeof values.category === 'string' && values.category.trim()) {
        payload.category = values.category.trim();
      }
      if (values.is_active_mode === 'enable') payload.is_active = true;
      if (values.is_active_mode === 'disable') payload.is_active = false;
      if (values.visible_mode === 'show') payload.visible_in_portal = true;
      if (values.visible_mode === 'hide') payload.visible_in_portal = false;
      if (Object.keys(payload).length === 1) {
        message.warning('请至少选择一个要修改的项目');
        return;
      }
      setBatchUpdateSubmitting(true);
      try {
        const r: any = await appsApi.batchUpdate(payload as any);
        if (r?.failed?.length) {
          message.warning(`已更新 ${r.updated} 个，${r.failed.length} 个失败`);
        } else {
          message.success(`已更新 ${selectedIds.length} 个应用`);
        }
        setBatchUpdateOpen(false);
        setSelectedIds([]);
        batchForm.resetFields();
        load();
        loadCategories();
      } catch (e: any) {
        message.error(e?.response?.data?.message || '批量操作失败');
      } finally {
        setBatchUpdateSubmitting(false);
      }
    } catch {
      // 表单校验已处理
    }
  };
  const [pagination, setPagination] = useState({ current: 1, pageSize: 10 });

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<OAuth2Client | null>(null);
  const [isDuplicate, setIsDuplicate] = useState(false);
  const [handoffOpen, setHandoffOpen] = useState(false);
  const [handoffLoading, setHandoffLoading] = useState(false);
  const [handoffClient, setHandoffClient] = useState<OAuth2Client | null>(null);
  const [handoffSummary, setHandoffSummary] = useState<any>(null);
  const [handoffDiscovery, setHandoffDiscovery] = useState<Record<string, any> | null>(null);
  const categoryOptions = useMemo(() => {
    const items = new Set<string>();
    [...serverCategories, ...localCategories].forEach((v) => {
      const trimmed = String(v || '').trim();
      if (trimmed) items.add(trimmed);
    });
    return Array.from(items).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
  }, [serverCategories, localCategories]);

  const createBatchCategory = () => {
    const value = batchCategoryDraft.trim();
    if (!value) {
      message.warning('请输入分类名称');
      return;
    }
    if (!categoryOptions.includes(value)) {
      setLocalCategories((prev) => [...prev, value]);
    }
    batchForm.setFieldValue('category', value);
    setBatchCategoryDraft('');
    setBatchCategoryModalOpen(false);
    message.success('已添加分类');
  };

  // 创建应用前先弹协议家族选择
  const [protocolOpen, setProtocolOpen] = useState(false);
  const [pickedFamily, setPickedFamily] = useState<ProtoFamily>('oidc');

  const load = () => {
    setLoading(true);
    appsApi
      .list({
        page: pagination.current,
        page_size: pagination.pageSize,
        name: keyword,
      })
      .then((d) => {
        setData(d.items || []);
        setTotal(d.total);
      })
      .finally(() => setLoading(false));
  };

  const loadCategories = () => {
    appsApi.categories().then((cats) => setServerCategories(cats || [])).catch(() => {});
  };

  useEffect(() => {
    load();
    loadCategories();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagination.current, pagination.pageSize]);

  const openCreate = () => {
    setPickedFamily('oidc');
    setProtocolOpen(true);
  };

  // 协议选完后真正打开创建表单
  const handleProtocolNext = () => {
    setProtocolOpen(false);
    setEditing(null);
    setIsDuplicate(false);
    setDrawerOpen(true);
  };

  const openEdit = async (c: OAuth2Client) => {
    setIsDuplicate(false);
    setPickedFamily(((c.protocol as Proto) || 'oidc') as ProtoFamily);
    // 拉详情拿到 grants 列表（列表接口不带 grants）
    try {
      const detail: any = await appsApi.detail(c.id);
      // 后端返回 { client, grants }
      const merged: any = { ...(detail?.client || c), grants: detail?.grants || [] };
      merged.access_policy = (detail?.client || c).access_policy || 'all';
      merged.visible_in_portal = (detail?.client || c).visible_in_portal !== false;
      merged.allow_idp_initiated = (detail?.client || c).allow_idp_initiated !== false;
      merged.allow_sp_initiated = (detail?.client || c).allow_sp_initiated !== false;
      merged.category = (detail?.client || c).category || '';
      setEditing(merged);
    } catch {
      setEditing(c);
    }
    setDrawerOpen(true);
  };

  const buildDiscovery = (family: ProtoFamily) => {
    if (family !== 'oidc' && family !== 'oauth2') return null;
    const origin = window.location.origin;
    return {
      issuer: origin,
      authorization_endpoint: origin + '/oauth/authorize',
      token_endpoint: origin + '/oauth/token',
      userinfo_endpoint: origin + '/oauth/userinfo',
      jwks_uri: origin + '/oauth/jwks.json',
      end_session_endpoint: origin + '/oauth/end_session',
    };
  };

  const buildHandoffJson = (client: OAuth2Client, family: ProtoFamily) => {
    const origin = window.location.origin;
    const base: Record<string, any> = {
      client_name: client.client_name,
      protocol: client.protocol,
    };
    if (family === 'oidc' || family === 'oauth2') {
      base.client_id = client.client_id;
      base.redirect_uris = client.redirect_uris;
      base.scope = client.scope;
      base.grant_types = client.grant_types;
      base.response_types = client.response_types;
      base.subject_type = client.subject_type;
      base.require_pkce = client.require_pkce;
      base.access_token_ttl = client.access_token_ttl;
      base.refresh_token_ttl = client.refresh_token_ttl;
      base.issue_refresh_token = client.issue_refresh_token;
      if (family === 'oidc') {
        base.id_token_ttl = client.id_token_ttl;
        base.oidc_id_token_signing_alg = client.oidc_id_token_signing_alg || 'RS256';
      }
      base.endpoints = buildDiscovery(family);
    }
    if (family === 'saml') {
      base.saml_entity_id = client.saml_entity_id;
      base.saml_acs_url = client.saml_acs_url;
      base.saml_audience = client.saml_audience;
      base.saml_issuer = client.saml_issuer;
      base.saml_binding = client.saml_binding;
      base.saml_nameid_format = client.saml_nameid_format;
      base.saml_nameid_convert = client.saml_nameid_convert;
      base.saml_signature_algorithm = client.saml_signature_algorithm;
      base.saml_digest_algorithm = client.saml_digest_algorithm;
      base.saml_encrypted = client.saml_encrypted;
      base.saml_validity_seconds = client.saml_validity_seconds;
      base.idp_metadata_url = origin + '/saml/metadata';
      base.idp_entity_id = origin;
      base.sso_url = origin + '/saml/sso';
      base.slo_url = origin + '/saml/slo';
    }
    if (family === 'cas') {
      base.cas_user_attribute = client.cas_user_attribute;
      base.cas_expires_seconds = client.cas_expires_seconds;
      base.cas_return_attributes = client.cas_return_attributes;
      base.cas_server_url = origin + '/cas';
      base.cas_login_url = origin + '/cas/login';
      base.cas_logout_url = origin + '/cas/logout';
      base.cas_service_validate_v2 = origin + '/cas/serviceValidate';
      base.cas_service_validate_v3 = origin + '/cas/p3/serviceValidate';
      base.cas_proxy_validate = origin + '/cas/proxyValidate';
    }
    return base;
  };

  const openHandoffInfo = async (c: OAuth2Client) => {
    setHandoffOpen(true);
    setHandoffLoading(true);
    setHandoffClient(null);
    setHandoffSummary(null);
    setHandoffDiscovery(null);
    try {
      const detail: any = await appsApi.detail(c.id);
      const client: OAuth2Client = detail?.client || c;
      const merged: any = { ...client, grants: detail?.grants || client.grants || [] };
      merged.access_policy = client.access_policy || 'all';
      merged.visible_in_portal = client.visible_in_portal !== false;
      merged.allow_idp_initiated = client.allow_idp_initiated !== false;
      merged.allow_sp_initiated = client.allow_sp_initiated !== false;
      merged.category = client.category || '';
      const family = ((merged.protocol as Proto) || 'oidc') as ProtoFamily;
      setHandoffClient(merged);
      setHandoffSummary(merged);
      setHandoffDiscovery(buildDiscovery(family));
    } catch (e: any) {
      message.error(e?.response?.data?.message || '加载对接信息失败');
      setHandoffOpen(false);
    } finally {
      setHandoffLoading(false);
    }
  };

  const handleWizardSubmit = async (values: any): Promise<OAuth2Client> => {
    if (editing && !isDuplicate) {
      const r = await appsApi.update(editing.id, values);
      message.success('已更新');
      load();
      loadCategories();
      return r;
    }
    const r = await appsApi.create(values);
    message.success(isDuplicate ? '已复制并创建' : '已创建');
    setIsDuplicate(false);
    load();
    loadCategories();
    return r;
  };

  const handleRotate = (c: OAuth2Client) => {
    modal.confirm({
      title: `轮换 ${c.client_name} 的密钥？`,
      content: '轮换后旧密钥立即失效，需要重新配置应用端。',
      onOk: async () => {
        const r = await appsApi.rotateSecret(c.id);
        modal.success({
          title: '新客户端密钥（仅显示一次）',
          width: 540,
          content: (
            <div>
              <Paragraph copyable={{ icon: <CopyOutlined /> }}>
                <b>客户端 ID：</b>{c.client_id}
              </Paragraph>
              <Paragraph copyable>
                <b>客户端密钥：</b><code>{r.client_secret}</code>
              </Paragraph>
            </div>
          ),
        });
      },
    });
  };

  const handleToggle = async (c: OAuth2Client) => {
    await appsApi.toggleStatus(c.id);
    message.success('已切换状态');
    load();
  };

  const handleDuplicate = async (r: OAuth2Client) => {
    try {
      const detail: any = await appsApi.detail(r.id);
      const src = detail?.client || r;
      const grants = detail?.grants || [];
      const copy: any = {
        ...src,
        id: '',
        client_id: '',
        client_secret: undefined,
        client_name: src.client_name + ' - 副本',
        is_active: false,
        grants,
        access_policy: src.access_policy || 'all',
        visible_in_portal: src.visible_in_portal !== false,
        allow_idp_initiated: src.allow_idp_initiated !== false,
        allow_sp_initiated: src.allow_sp_initiated !== false,
        category: src.category || '',
      };
      setPickedFamily(((src.protocol as Proto) || 'oidc') as ProtoFamily);
      setEditing(copy);
      setIsDuplicate(true);
      setDrawerOpen(true);
    } catch (e: any) {
      message.error(e?.response?.data?.message || '复制失败');
    }
  };

  const buildActionMenu = (r: OAuth2Client): MenuProps['items'] => ([
    {
      key: 'handoff',
      label: '第三方对接信息',
      icon: <InfoCircleOutlined />,
      onClick: () => openHandoffInfo(r),
    },
    {
      key: 'rotate',
      label: '轮换密钥',
      icon: <KeyOutlined />,
      disabled: !(r.protocol === 'oidc' || r.protocol === 'oauth2' || !r.protocol),
      onClick: () => handleRotate(r),
    },
    {
      key: 'toggle',
      label: r.is_active ? '禁用' : '启用',
      icon: r.is_active ? <StopOutlined /> : <PlayCircleOutlined />,
      onClick: () => handleToggle(r),
    },
    { type: 'divider' },
    {
      key: 'delete',
      label: '删除',
      icon: <DeleteOutlined />,
      danger: true,
      disabled: r.is_builtin,
      onClick: () => {
        modal.confirm({
          title: `确认删除 ${r.client_name}？`,
          content: '删除后该应用将无法再发起 SSO 登录，相关授权与监控数据也会一并清除。',
          okType: 'danger',
          onOk: async () => {
            try {
              await appsApi.delete(r.id);
              message.success('已删除');
              load();
              loadCategories();
            } catch (e: any) {
              message.error(e?.response?.data?.message || '删除失败');
            }
          },
        });
      },
    },
  ]);

  const batchActionMenu: MenuProps['items'] = [
    {
      key: 'batch-update',
      label: '批量操作',
      icon: <SelectOutlined />,
      onClick: () => {
        batchForm.setFieldsValue({
          category: undefined,
          is_active_mode: 'keep',
          visible_mode: 'keep',
        });
        setBatchUpdateOpen(true);
      },
    },
    {
      key: 'batch-delete',
      label: '批量删除',
      icon: <DeleteOutlined />,
      danger: true,
      onClick: handleBatchDelete,
    },
  ];

  return (
    <>
      <PageToolbar>
        <Tag color="blue">共 {total} 个</Tag>
        <Input
          placeholder="搜索应用名称 / Client ID / 分类"
          allowClear
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onPressEnter={load}
          style={{ width: 240 }}
        />
        {selectedIds.length > 0 && (
          <Dropdown trigger={['click']} menu={{ items: batchActionMenu }}>
            <Button icon={<MoreOutlined />}>
              更多操作（{selectedIds.length}）
            </Button>
          </Dropdown>
        )}
        <Button icon={<ReloadOutlined />} onClick={load}>
          刷新
        </Button>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          新建应用
        </Button>
      </PageToolbar>
      <Card className="app-page">
      <Table
        rowKey="id"
        loading={loading}
        dataSource={data}
        scroll={{ x: 1100 }}
        rowSelection={{
          selectedRowKeys: selectedIds,
          onChange: (keys) => setSelectedIds(keys as string[]),
          getCheckboxProps: (r: any) => ({ disabled: r.is_builtin }),
        }}
        pagination={{
          current: pagination.current,
          pageSize: pagination.pageSize,
          total,
          showSizeChanger: true,
          showTotal: (t) => `共 ${t} 条`,
          onChange: (page, pageSize) => setPagination({ current: page, pageSize }),
        }}
        columns={[
          {
            title: '应用名称',
            dataIndex: 'client_name',
            width: 220,
            render: (v, r) => {
              const logo = r.logo_url;
              const isImage = logo && logo.length > 4;
              return (
                <Space>
                  <span
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 6,
                      background: isImage ? '#fff' : '#f1f5fa',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 18,
                      overflow: 'hidden',
                    }}
                  >
                    {isImage ? (
                      <img src={logo} alt={v} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                    ) : logo ? (
                      <span>{logo}</span>
                    ) : (
                      <AppstoreOutlined style={{ color: '#94a3b8' }} />
                    )}
                  </span>
                  <div>
                    <div style={{ fontWeight: 600 }}>{v}</div>
                  </div>
                </Space>
              );
            },
          },
          {
            title: '分类',
            dataIndex: 'category',
            width: 150,
            render: (v: string) => v ? <Tag color="blue">{v}</Tag> : <span style={{ color: '#cbd5e1' }}>未分类</span>,
          },
          {
            title: '排序',
            dataIndex: 'sort_order',
            width: 90,
            align: 'center',
            render: (v: number) => v ?? 0,
          },
          {
            title: '客户端 ID',
            dataIndex: 'client_id',
            width: 180,
            // 仅 OAuth2/OIDC 客户端需要 client_id；SAML/CAS/link 协议没有这个概念，显示 —
            render: (v: string, r) =>
              (r.protocol === 'oidc' || r.protocol === 'oauth2')
                ? v
                : <span style={{ color: '#cbd5e1' }}>—</span>,
          },
          {
            title: '协议',
            dataIndex: 'protocol',
            width: 150,
            render: (p: string, r) => {
              const family = (p || 'oidc') as 'oidc' | 'oauth2' | 'saml' | 'cas' | 'link';
              const colorMap: Record<string, string> = {
                oidc:   'purple',
                oauth2: 'green',
                saml:   'volcano',
                cas:    'gold',
                link:   'default',
              };
              const versionLabel: Record<string, string> = {
                'OpenID_Connect_v1.0': 'OpenID Connect 1.0',
                'OAuth_v2.0':          'OAuth 2.0',
                'OAuth_v2.1':          'OAuth 2.1',
                'SAML_v2.0':           'SAML 2.0',
                'CAS_v3.0':            'CAS 3.0',
                'CAS_v2.0':            'CAS 2.0',
                'CAS_v1.0':            'CAS 1.0',
                'CAS_SAML_v1.1':       'CAS SAML 1.1',
                '登录页跳转':           '登录页跳转',
              };
              const fallback: Record<string, string> = {
                oidc:   'OpenID Connect',
                oauth2: 'OAuth 2.0',
                saml:   'SAML 2.0',
                cas:    'CAS',
                link:   '登录页跳转',
              };
              return (
                <Tag color={colorMap[family]}>
                  {versionLabel[r.protocol_version || ''] || fallback[family]}
                </Tag>
              );
            },
          },
          {
            title: '接入地址',
            dataIndex: 'redirect_uris',
            width: 280,
            render: (uris: string[], r) => {
              if (r.protocol === 'saml') return r.saml_acs_url || '-';
              if (r.protocol === 'cas')  return r.cas_service  || '-';
              if (r.protocol === 'link') return r.login_url    || '-';
              return uris?.[0] || '-';
            },
          },
          {
            title: '状态',
            dataIndex: 'is_active',
            width: 90,
            render: (v) => (v ? <Tag color="green">启用</Tag> : <Tag color="default">禁用</Tag>),
          },
          {
            title: '操作',
            fixed: 'right',
            width: 220,
            render: (_, r) => (
              <div style={{ display: 'flex', alignItems: 'center', gap: 0, flexWrap: 'nowrap' }}>
                <span className="act-link" onClick={() => openEdit(r)}>编辑</span>
                <span className="act-sep" />
                <span className="act-link" onClick={() => handleDuplicate(r)}>复制</span>
                <span className="act-sep" />
                <Dropdown trigger={['click']} menu={{ items: buildActionMenu(r) }}>
                  <span className="act-link">···</span>
                </Dropdown>
              </div>
            ),
          },
        ]}
      />

      <Modal
        open={batchUpdateOpen}
        title={`批量操作 ${selectedIds.length} 个应用`}
        okText="保存"
        cancelText="取消"
        confirmLoading={batchUpdateSubmitting}
        onCancel={() => {
          setBatchUpdateOpen(false);
          batchForm.resetFields();
        }}
        onOk={handleBatchUpdate}
        destroyOnClose
      >
        <Form
          form={batchForm}
          layout="vertical"
          initialValues={{
            is_active_mode: 'keep',
            visible_mode: 'keep',
          }}
        >
          <Form.Item name="category" label="分类" extra="留空表示不修改。可直接选择或新建分类。">
            <Select
              allowClear
              showSearch
              placeholder="请选择分类"
              options={categoryOptions.map((item) => ({ value: item, label: item }))}
              dropdownRender={(menu) => (
                <>
                  {menu}
                  <Divider style={{ margin: '8px 0' }} />
                  <Button
                    type="text"
                    block
                    icon={<PlusOutlined />}
                    style={{ justifyContent: 'flex-start', paddingLeft: 12 }}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => setBatchCategoryModalOpen(true)}
                  >
                    添加分类
                  </Button>
                </>
              )}
              notFoundContent="暂无分类，请点击下方添加"
            />
          </Form.Item>
          <Form.Item name="is_active_mode" label="状态">
            <Radio.Group>
              <Radio value="keep">不修改</Radio>
              <Radio value="enable">启用</Radio>
              <Radio value="disable">禁用</Radio>
            </Radio.Group>
          </Form.Item>
          <Form.Item name="visible_mode" label="是否显示">
            <Radio.Group>
              <Radio value="keep">不修改</Radio>
              <Radio value="show">显示</Radio>
              <Radio value="hide">隐藏</Radio>
            </Radio.Group>
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={batchCategoryModalOpen}
        title="添加分类"
        okText="添加"
        cancelText="取消"
        destroyOnClose
        onCancel={() => {
          setBatchCategoryModalOpen(false);
          setBatchCategoryDraft('');
        }}
        onOk={createBatchCategory}
      >
        <Input
          value={batchCategoryDraft}
          onChange={(e) => setBatchCategoryDraft(e.target.value)}
          onPressEnter={createBatchCategory}
          placeholder="请输入分类名称"
          autoFocus
        />
      </Modal>

      <Drawer
        title={null}
        open={drawerOpen}
        onClose={() => { setDrawerOpen(false); setIsDuplicate(false); setEditing(null); }}
        closeIcon={null}
        width={1100}
        destroyOnClose
        className="app-drawer"
      >
        <div className="app-drawer-header">
          <div className="app-drawer-title">{isDuplicate ? `复制应用 - ${editing?.client_name}` : editing ? `编辑应用 - ${editing.client_name}` : '新建应用'}</div>
          <Button type="text" icon={<CloseOutlined />} onClick={() => setDrawerOpen(false)} className="drawer-close-btn" />
        </div>
        <AppWizard
          open={drawerOpen}
          family={pickedFamily}
          editing={editing}
          isDuplicate={isDuplicate}
          onClose={() => setDrawerOpen(false)}
          onSubmit={handleWizardSubmit}
          categoryOptions={categoryOptions}
        />
      </Drawer>

      <Drawer
        title={null}
        open={handoffOpen}
        onClose={() => setHandoffOpen(false)}
        closeIcon={null}
        width={1120}
        destroyOnClose
        className="app-handoff-drawer"
      >
        <div className="app-drawer-header">
          <div className="app-drawer-title">{handoffClient ? `${handoffClient.client_name} - 第三方对接信息` : '第三方对接信息'}</div>
          <Button type="text" icon={<CloseOutlined />} onClick={() => setHandoffOpen(false)} className="drawer-close-btn" />
        </div>
        <div className="app-handoff-body">
        {handoffLoading ? (
          <div style={{ padding: 24, color: '#64748b' }}>正在加载对接信息...</div>
        ) : (
          handoffClient && (
            <Step3Handoff
              family={((handoffClient.protocol as Proto) || 'oidc') as ProtoFamily}
              isOIDC={(handoffClient.protocol as Proto) === 'oidc'}
              isNewly={false}
              summary={handoffSummary}
              submitted={handoffClient}
              discovery={handoffDiscovery}
            />
          )
        )}
        </div>
        {handoffClient && !handoffLoading && (
          <div className="app-handoff-footer">
            <Button
              icon={<CopyOutlined />}
              onClick={() => {
                const json = buildHandoffJson(handoffClient, ((handoffClient.protocol as Proto) || 'oidc') as ProtoFamily);
                const text = JSON.stringify(json, null, 2);
                if (navigator.clipboard && window.isSecureContext) {
                  navigator.clipboard.writeText(text).then(
                    () => message.success('已复制 JSON'),
                    () => { fallbackCopyText(text, message); },
                  );
                } else {
                  fallbackCopyText(text, message);
                }
              }}
            >
              复制 JSON
            </Button>
            <Button
              type="primary"
              icon={<DownloadOutlined />}
              onClick={() => {
                const json = buildHandoffJson(handoffClient, ((handoffClient.protocol as Proto) || 'oidc') as ProtoFamily);
                const blob = new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `${handoffClient.client_name || 'handoff'}-config.json`;
                a.click();
                URL.revokeObjectURL(url);
                message.success('已下载 JSON');
              }}
            >
              下载 JSON
            </Button>
          </div>
        )}
      </Drawer>

      {/* 协议选择 */}
      <Drawer
        title={null}
        open={protocolOpen}
        onClose={() => setProtocolOpen(false)}
        closeIcon={null}
        width={920}
        destroyOnClose
        className="protocol-drawer"
      >
        <div className="protocol-drawer-header">
          <div className="protocol-drawer-title">创建应用</div>
          <Button type="text" icon={<CloseOutlined />} onClick={() => setProtocolOpen(false)} className="drawer-close-btn" />
        </div>
        <div className="protocol-drawer-body">
          <ProtocolPicker value={pickedFamily} onChange={setPickedFamily} />
        </div>
        <div className="protocol-drawer-footer">
          <Button onClick={() => setProtocolOpen(false)}>取消</Button>
          <Button type="primary" onClick={handleProtocolNext}>
            下一步
          </Button>
        </div>
      </Drawer>
      </Card>
    </>
  );
}

// ─── 协议选择卡片 ──────────────────────────
function ProtocolPicker({ value, onChange }: { value: ProtoFamily; onChange: (v: ProtoFamily) => void }) {
  type Item = {
    key: ProtoFamily;
    title: string;
    short: string;
    accent: string;
    iconBg: string;
    iconColor: string;
    tag: string;
    tagBg: string;
    tagColor: string;
    icon: React.ReactNode;
  };
  // 协议官方 Logo（public/protocols/）
  const logoImg = (src: string, alt: string) => (
    <img
      src={src}
      alt={alt}
      style={{ width: 32, height: 32, objectFit: 'contain', display: 'block' }}
    />
  );
  // SSO 协议（单列）
  const ssoProtos: Item[] = [
    {
      key: 'oidc', title: 'OIDC',
      short: '适用于现代 Web、移动端应用的单点登录',
      accent: 'var(--primary-color)', iconBg: '#fff', iconColor: 'var(--primary-color)',
      tag: '推荐', tagBg: '#dbeafe', tagColor: 'var(--primary-color)',
      icon: logoImg('/protocols/oidc.png', 'OIDC'),
    },
    {
      key: 'oauth2', title: 'OAuth2',
      short: '适用于第三方授权与 API 访问 (OAuth 2.0 / 2.1)',
      accent: '#10b981', iconBg: '#fff', iconColor: '#059669',
      tag: '标准协议', tagBg: '#d1fae5', tagColor: '#047857',
      icon: logoImg('/protocols/oauth2.png', 'OAuth2'),
    },
    {
      key: 'saml', title: 'SAML 2.0',
      short: '适用于企业级身份系统整合和单点登录',
      accent: '#8b5cf6', iconBg: '#fff', iconColor: '#7c3aed',
      tag: '企业常用', tagBg: '#ede9fe', tagColor: '#6d28d9',
      icon: logoImg('/protocols/saml.png', 'SAML 2.0'),
    },
    {
      key: 'cas', title: 'CAS',
      short: '适用于传统单点登录',
      accent: 'var(--primary-color)', iconBg: '#fff', iconColor: 'var(--primary-color)',
      tag: '企业常用', tagBg: '#dbeafe', tagColor: '#1d4ed8',
      icon: logoImg('/protocols/cas.png', 'CAS'),
    },
  ];
  // 其他接入方式（全宽）
  const otherProtos: Item[] = [
    {
      key: 'link', title: '登录页跳转',
      short: '不做单点登录，点击应用后直接跳转到目标登录页，用户自行输入账号密码。',
      accent: '#f97316', iconBg: '#ffedd5', iconColor: '#ea580c',
      tag: '非 SSO', tagBg: '#fee2e2', tagColor: '#dc2626',
      icon: <LoginOutlined style={{ fontSize: 24 }} />,
    },
  ];

  const renderCard = (p: Item, fullWidth = false) => {
    const active = value === p.key;
    return (
      <div
        key={p.key}
        onClick={() => onChange(p.key)}
        style={{
          cursor: 'pointer',
          padding: fullWidth ? '18px 24px' : '20px 22px',
          borderRadius: 12,
          border: active ? `1.5px solid ${p.accent}` : '1px solid #eef0f5',
          background: active ? `${p.accent}0d` : '#fff',
          position: 'relative',
          transition: 'all 0.15s',
          boxShadow: active ? `0 6px 18px ${p.accent}1f` : 'none',
          display: 'flex',
          alignItems: fullWidth ? 'center' : 'flex-start',
          gap: 14,
        }}
      >
        {/* 选中对勾 */}
        {active && !fullWidth && (
          <span
            style={{
              position: 'absolute',
              top: 12, right: 12,
              width: 18, height: 18,
              borderRadius: '50%',
              background: p.accent,
              color: '#fff',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 11,
            }}
          >
            ✓
          </span>
        )}
        {/* 图标圆形 */}
        <div
          style={{
            width: 44, height: 44,
            borderRadius: 12,
            background: p.iconBg,
            color: p.iconColor,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          {p.icon}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 16, fontWeight: 600, color: '#1d2c5b' }}>{p.title}</span>
            <span
              style={{
                padding: '2px 8px',
                borderRadius: 4,
                background: p.tagBg,
                color: p.tagColor,
                fontSize: 11,
                fontWeight: 500,
              }}
            >
              {p.tag}
            </span>
          </div>
          <div style={{ marginTop: 6, fontSize: 12.5, color: '#6b7280', lineHeight: 1.55 }}>
            {p.short}
          </div>
        </div>
        {/* link 卡片右侧的箭头 icon */}
        {fullWidth && (
          <SelectOutlined style={{ color: '#94a3b8', fontSize: 16, flexShrink: 0 }} />
        )}
      </div>
    );
  };

  return (
    <div style={{ padding: '4px 0' }}>
      <div style={{ color: '#1d2c5b', fontWeight: 600, fontSize: 14, marginBottom: 10 }}>单点登录协议</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 14 }}>
        {ssoProtos.map((p) => renderCard(p))}
      </div>
      <div style={{ borderTop: '1px solid #eef0f5', margin: '20px 0 14px' }} />
      <div style={{ color: '#1d2c5b', fontWeight: 600, fontSize: 14, marginBottom: 10 }}>其他接入方式</div>
      <div>
        {otherProtos.map((p) => renderCard(p, true))}
      </div>
    </div>
  );
}
