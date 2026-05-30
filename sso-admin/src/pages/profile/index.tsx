import { useEffect, useState } from 'react';
import { Card, Form, Input, Button, Upload, App as AntdApp, Tabs, Space, Divider, Tag, Descriptions } from 'antd';
import { UploadOutlined } from '@ant-design/icons';
import { authApi } from '@/api/auth';
import { useAuthStore } from '@/store/authStore';
import UserAvatar from '@/components/UserAvatar';
import './profile.css';

export default function ProfilePage() {
  const { message } = AntdApp.useApp();
  const accessToken = useAuthStore((s) => s.accessToken);
  const user = useAuthStore((s) => s.user);
  const setUser = (next: any) => useAuthStore.setState({ user: next });

  const [profileForm] = Form.useForm();
  const [pwdForm] = Form.useForm();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (user) {
      profileForm.setFieldsValue({
        nickname: user.nickname,
        email: user.email,
        phone: user.phone,
      });
    }
  }, [user, profileForm]);

  const handleSaveProfile = async () => {
    const v = await profileForm.validateFields();
    setSaving(true);
    try {
      const r = await authApi.updateProfile(v);
      setUser(r.user);
      message.success('已保存');
    } catch (e: any) {
      message.error(e?.response?.data?.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async () => {
    const v = await pwdForm.validateFields();
    if (v.new_password !== v.confirm_password) {
      message.error('两次输入的新密码不一致');
      return;
    }
    try {
      await authApi.changePassword({ old_password: v.old_password, new_password: v.new_password });
      message.success('密码已修改');
      pwdForm.resetFields();
    } catch (e: any) {
      message.error(e?.response?.data?.message || '修改失败');
    }
  };

  return (
    <div className="profile-page">
      <Card className="profile-summary">
        <Space size={24} align="center">
          <UserAvatar src={user?.avatar} name={user?.nickname || user?.username} size={80} />
          <Space direction="vertical" size={4}>
            <div className="profile-name">{user?.nickname || user?.username}</div>
            <div className="profile-username">@{user?.username}</div>
            <Space size={6}>
              {user?.is_staff && <Tag color="purple">管理员</Tag>}
              {user?.roles?.map((r) => (
                <Tag color="blue" key={r}>
                  {r}
                </Tag>
              ))}
            </Space>
          </Space>
          <Divider type="vertical" style={{ height: 80 }} />
          <Upload
            name="file"
            action={authApi.uploadAvatarPath}
            headers={{ Authorization: `Bearer ${accessToken}` }}
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
                const next = info.file.response?.data?.user;
                if (next) {
                  setUser(next);
                  message.success('头像已更新');
                }
              } else if (info.file.status === 'error') {
                message.error(info.file.response?.message || '上传失败');
              }
            }}
          >
            <Button icon={<UploadOutlined />}>更换头像</Button>
          </Upload>
        </Space>
      </Card>

      <Card style={{ marginTop: 16 }}>
        <Tabs
          items={[
            {
              key: 'basic',
              label: '基本资料',
              children: (
                <Form form={profileForm} layout="vertical" style={{ maxWidth: 520 }}>
                  <Form.Item label="用户名">
                    <Input value={user?.username} disabled />
                  </Form.Item>
                  <Form.Item name="nickname" label="昵称" rules={[{ required: true, message: '请输入昵称' }]}>
                    <Input />
                  </Form.Item>
                  <Form.Item name="email" label="邮箱">
                    <Input />
                  </Form.Item>
                  <Form.Item name="phone" label="手机号">
                    <Input maxLength={20} placeholder="可选" />
                  </Form.Item>
                  <Button type="primary" loading={saving} onClick={handleSaveProfile}>
                    保存
                  </Button>
                </Form>
              ),
            },
            {
              key: 'pwd',
              label: '修改密码',
              children: (
                <Form form={pwdForm} layout="vertical" style={{ maxWidth: 520 }}>
                  <Form.Item name="old_password" label="原密码" rules={[{ required: true, message: '请输入原密码' }]}>
                    <Input.Password />
                  </Form.Item>
                  <Form.Item
                    name="new_password"
                    label="新密码"
                    rules={[{ required: true, min: 8, message: '至少 8 位' }]}
                  >
                    <Input.Password />
                  </Form.Item>
                  <Form.Item
                    name="confirm_password"
                    label="确认新密码"
                    rules={[{ required: true, min: 8, message: '请再输入一次' }]}
                  >
                    <Input.Password />
                  </Form.Item>
                  <Button type="primary" onClick={handleChangePassword}>
                    修改密码
                  </Button>
                </Form>
              ),
            },
            {
              key: 'meta',
              label: '账号信息',
              children: (
                <Descriptions column={1} bordered size="small" style={{ maxWidth: 600 }}>
                  <Descriptions.Item label="用户 ID">{user?.id}</Descriptions.Item>
                  <Descriptions.Item label="账号">{user?.username}</Descriptions.Item>
                  <Descriptions.Item label="昵称">{user?.nickname || '-'}</Descriptions.Item>
                  <Descriptions.Item label="邮箱">{user?.email || '-'}</Descriptions.Item>
                  <Descriptions.Item label="管理员">{user?.is_staff ? '是' : '否'}</Descriptions.Item>
                  <Descriptions.Item label="角色">
                    {user?.roles?.length ? user.roles.join(', ') : '-'}
                  </Descriptions.Item>
                </Descriptions>
              ),
            },
          ]}
        />
      </Card>
    </div>
  );
}
