import { useState } from 'react';
import { Layout, Menu, Dropdown, Breadcrumb } from 'antd';
import {
  DashboardOutlined,
  UserOutlined,
  ApartmentOutlined,
  SafetyOutlined,
  AppstoreOutlined,
  LockOutlined,
  SettingOutlined,
  MonitorOutlined,
  FileTextOutlined,
  TeamOutlined,
  LogoutOutlined,
  SwapOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
} from '@ant-design/icons';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import { useSite } from '@/hooks/useSite';
import SiteLogo from '@/components/SiteLogo';
import UserAvatar from '@/components/UserAvatar';
import './admin.css';

const { Header, Sider, Content } = Layout;

const menuItems = [
  { key: '/admin/dashboard', icon: <DashboardOutlined />, label: '仪表盘' },
  { key: '/admin/users', icon: <UserOutlined />, label: '用户管理' },
  { key: '/admin/orgs', icon: <ApartmentOutlined />, label: '组织机构' },
  { key: '/admin/roles', icon: <SafetyOutlined />, label: '角色权限' },
  { key: '/admin/apps', icon: <AppstoreOutlined />, label: '应用中心' },
  { key: '/admin/access', icon: <LockOutlined />, label: '访问控制' },
  { key: '/admin/settings', icon: <SettingOutlined />, label: '配置管理' },
  { key: '/admin/monitor', icon: <MonitorOutlined />, label: '状态监控' },
  { key: '/admin/logs', icon: <FileTextOutlined />, label: '日志审计' },
];

const labelMap = Object.fromEntries(menuItems.map((m) => [m.key, m.label]));

export default function AdminLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const site = useSite();
  const [collapsed, setCollapsed] = useState(false);

  const userMenu = {
    items: [
      { key: 'profile', icon: <UserOutlined />, label: '个人资料', onClick: () => navigate('/admin/profile') },
      { key: 'portal', icon: <SwapOutlined />, label: '返回应用门户', onClick: () => navigate('/portal') },
      { type: 'divider' as const },
      {
        key: 'logout',
        icon: <LogoutOutlined />,
        label: '退出登录',
        onClick: async () => {
          await logout();
          navigate('/oauth/login');
        },
      },
    ],
  };

  const currentLabel = labelMap[location.pathname] || '管理后台';

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider collapsed={collapsed} width={220} className="admin-sider" theme="light">
        <div className="admin-logo">
          <SiteLogo size={32} />
          {!collapsed && <span>{site.name}</span>}
        </div>
        <Menu
          mode="inline"
          selectedKeys={[location.pathname]}
          items={menuItems}
          onClick={(e) => navigate(e.key)}
          style={{ borderRight: 0 }}
        />
      </Sider>
      <Layout>
        <Header className="admin-header">
          <div className="header-left">
            <span className="collapse-btn" onClick={() => setCollapsed(!collapsed)}>
              {collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            </span>
            <Breadcrumb items={[{ title: '首页' }, { title: currentLabel }]} />
          </div>
          <div className="header-right">
            <span className="header-time">
              {new Date().toLocaleString('zh-CN', { hour12: false })}
            </span>
            <Dropdown menu={userMenu} placement="bottomRight">
              <div className="header-user">
                <UserAvatar src={user?.avatar} name={user?.nickname || user?.username} size={32} />
                <span>{user?.nickname || user?.username}</span>
              </div>
            </Dropdown>
          </div>
        </Header>
        <Content className="admin-content">
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
