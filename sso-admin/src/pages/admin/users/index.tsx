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
  Switch,
  Popconfirm,
  Select,
  Drawer,
  Row,
  Col,
  Upload,
  Checkbox,
  App as AntdApp,
} from 'antd';
import {
  PlusOutlined,
  ReloadOutlined,
  LockOutlined,
  UnlockOutlined,
  KeyOutlined,
  UploadOutlined,
  ImportOutlined,
  DownloadOutlined,
} from '@ant-design/icons';
import { usersApi, type User, type ImportUsersResult } from '@/api/users';
import { orgApi, roleApi, type Department, type Role } from '@/api/misc';
import PageToolbar from '@/components/PageToolbar';
import UserAvatar from '@/components/UserAvatar';
import { useAuthStore } from '@/store/authStore';

function randomPassword(length = 12): string {
  const upper = 'ABCDEFGHJKMNPQRSTUVWXYZ';
  const lower = 'abcdefghjkmnpqrstuvwxyz';
  const digit = '23456789';
  const symbol = '!@#$%^&*';
  const all = upper + lower + digit + symbol;
  const pick = (s: string) => s[Math.floor(Math.random() * s.length)];
  let out = pick(upper) + pick(lower) + pick(digit) + pick(symbol);
  for (let i = 4; i < length; i++) out += pick(all);
  return out
    .split('')
    .sort(() => Math.random() - 0.5)
    .join('');
}

