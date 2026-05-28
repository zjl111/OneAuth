import { useEffect, useState } from 'react';
import {
  Table,
  Card,
  Button,
  Input,
  Space,
  Tag,
  Modal,
  Form,
  Drawer,
  Popconfirm,
  Switch,
  App as AntdApp,
  Typography,
  Upload,
} from 'antd';
import {
  PlusOutlined,
  ReloadOutlined,
  KeyOutlined,
  CopyOutlined,
  AppstoreOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import { appsApi, type OAuth2Client } from '@/api/apps';
import { useAuthStore } from '@/store/authStore';
import PageToolbar from '@/components/PageToolbar';

const { Paragraph } = Typography;

export default function AppListPage() {
  const { message, modal } = AntdApp.useApp();
  const accessToken = useAuthStore((s) => s.accessToken);
  const [data, setData] = useState<OAuth2Client[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [pagination, setPagination] = useState({ current: 1, pageSize: 10 });

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<OAuth2Client | null>(null);
  const [form] = Form.useForm();
  const logoUrl = Form.useWatch('logo_url', form) as string | undefined;

  // 创建应用前先弹协议选择
  const [protocolOpen, setProtocolOpen] = useState(false);
  const [pickedProtocol, setPickedProtocol] = useState<'oidc' | 'oauth2' | 'saml' | 'cas'>('oidc');

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
    setPickedProtocol('oidc');
    setProtocolOpen(true);
  };

  // 协议选完后真正打开创建表单
  const handleProtocolNext = () => {
    if (pickedProtocol === 'saml' || pickedProtocol === 'cas') {
      message.info(
        pickedProtocol === 'saml'
          ? 'SAML 2.0 接入即将推出，敬请期待'
          : 'CAS 接入即将推出，敬请期待'
      );
      return;
    }
    setProtocolOpen(false);
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({
      client_type: 'confidential',
      redirect_uris: ['http://localhost:3000/callback'],
      scope: pickedProtocol === 'oidc' ? 'openid profile email' : 'profile email',
      is_active: true,
    });
    setDrawerOpen(true);
  };

  const openEdit = (c: OAuth2Client) => {
    setEditing(c);
    setDrawerOpen(true);
    // Drawer 用了 destroyOnClose+Form preserve=false，Form 在打开后才挂载，
    // 这里推迟到下一帧再回填，保证 is_active 等字段能正确回显。
    setTimeout(() => form.setFieldsValue(c), 0);
  };

  const handleSave = async () => {
    const values = await form.validateFields();
    // 把多行字符串转成数组
    if (typeof values.redirect_uris === 'string') {
      values.redirect_uris = values.redirect_uris.split('\n').map((s: string) => s.trim()).filter(Boolean);
    }
    try {
      if (editing) {
        await appsApi.update(editing.id, values);
        message.success('已更新');
        setDrawerOpen(false);
        load();
      } else {
        const r = await appsApi.create(values);
        showSecret(r.client_id, r.client_secret || '');
        setDrawerOpen(false);
        load();
      }
    } catch (e: any) {
      message.error(e?.response?.data?.message || '保存失败');
    }
  };

  const showSecret = (clientId: string, secret: string) => {
    modal.success({
      title: '应用已创建',
      width: 540,
      content: (
        <div>
          <p>请妥善保存以下凭证，<b>client_secret 仅显示一次</b>：</p>
          <Paragraph copyable={{ icon: <CopyOutlined /> }}>
            <b>client_id：</b>
            {clientId}
          </Paragraph>
          <Paragraph copyable>
            <b>client_secret：</b>
            <code>{secret}</code>
          </Paragraph>
        </div>
      ),
    });
  };

  const handleRotate = (c: OAuth2Client) => {
    modal.confirm({
      title: `轮换 ${c.client_name} 的密钥？`,
      content: '轮换后旧密钥立即失效，需要重新配置应用端。',
      onOk: async () => {
        const r = await appsApi.rotateSecret(c.id);
        showSecret(c.client_id, r.client_secret);
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
                    <div style={{ fontSize: 12, color: '#94a3b8' }}>{r.description || '—'}</div>
                  </div>
                </Space>
              );
            },
          },
          { title: 'Client ID', dataIndex: 'client_id', width: 180 },
          {
            title: '协议',
            dataIndex: 'response_types',
            width: 80,
            render: () => <Tag color="purple">OIDC</Tag>,
          },
          {
            title: '回调地址',
            dataIndex: 'redirect_uris',
            width: 280,
            render: (uris: string[]) => uris?.[0] || '-',
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
                <Button type="link" size="small" icon={<KeyOutlined />} onClick={() => handleRotate(r)}>
                  轮换密钥
                </Button>
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
        width={520}
        extra={
          <Space>
            <Button onClick={() => setDrawerOpen(false)}>取消</Button>
            <Button type="primary" onClick={handleSave}>
              保存
            </Button>
          </Space>
        }
        destroyOnClose
      >
        <Form form={form} layout="vertical" preserve={false}>
          <Form.Item name="client_name" label="应用名称" rules={[{ required: true }]}>
            <Input placeholder="例如：Jumpserver 演示环境" />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={2} placeholder="一句话描述该应用" />
          </Form.Item>
          <Form.Item name="logo_url" label="图标" extra="可上传图片，或填写 Emoji / URL">
            <Space size={12} align="center">
              <div
                style={{
                  width: 48,
                  height: 48,
                  border: '1px dashed #d9d9d9',
                  borderRadius: 8,
                  background: '#fafafa',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  overflow: 'hidden',
                  fontSize: 24,
                  flexShrink: 0,
                }}
              >
                {!logoUrl ? (
                  <AppstoreOutlined style={{ color: '#cbd5e1' }} />
                ) : logoUrl.length <= 4 ? (
                  <span>{logoUrl}</span>
                ) : (
                  <img src={logoUrl} alt="logo" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                )}
              </div>
              <Upload
                name="file"
                action="/api/v1/configs/upload-image"
                headers={{ Authorization: `Bearer ${accessToken}` }}
                data={{ prefix: 'app' }}
                accept=".png,.jpg,.jpeg,.svg,.webp,.gif"
                showUploadList={false}
                beforeUpload={(file) => {
                  if (file.size > 2 * 1024 * 1024) {
                    message.error('图标不能超过 2MB');
                    return Upload.LIST_IGNORE;
                  }
                  return true;
                }}
                onChange={(info) => {
                  if (info.file.status === 'done') {
                    const url = info.file.response?.data?.url;
                    if (url) {
                      form.setFieldValue('logo_url', url);
                      message.success('图标已上传');
                    }
                  } else if (info.file.status === 'error') {
                    message.error(info.file.response?.message || '上传失败');
                  }
                }}
              >
                <Button icon={<UploadOutlined />}>上传</Button>
              </Upload>
              <Input
                placeholder="📊 或 URL"
                value={logoUrl}
                onChange={(e) => form.setFieldValue('logo_url', e.target.value)}
                style={{ width: 200 }}
              />
            </Space>
          </Form.Item>
          <Form.Item name="home_url" label="应用首页">
            <Input placeholder="https://app.example.com" />
          </Form.Item>
          <Form.Item
            name="redirect_uris"
            label="回调地址（每行一个）"
            rules={[{ required: true }]}
            getValueFromEvent={(e) =>
              typeof e?.target?.value === 'string'
                ? e.target.value.split('\n')
                : e
            }
            getValueProps={(v) => ({ value: Array.isArray(v) ? v.join('\n') : v })}
          >
            <Input.TextArea rows={3} placeholder="https://example.com/callback" />
          </Form.Item>
          <Form.Item name="scope" label="Scope">
            <Input placeholder="openid profile email roles" />
          </Form.Item>
          <Form.Item name="health_check_url" label="健康检查 URL">
            <Input placeholder="https://app.example.com/health" />
          </Form.Item>
          <Form.Item name="is_active" label="启用" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
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
        width={680}
        centered
      >
        <ProtocolPicker value={pickedProtocol} onChange={setPickedProtocol} />
      </Modal>
      </Card>
    </>
  );
}

// ─── 协议选择卡片 ──────────────────────────
type Proto = 'oidc' | 'oauth2' | 'saml' | 'cas';
function ProtocolPicker({ value, onChange }: { value: Proto; onChange: (v: Proto) => void }) {
  const protos: Array<{ key: Proto; title: string; short: string; color: string; soon?: boolean }> = [
    { key: 'oidc',   title: 'OIDC',     short: '适用于现代 Web、移动端应用单点登录', color: '#1677ff' },
    { key: 'oauth2', title: 'OAuth2',   short: '适用于第三方授权与 API 访问',     color: '#06b6d4' },
    { key: 'saml',   title: 'SAML 2.0', short: '适用于企业系统与标准身份联合场景', color: '#8b5cf6', soon: true },
    { key: 'cas',    title: 'CAS',      short: '适用于传统单点登录系统接入',       color: '#10b981', soon: true },
  ];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, padding: '8px 0' }}>
      {protos.map((p) => {
        const active = value === p.key;
        return (
          <div
            key={p.key}
            onClick={() => onChange(p.key)}
            style={{
              cursor: 'pointer',
              padding: 20,
              borderRadius: 12,
              border: active ? '2px solid #1677ff' : '1px solid #eef0f5',
              background: active ? 'rgba(22,119,255,0.04)' : '#fff',
              position: 'relative',
              transition: 'all 0.15s',
              boxShadow: active ? '0 8px 20px rgba(22,119,255,0.10)' : 'none',
            }}
          >
            {active && (
              <span
                style={{
                  position: 'absolute',
                  top: 12,
                  right: 12,
                  width: 18,
                  height: 18,
                  borderRadius: '50%',
                  background: '#1677ff',
                  color: '#fff',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 12,
                }}
              >
                ✓
              </span>
            )}
            {p.soon && (
              <span
                style={{
                  position: 'absolute',
                  top: 12,
                  left: 12,
                  fontSize: 11,
                  padding: '1px 8px',
                  borderRadius: 999,
                  background: '#fef3c7',
                  color: '#92400e',
                }}
              >
                即将推出
              </span>
            )}
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: 14,
                background: p.color,
                color: '#fff',
                display: 'grid',
                placeItems: 'center',
                fontSize: 22,
                fontWeight: 600,
                marginBottom: 14,
                marginTop: p.soon ? 18 : 0,
              }}
            >
              {p.key === 'oidc' ? '🔐' : p.key === 'oauth2' ? '🔑' : p.key === 'saml' ? '🛡️' : 'CAS'}
            </div>
            <div style={{ fontSize: 17, fontWeight: 600, color: '#1d2c5b' }}>{p.title}</div>
            <div style={{ fontSize: 12.5, color: '#6b7280', marginTop: 6, lineHeight: 1.55 }}>{p.short}</div>
          </div>
        );
      })}
    </div>
  );
}
