import { useEffect, useMemo, useState } from 'react';
import { App as AntdApp, AutoComplete, Button, Card, Empty, Form, Input, Select, Space, Statistic, Switch, Table, TreeSelect } from 'antd';
import { PlayCircleOutlined, ReloadOutlined, SaveOutlined } from '@ant-design/icons';
import {
  directorySyncApi,
  type DirectoryDepartment,
  type DirectorySyncConfig,
  type DirectorySyncLog,
  type DirectorySyncSummary,
} from '@/api/directorySync';
import { orgApi, type Department } from '@/api/misc';
import { cardStyle, footerStyle, SectionHead } from './_shared';

const defaultMapping: Record<string, string> = {
  external_id: 'externalId',
  username: 'userId',
  nickname: 'userName',
  email: 'email',
  phone: 'phone',
  position: 'position',
  department_path: 'departmentPath',
  department_paths: 'departmentPaths',
  active: 'isActive',
};

const mappingRows = [
  { key: 'external_id', label: '外部唯一 ID', required: true },
  { key: 'username', label: '登录账号来源', required: true },
  { key: 'nickname', label: '姓名' },
  { key: 'email', label: '邮箱' },
  { key: 'phone', label: '手机号' },
  { key: 'position', label: '职位' },
  { key: 'department_path', label: '主部门路径' },
  { key: 'department_paths', label: '多部门路径' },
  { key: 'active', label: '在职状态' },
];

const remoteFieldOptions = [
  'externalId',
  'userId',
  'userName',
  'name',
  'email',
  'phone',
  'mobile',
  'position',
  'department',
  'departmentPath',
  'departmentPaths',
  'isActive',
  'active',
  'officeCity',
].map((v) => ({ label: v, value: v }));

function deptTreeData(list: DirectoryDepartment[]): any[] {
  return list.map((d) => ({
    title: d.name,
    value: d.path,
    key: d.path,
    children: d.children?.length ? deptTreeData(d.children) : undefined,
  }));
}

function localDeptTreeData(list: Department[]): any[] {
  return list.map((d) => ({
    title: d.name,
    value: d.id,
    key: d.id,
    children: d.children?.length ? localDeptTreeData(d.children) : undefined,
  }));
}

function emptyConfig(): DirectorySyncConfig {
  return {
    enabled: false,
    platform_type: 'wecom_attendance',
    base_url: '',
    api_key: '',
    selected_department_paths: [],
    strip_prefix: '',
    mount_department_id: '',
    deactivate_missing: true,
    username_strategy: 'smart_pinyin',
    field_mapping: defaultMapping,
  };
}

