import { useEffect, useState } from 'react';
import {
  Table,
  Card,
  Button,
  Input,
  Space,
  Tag,
  Modal,
  Drawer,
  Popconfirm,
  App as AntdApp,
  Typography,
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
} from '@ant-design/icons';
import { appsApi, type OAuth2Client } from '@/api/apps';
import PageToolbar from '@/components/PageToolbar';
import AppWizard, { type Proto, type ProtoFamily } from './AppWizard';

const { Paragraph } = Typography;

export default function AppListPage() {
  const { message, modal } = AntdApp.useApp();
  const [data, setData] = useState<OAuth2Client[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

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
        } catch (e: any) {
          message.error(e?.response?.data?.message || '批量删除失败');
        }
      },
    });
  };
  const [pagination, setPagination] = useState({ current: 1, pageSize: 10 });

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<OAuth2Client | null>(null);

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

  useEffect(() => {
    load();
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
    setDrawerOpen(true);
  };

  const openEdit = async (c: OAuth2Client) => {
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
      setEditing(merged);
    } catch {
      setEditing(c);
    }
    setDrawerOpen(true);
  };

  const handleWizardSubmit = async (values: any): Promise<OAuth2Client> => {
    if (editing) {
      const r = await appsApi.update(editing.id, values);
      message.success('已更新');
      load();
      return r;
    }
    const r = await appsApi.create(values);
    load();
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

  return (
    <>
      <PageToolbar>
        <Tag color="blue">共 {total} 个</Tag>
        <Input
          placeholder="搜索应用名称 / Client ID"
          allowClear
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onPressEnter={load}
          style={{ width: 240 }}
        />
        {selectedIds.length > 0 && (
          <Button danger icon={<DeleteOutlined />} onClick={handleBatchDelete}>
            批量删除（{selectedIds.length}）
          </Button>
        )}
        <Button icon={<ReloadOutlined />} onClick={load}>
          刷新
        </Button>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          新建应用
        </Button>
      </PageToolbar>
      <Card>
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
            width: 320,
            render: (_, r) => (
              <Space size="small">
                <Button type="link" size="small" onClick={() => openEdit(r)}>
                  编辑
                </Button>
                {(r.protocol === 'oidc' || r.protocol === 'oauth2' || !r.protocol) && (
                  <Button type="link" size="small" icon={<KeyOutlined />} onClick={() => handleRotate(r)}>
                    轮换密钥
                  </Button>
                )}
                <Button type="link" size="small" onClick={() => handleToggle(r)}>
                  {r.is_active ? '禁用' : '启用'}
                </Button>
                <Popconfirm
                  title={`确认删除 ${r.client_name}？`}
                  onConfirm={async () => {
                    try {
                      await appsApi.delete(r.id);
                      message.success('已删除');
                      load();
                    } catch (e: any) {
                      message.error(e?.response?.data?.message || '删除失败');
                    }
                  }}
                  disabled={r.is_builtin}
                >
                  <Button type="link" size="small" danger disabled={r.is_builtin}>
                    删除
                  </Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />

      <Drawer
        title={editing ? `编辑应用 - ${editing.client_name}` : '新建应用'}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        width={1100}
        destroyOnClose
      >
        <AppWizard
          open={drawerOpen}
          family={pickedFamily}
          editing={editing}
          onClose={() => setDrawerOpen(false)}
          onSubmit={handleWizardSubmit}
        />
      </Drawer>

      {/* 协议选择 */}
      <Modal
        title={
          <div>
            <div style={{ fontSize: 17, fontWeight: 600 }}>创建应用</div>
            <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 4 }}>请选择应用接入方式</div>
          </div>
        }
        open={protocolOpen}
        onCancel={() => setProtocolOpen(false)}
        onOk={handleProtocolNext}
        okText="下一步"
        width={720}
        centered
      >
        <ProtocolPicker value={pickedFamily} onChange={setPickedFamily} />
      </Modal>
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
  // SSO 协议（2×2）
  const ssoProtos: Item[] = [
    {
      key: 'oidc', title: 'OIDC',
      short: '适用于现代 Web、移动端应用的单点登录',
      accent: '#1677ff', iconBg: '#fff', iconColor: '#1677ff',
      tag: '推荐', tagBg: '#dbeafe', tagColor: '#1677ff',
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
      accent: '#1677ff', iconBg: '#fff', iconColor: '#1677ff',
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
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
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
