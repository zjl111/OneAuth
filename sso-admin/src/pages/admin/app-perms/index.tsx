import { useEffect, useMemo, useState } from 'react';
import {
  Card,
  Table,
  Button,
  Input,
  Space,
  Tag,
  Drawer,
  App as AntdApp,
  Select,
  Tabs,
  List,
  Empty,
  Popconfirm,
} from 'antd';
import {
  ReloadOutlined,
  AppstoreOutlined,
  UserOutlined,
  SafetyOutlined,
  TeamOutlined,
  PlusOutlined,
  DeleteOutlined,
} from '@ant-design/icons';
import { appPermApi, roleApi, userGroupApi, type AppPermApp, type AppGrant, type Role, type UserGroup } from '@/api/misc';
import { usersApi, type User } from '@/api/users';
import PageToolbar from '@/components/PageToolbar';

type PrincipalType = 'user' | 'role' | 'group';

export default function AppPermsPage() {
  const { message } = AntdApp.useApp();
  const [data, setData] = useState<AppPermApp[]>([]);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');

  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<AppPermApp | null>(null);
  const [grants, setGrants] = useState<AppGrant[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [groups, setGroups] = useState<UserGroup[]>([]);
  const [adding, setAdding] = useState(false);
  const [addType, setAddType] = useState<PrincipalType>('user');
  const [addId, setAddId] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);

  const load = () => {
    setLoading(true);
    appPermApi.listApps().then(setData).finally(() => setLoading(false));
  };
  useEffect(load, []);

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    if (!kw) return data;
    return data.filter(
      (a) =>
        a.client_name.toLowerCase().includes(kw) || a.client_id.toLowerCase().includes(kw)
    );
  }, [data, keyword]);

  const openManage = async (app: AppPermApp) => {
    setTarget(app);
    setOpen(true);
    setAdding(false);
    setAddType('user');
    setAddId(undefined);
    try {
      const [gs, us, rs, ggs] = await Promise.all([
        appPermApi.listGrants(app.client_id),
        usersApi.list({ page: 1, page_size: 500 }),
        roleApi.list(),
        userGroupApi.list(),
      ]);
      setGrants(gs || []);
      setUsers(us.items || []);
      setRoles(rs || []);
      setGroups(ggs || []);
    } catch (e: any) {
      message.error(e?.response?.data?.message || '加载失败');
    }
  };

  const handleAdd = () => {
    if (!addId) {
      message.error('请选择对象');
      return;
    }
    if (grants.find((g) => g.principal_type === addType && g.principal_id === addId)) {
      message.warning('已存在');
      return;
    }
    let name = '';
    if (addType === 'user') {
      const u = users.find((x) => x.id === addId);
      name = u?.nickname || u?.username || addId;
    } else if (addType === 'role') {
      const r = roles.find((x) => x.id === addId);
      name = r?.name || addId;
    } else {
      const g = groups.find((x) => x.id === addId);
      name = g?.name || addId;
    }
    setGrants([
      ...grants,
      {
        id: `new-${Date.now()}`,
        client_id: target!.client_id,
        principal_type: addType,
        principal_id: addId,
        principal_name: name,
        created_at: new Date().toISOString(),
      },
    ]);
    setAddId(undefined);
    setAdding(false);
  };

  const handleRemove = (g: AppGrant) => {
    setGrants(grants.filter((x) => !(x.principal_type === g.principal_type && x.principal_id === g.principal_id)));
  };

  const handleSave = async () => {
    if (!target) return;
    setSaving(true);
    try {
      await appPermApi.setGrants(
        target.client_id,
        grants.map((g) => ({ principal_type: g.principal_type, principal_id: g.principal_id }))
      );
      message.success('已保存');
      setOpen(false);
      load();
    } catch (e: any) {
      message.error(e?.response?.data?.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const renderLogo = (app: AppPermApp) => {
    const isImage = app.logo_url && app.logo_url.length > 4;
    return (
      <span
        style={{
          width: 32,
          height: 32,
          borderRadius: 8,
          background: isImage ? '#fff' : '#f1f5fa',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 16,
          overflow: 'hidden',
        }}
      >
        {isImage ? (
          <img src={app.logo_url} alt={app.client_name} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
        ) : app.logo_url ? (
          <span>{app.logo_url}</span>
        ) : (
          <AppstoreOutlined style={{ color: '#94a3b8' }} />
        )}
      </span>
    );
  };

  const groupByType = useMemo(() => {
    const map: Record<PrincipalType, AppGrant[]> = { user: [], role: [], group: [] };
    grants.forEach((g) => {
      map[g.principal_type].push(g);
    });
    return map;
  }, [grants]);

  return (
    <>
      <PageToolbar>
        <Input
          allowClear
          placeholder="搜索应用名称 / Client ID"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          style={{ width: 240 }}
        />
        <Button icon={<ReloadOutlined />} onClick={load}>
          刷新
        </Button>
      </PageToolbar>

      <Card>
        <Table<AppPermApp>
          rowKey="id"
          loading={loading}
          dataSource={filtered}
          pagination={{ pageSize: 10, showSizeChanger: true }}
          columns={[
            {
              title: '应用',
              key: 'app',
              render: (_, r) => (
                <Space>
                  {renderLogo(r)}
                  <div>
                    <div style={{ fontWeight: 500 }}>{r.client_name}</div>
                    <div style={{ fontSize: 12, color: '#94a3b8' }}>
                      <code>{r.client_id}</code>
                    </div>
                  </div>
                </Space>
              ),
            },
            {
              title: '授权范围',
              key: 'range',
              width: 280,
              render: (_, r) =>
                r.granted ? (
                  <Space size={6}>
                    {r.grant_users > 0 && (
                      <Tag color="blue" icon={<UserOutlined />}>
                        {r.grant_users} 用户
                      </Tag>
                    )}
                    {r.grant_roles > 0 && (
                      <Tag color="purple" icon={<SafetyOutlined />}>
                        {r.grant_roles} 角色
                      </Tag>
                    )}
                    {r.grant_groups > 0 && (
                      <Tag color="green" icon={<TeamOutlined />}>
                        {r.grant_groups} 用户组
                      </Tag>
                    )}
                  </Space>
                ) : (
                  <Tag>对所有人开放</Tag>
                ),
            },
            {
              title: '状态',
              dataIndex: 'is_active',
              width: 90,
              render: (v) => (v ? <Tag color="green">启用</Tag> : <Tag>禁用</Tag>),
            },
            {
              title: '操作',
              width: 140,
              render: (_, r) => (
                <Button type="link" size="small" onClick={() => openManage(r)}>
                  管理授权
                </Button>
              ),
            },
          ]}
        />
      </Card>

      <Drawer
        title={
          <Space>
            <AppstoreOutlined style={{ color: '#1677ff' }} />
            <span>管理授权 - {target?.client_name}</span>
          </Space>
        }
        width={640}
        open={open}
        onClose={() => setOpen(false)}
        extra={
          <Space>
            <Button onClick={() => setOpen(false)}>取消</Button>
            <Button type="primary" loading={saving} onClick={handleSave}>
              保存
            </Button>
          </Space>
        }
      >
        <p style={{ color: '#6b7280', marginTop: 0 }}>
          {grants.length === 0
            ? '当前应用对所有人开放。一旦添加至少一条授权，将仅允许列表中的用户/角色/用户组访问。'
            : '仅以下用户/角色/用户组可访问该应用。'}
        </p>

        <Tabs
          items={(['user', 'role', 'group'] as PrincipalType[]).map((type) => ({
            key: type,
            label:
              type === 'user'
                ? `用户 (${groupByType.user.length})`
                : type === 'role'
                ? `角色 (${groupByType.role.length})`
                : `用户组 (${groupByType.group.length})`,
            children: (
              <>
                <div style={{ marginBottom: 12 }}>
                  {adding && addType === type ? (
                    <Space>
                      <Select
                        showSearch
                        placeholder={`选择${type === 'user' ? '用户' : type === 'role' ? '角色' : '用户组'}`}
                        style={{ width: 320 }}
                        value={addId}
                        onChange={setAddId}
                        optionFilterProp="label"
                        options={
                          type === 'user'
                            ? users
                                .filter((u) => !grants.find((g) => g.principal_type === 'user' && g.principal_id === u.id))
                                .map((u) => ({ value: u.id, label: `${u.nickname || u.username} (${u.email || u.username})` }))
                            : type === 'role'
                            ? roles
                                .filter((r) => !grants.find((g) => g.principal_type === 'role' && g.principal_id === r.id))
                                .map((r) => ({ value: r.id, label: r.name }))
                            : groups
                                .filter((g0) => !grants.find((g) => g.principal_type === 'group' && g.principal_id === g0.id))
                                .map((g0) => ({ value: g0.id, label: g0.name }))
                        }
                      />
                      <Button type="primary" onClick={handleAdd}>
                        确定
                      </Button>
                      <Button onClick={() => setAdding(false)}>取消</Button>
                    </Space>
                  ) : (
                    <Button
                      type="dashed"
                      icon={<PlusOutlined />}
                      onClick={() => {
                        setAdding(true);
                        setAddType(type);
                        setAddId(undefined);
                      }}
                    >
                      添加{type === 'user' ? '用户' : type === 'role' ? '角色' : '用户组'}
                    </Button>
                  )}
                </div>
                {groupByType[type].length === 0 ? (
                  <Empty description="尚未授权" />
                ) : (
                  <List
                    dataSource={groupByType[type]}
                    renderItem={(g) => (
                      <List.Item
                        actions={[
                          <Popconfirm key="del" title="移除该授权？" onConfirm={() => handleRemove(g)}>
                            <Button type="link" size="small" danger icon={<DeleteOutlined />}>
                              移除
                            </Button>
                          </Popconfirm>,
                        ]}
                      >
                        <Space>
                          {type === 'user' ? (
                            <UserOutlined style={{ color: '#1677ff' }} />
                          ) : type === 'role' ? (
                            <SafetyOutlined style={{ color: '#8b5cf6' }} />
                          ) : (
                            <TeamOutlined style={{ color: '#10b981' }} />
                          )}
                          <span>{g.principal_name}</span>
                        </Space>
                      </List.Item>
                    )}
                  />
                )}
              </>
            ),
          }))}
        />
      </Drawer>
    </>
  );
}