function generateApiKey() {
  const bytes = new Uint8Array(24);
  if (window.crypto?.getRandomValues) {
    window.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  let binary = '';
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return `oa_${window.btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')}`;
}

export default function DirectorySyncPanel() {
  const { message, modal } = AntdApp.useApp();
  const [form] = Form.useForm<DirectorySyncConfig>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadingRemote, setLoadingRemote] = useState(false);
  const [syncing, setSyncing] = useState<'preview' | 'run' | null>(null);
  const [remoteDepartments, setRemoteDepartments] = useState<DirectoryDepartment[]>([]);
  const [localDepartments, setLocalDepartments] = useState<Department[]>([]);
  const [summary, setSummary] = useState<DirectorySyncSummary | null>(null);
  const [logs, setLogs] = useState<DirectorySyncLog[]>([]);

  const remoteTree = useMemo(() => deptTreeData(remoteDepartments), [remoteDepartments]);
  const localTree = useMemo(() => localDeptTreeData(localDepartments), [localDepartments]);

  const fillGeneratedApiKey = () => {
    form.setFieldValue('api_key', generateApiKey());
    message.success('已生成 API Key，请同步配置到企微后台授权列表');
  };

  const load = async () => {
    setLoading(true);
    try {
      const [cfg, depts, syncLogs] = await Promise.all([
        directorySyncApi.config(),
        orgApi.tree(),
        directorySyncApi.logs(),
      ]);
      form.setFieldsValue({ ...emptyConfig(), ...cfg, api_key: '', field_mapping: { ...defaultMapping, ...cfg.field_mapping } });
      setLocalDepartments(depts);
      setLogs(syncLogs);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveConfig = async () => {
    const values = await form.validateFields();
    setSaving(true);
    try {
      const saved = await directorySyncApi.saveConfig({
        ...emptyConfig(),
        ...values,
        selected_department_paths: values.selected_department_paths || [],
        field_mapping: { ...defaultMapping, ...(values.field_mapping || {}) },
      });
      form.setFieldsValue({ ...saved, api_key: '', field_mapping: { ...defaultMapping, ...saved.field_mapping } });
      message.success('已保存');
    } finally {
      setSaving(false);
    }
  };

  const loadRemoteDepartments = async () => {
    await saveConfig();
    setLoadingRemote(true);
    try {
      const depts = await directorySyncApi.departments();
      setRemoteDepartments(depts);
      message.success('已拉取部门');
    } finally {
      setLoadingRemote(false);
    }
  };

  const doPreview = async () => {
    await saveConfig();
    setSyncing('preview');
    try {
      const r = await directorySyncApi.preview();
      setSummary(r);
    } finally {
      setSyncing(null);
    }
  };

  const doRun = async () => {
    await saveConfig();
    modal.confirm({
      title: '确认执行通讯录同步？',
      content: '同步会创建或更新部门与用户，并按配置禁用远端缺失的已同步用户。',
      okText: '执行同步',
      onOk: async () => {
        setSyncing('run');
        try {
          const r = await directorySyncApi.run();
          setSummary(r);
          setLogs(await directorySyncApi.logs());
          message.success('同步完成');
        } finally {
          setSyncing(null);
        }
      },
    });
  };

  if (loading) {
    return <Card><div style={{ minHeight: 360 }} /></Card>;
  }

  return (
    <Form form={form} layout="vertical" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={cardStyle}>
        <SectionHead title="连接配置" />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', columnGap: 32 }}>
          <Form.Item label="启用同步" name="enabled" valuePropName="checked">
            <Switch checkedChildren="启用" unCheckedChildren="禁用" />
          </Form.Item>
          <Form.Item label="平台类型" name="platform_type">
            <Select options={[{ label: '企微后台通讯录', value: 'wecom_attendance' }]} />
          </Form.Item>
          <Form.Item label="第三方平台地址" name="base_url" rules={[{ required: true, message: '请输入第三方平台地址' }]}>
            <Input placeholder="https://north-maxkb2.fit2cloud.cn:8666/attendance" />
          </Form.Item>
          <Form.Item label="API Key" extra="可以在这里生成，然后复制到企微后台「SSO 接入」中授权。保存后留空表示不修改已保存 Key。">
            <Space.Compact style={{ width: '100%' }}>
              <Form.Item name="api_key" noStyle>
                <Input.Password placeholder="保存后留空表示不修改" autoComplete="new-password" />
              </Form.Item>
              <Button onClick={fillGeneratedApiKey}>生成</Button>
            </Space.Compact>
          </Form.Item>
          <Form.Item label="远端缺失用户" name="deactivate_missing" valuePropName="checked">
            <Switch checkedChildren="自动禁用" unCheckedChildren="保留" />
          </Form.Item>
          <Form.Item label="用户名策略" name="username_strategy">
            <Select
              options={[
                { label: '智能生成：大小写转小写，数字 ID 转姓名拼音', value: 'smart_pinyin' },
                { label: '始终使用姓名拼音', value: 'pinyin' },
                { label: '使用来源账号小写', value: 'source_lower' },
              ]}
            />
          </Form.Item>
        </div>
      </div>

      <div style={cardStyle}>
        <SectionHead title="同步范围" />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', columnGap: 32 }}>
          <Form.Item label="裁剪部门前缀" name="strip_prefix">
            <Input placeholder="杭州飞致云信息科技有限公司/KA 事业部" />
          </Form.Item>
          <Form.Item label="挂载到本地部门" name="mount_department_id">
            <TreeSelect allowClear showSearch treeDefaultExpandAll treeNodeFilterProp="title" placeholder="根目录" treeData={localTree} />
          </Form.Item>
        </div>
        <div style={{ marginBottom: 12 }}>
          <Button loading={loadingRemote} onClick={loadRemoteDepartments}>
            保存并拉取远端部门
          </Button>
        </div>
        <Form.Item label="同步部门" name="selected_department_paths" rules={[{ required: true, message: '请选择同步部门' }]}>
          <TreeSelect
            treeCheckable
            showCheckedStrategy={TreeSelect.SHOW_PARENT}
            showSearch
            treeDefaultExpandAll
            treeNodeFilterProp="title"
            placeholder="可多选远端大部门"
            treeData={remoteTree}
            notFoundContent={<Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="请先拉取远端部门" />}
          />
        </Form.Item>
      </div>

      <div style={cardStyle}>
        <SectionHead title="字段映射" />
        <Form.Item style={{ marginBottom: 0 }}>
          <Table
            rowKey="key"
            pagination={false}
            dataSource={mappingRows}
            columns={[
              { title: 'OneAuth 字段', dataIndex: 'label', width: 220 },
              {
                title: '第三方字段',
                render: (_, row) => (
                  <Form.Item
                    name={['field_mapping', row.key]}
                    rules={row.required ? [{ required: true, message: '请选择或输入字段' }] : undefined}
                    style={{ marginBottom: 0 }}
                  >
                    <AutoComplete options={remoteFieldOptions} placeholder="选择或输入字段" />
                  </Form.Item>
                ),
              },
            ]}
          />
        </Form.Item>
      </div>

      {summary && (
        <Card title={summary.dry_run ? '预览结果' : '同步结果'}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, minmax(0, 1fr))', gap: 16 }}>
            <Statistic title="新增部门" value={summary.department_created} />
            <Statistic title="匹配部门" value={summary.department_matched} />
            <Statistic title="新增用户" value={summary.user_created} />
            <Statistic title="更新用户" value={summary.user_updated} />
            <Statistic title="禁用用户" value={summary.user_disabled} />
            <Statistic title="跳过用户" value={summary.user_skipped} />
          </div>
          {summary.details?.length > 0 && (
            <div style={{ marginTop: 16, padding: '12px 14px', border: '1px solid #fee2e2', background: '#fff7f7', color: '#b42318', fontSize: 13, lineHeight: 1.8 }}>
              {summary.details.slice(0, 8).map((d) => (
                <div key={d}>{d}</div>
              ))}
            </div>
          )}
        </Card>
      )}

      <Card title="最近同步记录">
        <Table
          rowKey="id"
          dataSource={logs}
          pagination={false}
          columns={[
            { title: '时间', dataIndex: 'started_at', render: (v) => v ? new Date(v).toLocaleString('zh-CN', { hour12: false }) : '-' },
            { title: '状态', dataIndex: 'status' },
            { title: '模式', dataIndex: 'dry_run', render: (v) => v ? '预览' : '正式' },
            { title: '新增部门', dataIndex: 'department_created' },
            { title: '新增用户', dataIndex: 'user_created' },
            { title: '更新用户', dataIndex: 'user_updated' },
            { title: '禁用用户', dataIndex: 'user_disabled' },
            { title: '消息', dataIndex: 'message', render: (v) => v || '-' },
          ]}
        />
      </Card>

      <div style={footerStyle}>
        <Button icon={<ReloadOutlined />} onClick={load}>
          刷新
        </Button>
        <Space wrap>
          <Button onClick={loadRemoteDepartments} loading={loadingRemote}>
            保存并拉取远端部门
          </Button>
          <Button icon={<PlayCircleOutlined />} loading={syncing === 'preview'} onClick={doPreview}>
            预览同步
          </Button>
          <Button type="primary" loading={syncing === 'run'} onClick={doRun}>
            立即同步
          </Button>
          <Button icon={<SaveOutlined />} loading={saving} onClick={saveConfig}>
            保存配置
          </Button>
        </Space>
      </div>
    </Form>
  );
}
