import { useEffect, useMemo, useState } from 'react';
import { Form, Radio, Select, Alert, Tag, Input } from 'antd';
import { UserOutlined, TeamOutlined, ApartmentOutlined, GlobalOutlined } from '@ant-design/icons';
import request from '@/api/request';

type Mode = 'public' | 'user' | 'group' | 'org';

type Option = { id: string; name: string; sub?: string };

/**
 * 应用授权步骤。
 *
 * 表单字段：
 *   grant_mode: 'public' | 'user' | 'group' | 'org'
 *   grants:    Array<{ principal_type, principal_id, principal_name }>
 *
 * 选 public 时清空 grants；其他模式下把多选转成 grants 数组。
 */
export default function Step3AppPerm() {
  const form = Form.useFormInstance();
  const [users, setUsers] = useState<Option[]>([]);
  const [groups, setGroups] = useState<Option[]>([]);
  const [orgs, setOrgs] = useState<Option[]>([]);
  const [loading, setLoading] = useState(false);

  const mode: Mode = (Form.useWatch('grant_mode', form) as Mode) || 'public';
  const grants: Array<{ principal_type: string; principal_id: string; principal_name?: string }> =
    Form.useWatch('grants', form) || [];

  // 当前模式下被选中的 id 列表（受控）
  const selectedIds = useMemo(
    () => grants.filter((g) => g.principal_type === mode).map((g) => g.principal_id),
    [grants, mode],
  );

  // 加载选项（懒加载，按需）
  useEffect(() => {
    const fetchUsers = async () => {
      if (users.length > 0) return;
      setLoading(true);
      try {
        const r: any = await request.get('/users', { params: { page: 1, page_size: 1000 } });
        const list = (r?.items || []).map((u: any) => ({
          id: u.id,
          name: u.nickname || u.username,
          sub: u.username,
        }));
        setUsers(list);
      } finally {
        setLoading(false);
      }
    };
    const fetchGroups = async () => {
      if (groups.length > 0) return;
      setLoading(true);
      try {
        const r: any = await request.get('/user-groups');
        setGroups((r || []).map((g: any) => ({ id: g.id, name: g.name, sub: g.description })));
      } finally {
        setLoading(false);
      }
    };
    const fetchOrgs = async () => {
      if (orgs.length > 0) return;
      setLoading(true);
      try {
        const r: any = await request.get('/departments');
        // 部门接口返回的是树或数组，铺平
        const flatten = (nodes: any[], parents: string[] = []): Option[] => {
          const out: Option[] = [];
          for (const n of nodes || []) {
            const path = [...parents, n.name];
            out.push({ id: n.id, name: n.name, sub: parents.length ? parents.join(' / ') : '根部门' });
            if (n.children?.length) out.push(...flatten(n.children, path));
          }
          return out;
        };
        setOrgs(flatten(Array.isArray(r) ? r : []));
      } finally {
        setLoading(false);
      }
    };
    if (mode === 'user') fetchUsers();
    if (mode === 'group') fetchGroups();
    if (mode === 'org') fetchOrgs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const handleChange = (ids: string[]) => {
    let pool: Option[] = [];
    if (mode === 'user') pool = users;
    if (mode === 'group') pool = groups;
    if (mode === 'org') pool = orgs;
    const nameById = new Map(pool.map((o) => [o.id, o.name]));
    const next = ids.map((id) => ({
      principal_type: mode,
      principal_id: id,
      principal_name: nameById.get(id) || id,
    }));
    form.setFieldValue('grants', next);
  };

  const cardStyle: React.CSSProperties = {
    border: '1px solid #eef0f5',
    borderRadius: 12,
    padding: '24px 32px',
    background: '#fff',
  };

  const optionList = mode === 'user' ? users : mode === 'group' ? groups : mode === 'org' ? orgs : [];

  return (
    <div style={cardStyle}>
      {/* 隐藏字段：grant_mode + grants 由本组件主动 setFieldValue 写入 */}
      <Form.Item name="grant_mode" hidden initialValue="public">
        <Input type="hidden" />
      </Form.Item>
      <Form.Item name="grants" hidden>
        <Input type="hidden" />
      </Form.Item>

      <div style={{ fontSize: 14, color: '#1d2c5b', fontWeight: 600, marginBottom: 12 }}>
        授权范围
      </div>
      <Radio.Group
        value={mode}
        onChange={(e) => {
          const next = e.target.value as Mode;
          form.setFieldValue('grant_mode', next);
          // 切换模式时清空已选（不同模式 principal_id 含义不同）
          form.setFieldValue('grants', []);
        }}
        style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}
      >
        <Radio value="public">
          <Tag icon={<GlobalOutlined />} color="green" style={{ marginRight: 8 }}>全部</Tag>
          所有登录用户均可访问该应用（公开应用）
        </Radio>
        <Radio value="user">
          <Tag icon={<UserOutlined />} color="blue" style={{ marginRight: 8 }}>按用户授权</Tag>
          指定具体用户访问
        </Radio>
        <Radio value="group">
          <Tag icon={<TeamOutlined />} color="purple" style={{ marginRight: 8 }}>按用户组授权</Tag>
          指定用户组，组内成员均可访问
        </Radio>
        <Radio value="org">
          <Tag icon={<ApartmentOutlined />} color="orange" style={{ marginRight: 8 }}>按组织授权</Tag>
          指定组织 / 部门，部门下用户均可访问
        </Radio>
      </Radio.Group>

      {mode !== 'public' && (
        <>
          <div style={{ fontSize: 13, color: '#475569', fontWeight: 500, marginBottom: 8 }}>
            {mode === 'user' && '选择用户'}
            {mode === 'group' && '选择用户组'}
            {mode === 'org' && '选择组织'}
          </div>
          <Select
            mode="multiple"
            allowClear
            showSearch
            value={selectedIds}
            onChange={handleChange}
            loading={loading}
            placeholder={
              mode === 'user' ? '搜索用户名 / 昵称' : mode === 'group' ? '搜索用户组名称' : '搜索组织名称'
            }
            style={{ width: '100%' }}
            optionFilterProp="label"
            options={optionList.map((o) => ({
              value: o.id,
              label: o.sub ? `${o.name}（${o.sub}）` : o.name,
            }))}
          />
          <div style={{ marginTop: 8, fontSize: 12, color: '#94a3b8' }}>
            已选 {selectedIds.length} 项
          </div>
        </>
      )}

      {mode === 'public' && (
        <Alert
          type="info"
          showIcon
          style={{ marginTop: 8 }}
          message="公开应用：所有登录到 OneAuth 的用户都能在门户看到并访问该应用"
        />
      )}
    </div>
  );
}
