import { useEffect, useMemo, useState } from 'react';
import { Form, Radio, Input, Tabs, Tag, Switch, Alert, Empty, Checkbox } from 'antd';
import { SearchOutlined, UserOutlined, ApartmentOutlined, UsergroupAddOutlined } from '@ant-design/icons';
import { get } from '@/api/request';

type Policy = 'all' | 'assigned' | 'none';
type SubjectType = 'user' | 'org' | 'group';

interface Subject {
  type: SubjectType;
  id: string;
  name: string;
  sub?: string; // 副标题（用户名 / 部门路径）
}

const sectionStyle: React.CSSProperties = {
  border: '1px solid #eef0f5',
  borderRadius: 12,
  padding: '20px 28px',
  background: '#fff',
};
const titleStyle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  color: '#1d2c5b',
  marginBottom: 12,
};

export default function Step3AppPerm() {
  const form = Form.useFormInstance();
  const policy: Policy = (Form.useWatch('access_policy', form) as Policy) || 'assigned';
  const grants: Array<{ principal_type: string; principal_id: string; principal_name?: string }> =
    Form.useWatch('grants', form) || [];

  const [tab, setTab] = useState<SubjectType>('user');
  const [keyword, setKeyword] = useState('');
  const [users, setUsers] = useState<Subject[]>([]);
  const [orgs, setOrgs] = useState<Subject[]>([]);
  const [groups, setGroups] = useState<Subject[]>([]);
  const [loading, setLoading] = useState(false);

  // 选中已选集合（用于 checkbox 受控）
  const selectedKey = (s: Subject) => `${s.type}:${s.id}`;
  const selectedSet = useMemo(
    () => new Set(grants.map((g) => `${g.principal_type}:${g.principal_id}`)),
    [grants],
  );

  useEffect(() => {
    if (policy !== 'assigned') return;
    const load = async () => {
      setLoading(true);
      try {
        if (tab === 'user' && users.length === 0) {
          const r: any = await get<any>('/users', { page: 1, page_size: 1000 });
          const list: Subject[] = (r?.items || []).map((u: any) => ({
            type: 'user' as const,
            id: u.id,
            name: u.nickname || u.username,
            sub: u.username,
          }));
          setUsers(list);
        }
        if (tab === 'org' && orgs.length === 0) {
          const r: any = await get<any>('/departments');
          const flatten = (nodes: any[], parents: string[] = []): Subject[] => {
            const out: Subject[] = [];
            for (const n of nodes || []) {
              out.push({
                type: 'org' as const,
                id: n.id,
                name: n.name,
                sub: parents.length ? parents.join(' / ') : '根部门',
              });
              if (n.children?.length) out.push(...flatten(n.children, [...parents, n.name]));
            }
            return out;
          };
          setOrgs(flatten(Array.isArray(r) ? r : []));
        }
        if (tab === 'group' && groups.length === 0) {
          const r: any = await get<any>('/user-groups');
          setGroups(
            (r || []).map((g: any) => ({
              type: 'group' as const,
              id: g.id,
              name: g.name,
              sub: g.description,
            })),
          );
        }
      } finally {
        setLoading(false);
      }
    };
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, policy]);

  const setGrants = (next: Array<{ principal_type: string; principal_id: string; principal_name?: string }>) =>
    form.setFieldValue('grants', next);

  const toggle = (s: Subject, on: boolean) => {
    if (on) {
      if (selectedSet.has(selectedKey(s))) return;
      setGrants([
        ...grants,
        { principal_type: s.type, principal_id: s.id, principal_name: s.name },
      ]);
    } else {
      setGrants(grants.filter((g) => !(g.principal_type === s.type && g.principal_id === s.id)));
    }
  };

  const removeOne = (g: { principal_type: string; principal_id: string }) =>
    setGrants(grants.filter((x) => !(x.principal_type === g.principal_type && x.principal_id === g.principal_id)));

  const list = tab === 'user' ? users : tab === 'org' ? orgs : groups;
  const filtered = useMemo(() => {
    if (!keyword.trim()) return list;
    const k = keyword.trim().toLowerCase();
    return list.filter((s) => s.name.toLowerCase().includes(k) || (s.sub || '').toLowerCase().includes(k));
  }, [list, keyword]);

  const tagColor = (t: string) => (t === 'user' ? 'blue' : t === 'org' ? 'orange' : 'purple');
  const tagLabel = (t: string) => (t === 'user' ? '用户' : t === 'org' ? '组织' : '用户组');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* 隐藏字段（form store） */}
      <Form.Item name="access_policy" hidden initialValue="assigned">
        <Input type="hidden" />
      </Form.Item>
      <Form.Item name="grants" hidden>
        <Input type="hidden" />
      </Form.Item>
      <Form.Item name="visible_in_portal" hidden initialValue={true} valuePropName="checked">
        <Input type="hidden" />
      </Form.Item>
      <Form.Item name="allow_idp_initiated" hidden initialValue={true} valuePropName="checked">
        <Input type="hidden" />
      </Form.Item>
      <Form.Item name="allow_sp_initiated" hidden initialValue={true} valuePropName="checked">
        <Input type="hidden" />
      </Form.Item>

      <Alert
        type="info"
        showIcon
        message="配置哪些用户、组织或用户组可以访问该应用。未授权用户将在应用门户中不可见或无法访问。"
      />

      {/* 一、授权范围 */}
      <div style={sectionStyle}>
        <div style={titleStyle}>授权范围</div>
        <Radio.Group
          value={policy}
          onChange={(e) => {
            const v = e.target.value as Policy;
            form.setFieldValue('access_policy', v);
            if (v !== 'assigned') {
              form.setFieldValue('grants', []);
            }
          }}
          style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
        >
          <Radio value="all">
            <div style={{ display: 'inline-block' }}>
              <div style={{ fontSize: 14, color: '#1d2c5b', fontWeight: 500 }}>所有人可访问</div>
              <div style={{ fontSize: 12, color: '#94a3b8' }}>企业内所有用户均可访问该应用</div>
            </div>
          </Radio>
          <Radio value="assigned">
            <div style={{ display: 'inline-block' }}>
              <div style={{ fontSize: 14, color: '#1d2c5b', fontWeight: 500 }}>指定用户 / 组织 / 用户组可访问</div>
              <div style={{ fontSize: 12, color: '#94a3b8' }}>仅指定的用户、组织或用户组可以访问该应用</div>
            </div>
          </Radio>
          <Radio value="none">
            <div style={{ display: 'inline-block' }}>
              <div style={{ fontSize: 14, color: '#1d2c5b', fontWeight: 500 }}>暂不授权</div>
              <div style={{ fontSize: 12, color: '#94a3b8' }}>暂不分配访问权限，后续可在应用设置中配置</div>
            </div>
          </Radio>
        </Radio.Group>
      </div>

      {/* 二、授权对象（仅 assigned） */}
      {policy === 'assigned' && (
        <div style={sectionStyle}>
          <div style={titleStyle}>授权对象</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
            {/* 左：搜索 + Tab + 列表 */}
            <div style={{ border: '1px solid #eef0f5', borderRadius: 8, padding: 12, minHeight: 320 }}>
              <Input
                allowClear
                placeholder="搜索用户、组织、用户组"
                prefix={<SearchOutlined style={{ color: '#94a3b8' }} />}
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                style={{ marginBottom: 10 }}
              />
              <Tabs
                size="small"
                activeKey={tab}
                onChange={(k) => setTab(k as SubjectType)}
                items={[
                  { key: 'user', label: <span><UserOutlined /> 用户</span> },
                  { key: 'org', label: <span><ApartmentOutlined /> 组织</span> },
                  { key: 'group', label: <span><UsergroupAddOutlined /> 用户组</span> },
                ]}
              />
              <div style={{ maxHeight: 280, overflowY: 'auto', marginTop: 4 }}>
                {loading ? (
                  <div style={{ color: '#94a3b8', fontSize: 12, padding: 20, textAlign: 'center' }}>加载中…</div>
                ) : filtered.length === 0 ? (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description={<span style={{ color: '#94a3b8', fontSize: 12 }}>请搜索并选择用户、组织或用户组</span>}
                    style={{ marginTop: 24 }}
                  />
                ) : (
                  filtered.map((s) => {
                    const checked = selectedSet.has(selectedKey(s));
                    return (
                      <label
                        key={selectedKey(s)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          padding: '8px 6px',
                          borderRadius: 6,
                          cursor: 'pointer',
                          background: checked ? '#eff6ff' : 'transparent',
                        }}
                      >
                        <Checkbox checked={checked} onChange={(e) => toggle(s, e.target.checked)} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, color: '#1d2c5b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {s.name}
                          </div>
                          {s.sub && (
                            <div style={{ fontSize: 11, color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {s.sub}
                            </div>
                          )}
                        </div>
                      </label>
                    );
                  })
                )}
              </div>
            </div>

            {/* 右：已选择 */}
            <div style={{ border: '1px solid #eef0f5', borderRadius: 8, padding: 12, minHeight: 320 }}>
              <div style={{ fontSize: 13, color: '#1d2c5b', fontWeight: 600, marginBottom: 10 }}>
                已选择 <span style={{ color: '#94a3b8', fontWeight: 400 }}>（{grants.length}）</span>
              </div>
              {grants.length === 0 ? (
                <div style={{ color: '#94a3b8', fontSize: 12, marginTop: 30, textAlign: 'center' }}>
                  尚未选择任何对象
                </div>
              ) : (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {grants.map((g) => (
                    <Tag
                      key={`${g.principal_type}:${g.principal_id}`}
                      color={tagColor(g.principal_type)}
                      closable
                      onClose={() => removeOne(g)}
                      style={{ padding: '4px 8px', fontSize: 12 }}
                    >
                      <span style={{ opacity: 0.7, marginRight: 4 }}>{tagLabel(g.principal_type)}</span>
                      {g.principal_name || g.principal_id}
                    </Tag>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 三、访问控制 */}
      <div style={sectionStyle}>
        <div style={titleStyle}>访问控制</div>
        <Form.Item shouldUpdate noStyle>
          {() => (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                <Switch
                  checked={!!form.getFieldValue('visible_in_portal')}
                  onChange={(v) => form.setFieldValue('visible_in_portal', v)}
                />
                <div>
                  <div style={{ fontSize: 14, color: '#1d2c5b', fontWeight: 500 }}>在应用门户中显示</div>
                  <div style={{ fontSize: 12, color: '#94a3b8' }}>
                    在 OneAuth 应用门户中展示该应用，方便用户发现和访问
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                <Switch
                  checked={!!form.getFieldValue('allow_idp_initiated')}
                  onChange={(v) => form.setFieldValue('allow_idp_initiated', v)}
                />
                <div>
                  <div style={{ fontSize: 14, color: '#1d2c5b', fontWeight: 500 }}>允许从 OneAuth 发起访问</div>
                  <div style={{ fontSize: 12, color: '#94a3b8' }}>
                    用户可以从 OneAuth 应用门户或我的应用中点击进入该应用
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                <Switch
                  checked={!!form.getFieldValue('allow_sp_initiated')}
                  onChange={(v) => form.setFieldValue('allow_sp_initiated', v)}
                />
                <div>
                  <div style={{ fontSize: 14, color: '#1d2c5b', fontWeight: 500 }}>允许应用侧发起 SSO 登录</div>
                  <div style={{ fontSize: 12, color: '#94a3b8' }}>
                    允许用户从业务系统跳转到 OneAuth 完成 SSO 登录，如 OIDC、SAML、CAS 的 SP-Initiated 登录
                  </div>
                </div>
              </div>
            </div>
          )}
        </Form.Item>
      </div>
    </div>
  );
}
