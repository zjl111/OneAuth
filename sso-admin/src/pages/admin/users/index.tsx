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
  Tabs,
  Row,
  Col,
  Upload,
  App as AntdApp,
} from 'antd';
import {
  PlusOutlined,
  ReloadOutlined,
  LockOutlined,
  UnlockOutlined,
  KeyOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import { usersApi, type User } from '@/api/users';
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
  const [form] = Form.useForm();
  const accessToken = useAuthStore((s) => s.accessToken);

  const [depts, setDepts] = useState<Department[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);

  const avatarUrl = Form.useWatch('avatar', form) as string | undefined;
  const watchedName =
    (Form.useWatch('nickname', form) as string) ||
    (Form.useWatch('username', form) as string) ||
    '新用户';

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
    form.setFieldsValue({ is_active: true });
    setModalOpen(true);
  };

  const openEdit = (u: User) => {
    setEditing(u);
    form.setFieldsValue({
      ...u,
      role_ids: u.roles.map((r) => r.id),
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    const values = await form.validateFields();
    try {
      if (editing) {
        await usersApi.update(editing.id, values);
        message.success('已更新');
      } else {
        await usersApi.create(values);
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
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          新建用户
        </Button>
      </PageToolbar>
      <Card>
      <Table
        rowKey="id"
        loading={loading}
        dataSource={data}
        scroll={{ x: 1000 }}
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
            title: '角色',
            dataIndex: 'roles',
            width: 200,
            render: (rs: User['roles']) =>
              rs?.length ? (
                <Space>
                  {rs.map((r) => (
                    <Tag color="blue" key={r.id}>
                      {r.name}
                    </Tag>
                  ))}
                </Space>
              ) : (
                '-'
              ),
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
          preserve={false}
          initialValues={{
            is_active: true,
            user_type: 'internal',
          }}
        >
          <Tabs
            items={[
              {
                key: 'basic',
                label: '基本信息',
                children: (
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
                          <UserAvatar src={avatarUrl} name={watchedName} size={72} />
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
                  </Row>
                ),
              },
              {
                key: 'org',
                label: '组织与角色',
                children: (
                  <>
                    <Form.Item name="department_id" label="所属部门">
                      <Select
                        allowClear
                        placeholder="选择部门"
                        options={flatDept(depts).map((d) => ({ value: d.id, label: d.label }))}
                      />
                    </Form.Item>
                    <Form.Item
                      name="role_ids"
                      label="角色"
                      extra="选择超级管理员角色将自动获得管理后台访问权限，其他角色按所分配的权限进入对应菜单"
                    >
                      <Select
                        mode="multiple"
                        placeholder="选择角色"
                        options={roles.map((r) => ({ value: r.id, label: r.name }))}
                      />
                    </Form.Item>
                  </>
                ),
              },
            ]}
          />
        </Form>
      </Drawer>
      </Card>
    </>
  );
}