export default function UserListPage() {
  const { message, modal } = AntdApp.useApp();
  const [data, setData] = useState<User[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [pagination, setPagination] = useState({ current: 1, pageSize: 10 });

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importResult, setImportResult] = useState<ImportUsersResult | null>(null);
  const [importing, setImporting] = useState(false);
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);
  const [form] = Form.useForm();
  const accessToken = useAuthStore((s) => s.accessToken);

  const [depts, setDepts] = useState<Department[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);


  const flatDept = (list: Department[], depth = 0): Array<{ id: string; label: string }> => {
    const result: Array<{ id: string; label: string }> = [];
    for (const d of list) {
      result.push({ id: d.id, label: '— '.repeat(depth) + d.name });
      if (d.children?.length) result.push(...flatDept(d.children, depth + 1));
    }
    return result;
  };

  const load = () => {
    setLoading(true);
    usersApi
      .list({
        page: pagination.current,
        page_size: pagination.pageSize,
        username: keyword,
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

  useEffect(() => {
    orgApi.tree().then(setDepts);
    roleApi.list().then(setRoles);
  }, []);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ is_active: true, is_admin: false });
    setModalOpen(true);
  };

  const openEdit = (u: User) => {
    setEditing(u);
    const superAdminRoleID = roles.find((r) => r.code === 'super_admin')?.id;
    const userRoles = u.roles || [];
    form.setFieldsValue({
      ...u,
      is_admin: !!superAdminRoleID && userRoles.some((r) => r.id === superAdminRoleID),
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    const values = await form.validateFields();
    const superAdminRoleID = roles.find((r) => r.code === 'super_admin')?.id;
    const payload: any = { ...values };
    delete payload.is_admin;
    payload.role_ids = values.is_admin && superAdminRoleID ? [superAdminRoleID] : [];
    // Select allowClear 清空后 form 给的是 undefined → JSON 里直接缺字段 → 后端
    // *DepartmentID == nil 跳过更新。改用全零 UUID 当哨兵，后端识别后真清空。
    if (editing && payload.department_id === undefined) {
      payload.department_id = '00000000-0000-0000-0000-000000000000';
    }
    try {
      if (editing) {
        await usersApi.update(editing.id, payload);
        message.success('已更新');
      } else {
        await usersApi.create(payload);
        message.success('已创建');
      }
      setModalOpen(false);
      load();
    } catch (e: any) {
      message.error(e?.response?.data?.message || '保存失败');
    }
  };

  const handleDelete = async (u: User) => {
    await usersApi.delete(u.id);
    message.success('已删除');
    load();
  };

  const handleBatchDelete = () => {
    if (selectedRowKeys.length === 0) return;
    modal.confirm({
      title: `确认删除选中的 ${selectedRowKeys.length} 个用户？`,
      content: '删除后不可恢复，关联角色与会话也会一并清理。',
      okType: 'danger',
      onOk: async () => {
        try {
          const r = await usersApi.batchDelete(selectedRowKeys);
          if (r.failed.length === 0) {
            message.success(`已删除 ${r.deleted} 个用户`);
          } else {
            message.warning(`删除 ${r.deleted} 成功，${r.failed.length} 失败`);
          }
          setSelectedRowKeys([]);
          load();
        } catch (e: any) {
          message.error(e?.response?.data?.message || '批量删除失败');
        }
      },
    });
  };

  const handleLock = async (u: User) => {
    await usersApi.lock(u.id, !u.is_locked);
    message.success(u.is_locked ? '已解锁' : '已锁定');
    load();
  };

  const handleResetPwd = (u: User) => {
    let val = '';
    modal.confirm({
      title: `重置 ${u.username} 的密码`,
      content: (
        <Input.Password
          placeholder="新密码（至少 8 位，含 2 类字符）"
          onChange={(e) => (val = e.target.value)}
        />
      ),
      onOk: async () => {
        if (val.length < 8) {
          message.error('密码长度至少 8 位');
          return Promise.reject();
        }
        await usersApi.resetPassword(u.id, val);
        message.success('已重置');
      },
    });
  };

  return (
    <>
      <PageToolbar>
        <Input
          placeholder="搜索登录账号"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onPressEnter={load}
          allowClear
          style={{ width: 220 }}
        />
        <Button icon={<ReloadOutlined />} onClick={load}>
          刷新
        </Button>
        <Button icon={<ImportOutlined />} onClick={() => { setImportResult(null); setImportOpen(true); }}>
          批量导入
        </Button>
        <Button
          danger
          disabled={selectedRowKeys.length === 0}
          onClick={handleBatchDelete}
        >
          批量删除{selectedRowKeys.length > 0 ? `（${selectedRowKeys.length}）` : ''}
        </Button>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          新建用户
        </Button>
      </PageToolbar>
      <Card>
      <Table
        rowKey="id"
        loading={loading}
        dataSource={data}
        scroll={{ x: 1100 }}
        rowSelection={{
          selectedRowKeys,
          onChange: (keys) => setSelectedRowKeys(keys as string[]),
        }}
        pagination={{
          current: pagination.current,
          pageSize: pagination.pageSize,
          total,
          showSizeChanger: true,
          onChange: (page, pageSize) => setPagination({ current: page, pageSize }),
        }}
        columns={[
          { title: '登录账号', dataIndex: 'username', width: 140 },
          { title: '姓名', dataIndex: 'nickname', width: 140 },
          { title: '邮箱', dataIndex: 'email', width: 200, render: (v) => v || '-' },
          {
            title: '部门',
            dataIndex: ['department', 'name'],
            width: 140,
            render: (_, r) => r.department?.name || '-',
          },
          {
            title: '管理员',
            dataIndex: 'is_staff',
            width: 90,
            render: (v) => (v ? <Tag color="purple">是</Tag> : <Tag>否</Tag>),
          },
          {
            title: '状态',
            width: 100,
            render: (_, r) =>
              r.is_locked ? (
                <Tag color="red">锁定</Tag>
              ) : r.is_active ? (
                <Tag color="green">正常</Tag>
              ) : (
                <Tag>禁用</Tag>
              ),
          },
          {
            title: '最后登录',
            dataIndex: 'last_login',
            width: 160,
            render: (v: string | null) =>
              v ? new Date(v).toLocaleString('zh-CN', { hour12: false }) : '—',
          },
          {
            title: '操作',
            width: 280,
            fixed: 'right',
            render: (_, r) => (
              <Space size="small">
                <Button type="link" size="small" onClick={() => openEdit(r)}>
                  编辑
                </Button>
                <Button
                  type="link"
                  size="small"
                  icon={<KeyOutlined />}
                  onClick={() => handleResetPwd(r)}
                >
                  重置密码
                </Button>
                <Button
                  type="link"
                  size="small"
                  icon={r.is_locked ? <UnlockOutlined /> : <LockOutlined />}
                  onClick={() => handleLock(r)}
                >
                  {r.is_locked ? '解锁' : '锁定'}
                </Button>
                <Popconfirm title={`确认删除 ${r.username}？`} onConfirm={() => handleDelete(r)}>
                  <Button type="link" size="small" danger>
                    删除
                  </Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />

      <Drawer
        title={editing ? '编辑用户' : '新增'}
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        width={760}
        destroyOnClose
        extra={
          <Space>
            <Button onClick={() => setModalOpen(false)}>关闭</Button>
            <Button type="primary" onClick={handleSave}>
              提交
            </Button>
          </Space>
        }
      >
        <Form
          form={form}
          layout="vertical"
          initialValues={{
            is_active: true,
            user_type: 'internal',
          }}
        >
          <Row gutter={24}>
            <Col span={14}>
              {!editing && (
                <Form.Item
                  name="username"
                  label="登录账号"
                  rules={[{ required: true, message: '请输入登录账号' }]}
                  extra="登录账号为唯一标识，创建后不可更改"
                >
                  <Input placeholder="字母/数字/点/下划线" />
                </Form.Item>
              )}
              {!editing && (
                <Form.Item
                  name="nickname"
                  label="姓名"
                  rules={[{ required: true, message: '请输入姓名' }]}
                >
                  <Input placeholder="请输入姓名" />
                </Form.Item>
              )}
              {editing && (
                <Form.Item name="nickname" label="姓名">
                  <Input placeholder="请输入姓名" />
                </Form.Item>
              )}
              {!editing && (
                <Form.Item
                  name="password"
                  label="密码"
                  rules={[{ required: true, min: 8, message: '至少 8 位' }]}
                >
                  <Input.Password
                    placeholder="new password"
                    addonAfter={
                      <Button
                        size="small"
                        type="primary"
                        style={{ marginRight: -8 }}
                        onClick={() =>
                          form.setFieldValue('password', randomPassword(12))
                        }
                      >
                        生成
                      </Button>
                    }
                  />
                </Form.Item>
              )}
              <Form.Item name="phone" label="手机号码">
                <Input />
              </Form.Item>
            </Col>
            <Col span={10}>
              <Form.Item name="avatar" label="头像">
                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                  <Form.Item
                    noStyle
                    shouldUpdate={(p, n) =>
                      p.avatar !== n.avatar || p.nickname !== n.nickname || p.username !== n.username
                    }
                  >
                    {({ getFieldValue }) => {
                      const av = (getFieldValue('avatar') as string | undefined) || '';
                      const nm =
                        (getFieldValue('nickname') as string | undefined) ||
                        (getFieldValue('username') as string | undefined) ||
                        '新用户';
                      return <UserAvatar src={av} name={nm} size={72} />;
                    }}
                  </Form.Item>
                  <Upload
                    name="file"
                    action="/api/v1/configs/upload-image"
                    headers={{ Authorization: `Bearer ${accessToken}` }}
                    data={{ prefix: 'avatar' }}
                    accept=".png,.jpg,.jpeg,.webp,.gif"
                    showUploadList={false}
                    beforeUpload={(file) => {
                      if (file.size > 5 * 1024 * 1024) {
                        message.error('头像不能超过 5MB');
                        return Upload.LIST_IGNORE;
                      }
                      return true;
                    }}
                    onChange={(info) => {
                      if (info.file.status === 'done') {
                        const url = info.file.response?.data?.url;
                        if (url) {
                          form.setFieldValue('avatar', url);
                          message.success('头像已上传');
                        }
                      } else if (info.file.status === 'error') {
                        message.error(info.file.response?.message || '上传失败');
                      }
                    }}
                  >
                    <Button icon={<UploadOutlined />}>Upload</Button>
                  </Upload>
                </div>
              </Form.Item>
            </Col>

            <Col span={12}>
              <Form.Item name="email" label="电子邮箱">
                <Input />
              </Form.Item>
            </Col>

            <Col span={12}>
              <Form.Item name="department_id" label="所属部门">
                <Select
                  allowClear
                  placeholder="选择部门"
                  options={flatDept(depts).map((d) => ({ value: d.id, label: d.label }))}
                />
              </Form.Item>
            </Col>

            <Col span={12}>
              <Form.Item
                name="user_type"
                label="用户类型"
                rules={[{ required: true }]}
              >
                <Select
                  options={[
                    { value: 'internal', label: '内部员工' },
                    { value: 'external', label: '外部协作' },
                  ]}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="is_active"
                label="状态"
                valuePropName="checked"
                rules={[{ required: true }]}
              >
                <Switch checkedChildren="活动" unCheckedChildren="禁用" />
              </Form.Item>
            </Col>

            <Col span={24}>
              <Form.Item
                name="is_admin"
                label="管理员权限"
                valuePropName="checked"
                extra="勾选后该用户可登录 OneAuth 管理后台；不勾默认为普通用户，仅能访问已授权应用。"
              >
                <Checkbox>授予管理员权限</Checkbox>
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Drawer>

      <Modal
        title="批量导入用户"
        open={importOpen}
        onCancel={() => { setImportOpen(false); setImportResult(null); }}
        footer={null}
        width={640}
        destroyOnClose
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ background: '#f8fafc', padding: 12, borderRadius: 6, border: '1px solid #e2e8f0' }}>
            <div style={{ fontSize: 13, color: '#475569', lineHeight: 1.7 }}>
              先下载模板填好再上传，**带 <span style={{ color: '#ef4444' }}>*</span> 的列必填**：
              <br />
              · 登录账号<span style={{ color: '#ef4444' }}>*</span> · 姓名<span style={{ color: '#ef4444' }}>*</span> · 密码<span style={{ color: '#ef4444' }}>*</span> · 邮箱 · 手机号 · 部门 · 用户类型 · 管理员
              <br />
              · 部门按"名称"匹配（与系统中的部门同名）；用户类型 internal/external；管理员是/否
              <br />
              · 文件 ≤ 5MB，支持 .csv 和 .xlsx
            </div>
            <Space style={{ marginTop: 10 }}>
              <Button
                size="small"
                icon={<DownloadOutlined />}
                href={usersApi.templateURL('xlsx')}
                target="_blank"
                rel="noopener"
              >
                下载 XLSX 模板
              </Button>
              <Button
                size="small"
                icon={<DownloadOutlined />}
                href={usersApi.templateURL('csv')}
                target="_blank"
                rel="noopener"
              >
                下载 CSV 模板
              </Button>
            </Space>
          </div>

          <Upload.Dragger
            multiple={false}
            showUploadList={false}
            accept=".csv,.xlsx"
            beforeUpload={(file) => {
              if (file.size > 5 * 1024 * 1024) {
                message.error('文件超过 5MB');
                return Upload.LIST_IGNORE;
              }
              setImporting(true);
              setImportResult(null);
              usersApi
                .importFile(file)
                .then((r) => {
                  setImportResult(r);
                  if (r.failed === 0) {
                    message.success(`已导入 ${r.success} 个用户`);
                  } else {
                    message.warning(`导入完成：成功 ${r.success}，失败 ${r.failed}`);
                  }
                  load();
                })
                .catch((e) => {
                  message.error(e?.response?.data?.message || '导入失败');
                })
                .finally(() => setImporting(false));
              return false; // 拦截默认上传
            }}
            disabled={importing}
          >
            <p style={{ margin: 0, fontSize: 32, color: '#1677ff' }}>
              <UploadOutlined />
            </p>
            <p style={{ margin: '8px 0 4px', fontSize: 14 }}>
              {importing ? '正在导入…' : '点击或拖拽文件到这里上传'}
            </p>
            <p style={{ margin: 0, fontSize: 12, color: '#94a3b8' }}>仅支持 .csv / .xlsx</p>
          </Upload.Dragger>

          {importResult && (
            <div>
              <Space size="large" style={{ marginBottom: 8 }}>
                <span>共 <b>{importResult.total}</b> 行</span>
                <span style={{ color: '#10b981' }}>成功 <b>{importResult.success}</b></span>
                <span style={{ color: '#ef4444' }}>失败 <b>{importResult.failed}</b></span>
              </Space>
              {importResult.errors.length > 0 && (
                <Table
                  size="small"
                  rowKey={(r) => `${r.row}-${r.username}`}
                  dataSource={importResult.errors}
                  pagination={false}
                  scroll={{ y: 200 }}
                  columns={[
                    { title: '行号', dataIndex: 'row', width: 60 },
                    { title: '账号', dataIndex: 'username', width: 140 },
                    { title: '失败原因', dataIndex: 'reason' },
                  ]}
                />
              )}
            </div>
          )}
        </div>
      </Modal>

      </Card>
    </>
  );
}
