import { useEffect, useState } from 'react';
import { Card, Form, Input, Button, Upload, App as AntdApp, Tabs, Space, Divider, Tag, Descriptions, Modal, Popconfirm, Alert, Typography } from 'antd';
import { UploadOutlined, ReloadOutlined } from '@ant-design/icons';
import { authApi } from '@/api/auth';
import { useAuthStore } from '@/store/authStore';
import UserAvatar from '@/components/UserAvatar';
import WecomQRLogin from '@/components/WecomQRLogin';
import './profile.css';

const { Paragraph, Text } = Typography;

export default function ProfilePage() {
  const { message } = AntdApp.useApp();
  const accessToken = useAuthStore((s) => s.accessToken);
  const user = useAuthStore((s) => s.user);
  const setUser = (next: any) => useAuthStore.setState({ user: next });

  const [profileForm] = Form.useForm();
  const [pwdForm] = Form.useForm();
  const [saving, setSaving] = useState(false);

  // —— 企业微信绑定（自服务）——
  const [wecomEnabled, setWecomEnabled] = useState(false);
  const [wecomUserid, setWecomUserid] = useState<string>('');
  const [wecomLoading, setWecomLoading] = useState(false);
  const [bindModalOpen, setBindModalOpen] = useState(false);
  const [qrKey, setQrKey] = useState(0);

  const loadWeComBinding = async () => {
    try {
      const r = await authApi.getWeComBinding();
      setWecomUserid(r.wecom_userid || '');
    } catch {
      setWecomUserid('');
    }
  };

  // 企业微信登录未开启时，不展示「绑定设置」
  useEffect(() => {
    let active = true;
    authApi
      .getWeComStatus()
      .then((d) => {
        const en = !!d?.enabled;
        if (!active) return;
        setWecomEnabled(en);
        if (en) loadWeComBinding();
      })
      .catch(() => setWecomEnabled(false));
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    // 扫码绑定回调跳转回来 ?bind=success 时提示并刷新
    const params = new URLSearchParams(window.location.search);
    if (params.get('bind') === 'success') {
      message.success('企业微信已绑定，现在可用企业微信扫码登录');
      loadWeComBinding();
      // 清掉 query，避免刷新重复提示
      window.history.replaceState({}, '', window.location.pathname);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleUnbind = async () => {
    setWecomLoading(true);
    try {
      await authApi.bindWeCom('');
      setWecomUserid('');
      message.success('已解绑企业微信');
    } catch (e: any) {
      message.error(e?.response?.data?.message || '解绑失败');
    } finally {
      setWecomLoading(false);
    }
  };

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

  // 企业微信绑定设置 tab：仅当企业微信登录启用时展示（没开启就没有"绑定"一说）
  const wecomTab = {
    key: 'wecom',
    label: '绑定设置',
    children: (
      <div style={{ maxWidth: 620 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '20px 24px',
            border: '1px solid #f0f0f0',
            borderRadius: 8,
            background: '#fff',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: '50%',
                background: '#e6f7ff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <img src="/wecom-logo.png" alt="企业微信" style={{ width: 28, height: 28 }} />
            </div>
            <div>
              <div style={{ fontSize: 16, fontWeight: 500, color: '#262626' }}>企业微信</div>
              <div style={{ fontSize: 13, color: '#8c8c8c', marginTop: 4 }}>
                {wecomUserid ? '已绑定，可通过企业微信扫码登录' : '绑定后，您可通过企业微信扫码进行登录'}
              </div>
            </div>
          </div>

          {wecomUserid ? (
            <Popconfirm
              title="确定解绑企业微信？"
              description="解绑后将无法用企业微信扫码登录本账号，本地账号登录不受影响。"
              okText="解绑"
              cancelText="取消"
              okButtonProps={{ danger: true }}
              onConfirm={handleUnbind}
            >
              <Button loading={wecomLoading}>解绑</Button>
            </Popconfirm>
          ) : (
            <Button
              type="primary"
              loading={wecomLoading}
              onClick={() => {
                setQrKey((k) => k + 1);
                setBindModalOpen(true);
              }}
            >
              绑定
            </Button>
          )}
        </div>

        <Modal
          title="绑定企业微信"
          open={bindModalOpen}
          footer={null}
          onCancel={() => setBindModalOpen(false)}
          width={440}
          destroyOnClose
        >
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              padding: '8px 0 16px',
            }}
          >
            <div key={qrKey}>
              <WecomQRLogin mode="bind" />
            </div>
            <div
              style={{
                marginTop: 12,
                color: '#8c8c8c',
                fontSize: 13,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <span>请使用企业微信扫描二维码绑定</span>
              <Button type="link" size="small" icon={<ReloadOutlined />} onClick={() => setQrKey((k) => k + 1)}>
                刷新
              </Button>
            </div>
          </div>
        </Modal>
      </div>
    ),
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
                  <Form.Item name="email" label="邮箱" rules={[{ required: true, message: '请输入邮箱' }]}>
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
            ...(wecomEnabled ? [wecomTab] : []),
          ]}
        />
      </Card>
    </div>
  );
}
