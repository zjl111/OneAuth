import { useMemo, useState } from 'react';
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
  UsergroupAddOutlined,
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

const menuItems: any[] = [
  { key: '/admin/dashboard', icon: <DashboardOutlined />, label: '仪表盘' },
  {
    key: 'identity',
    icon: <TeamOutlined />,
    label: '身份目录',
    children: [
      { key: '/admin/users', icon: <UserOutlined />, label: '用户' },
      { key: '/admin/orgs', icon: <ApartmentOutlined />, label: '组织' },
      { key: '/admin/user-groups', icon: <UsergroupAddOutlined />, label: '用户组' },
    ],
  },
  {
    key: 'perms',
    icon: <SafetyOutlined />,
    label: '权限管理',
    children: [
      { key: '/admin/roles', icon: <SafetyOutlined />, label: '角色权限' },
      { key: '/admin/app-perms', icon: <AppstoreOutlined />, label: '应用权限' },
    ],
  },
  { key: '/admin/apps', icon: <AppstoreOutlined />, label: '应用中心' },
  { key: '/admin/access', icon: <LockOutlined />, label: '访问控制' },
  { key: '/admin/settings', icon: <SettingOutlined />, label: '配置管理' },
  { key: '/admin/monitor', icon: <MonitorOutlined />, label: '状态监控' },
  { key: '/admin/logs', icon: <FileTextOutlined />, label: '日志审计' },
];

const labelMap: Record<string, string> = {
  '/admin/dashboard': '仪表盘',
  '/admin/users': '用户',
  '/admin/orgs': '组织',
  '/admin/user-groups': '用户组',
  '/admin/roles': '角色权限',
  '/admin/app-perms': '应用权限',
  '/admin/apps': '应用中心',
  '/admin/access': '访问控制',
  '/admin/settings': '配置管理',
  '/admin/monitor': '状态监控',
  '/admin/logs': '日志审计',
  '/admin/profile': '个人资料',
};

const breadcrumbExtra: Record<string, string> = {
  '/admin/users': '身份目录',
  '/admin/orgs': '身份目录',
  '/admin/user-groups': '身份目录',
  '/admin/roles': '权限管理',
  '/admin/app-perms': '权限管理',
};

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
          navigate('/');
        },
      },
    ],
  };

  const currentLabel = labelMap[location.pathname] || '管理后台';
  const parentLabel = breadcrumbExtra[location.pathname];

  // 当前在子菜单页面时自动展开对应 SubMenu
  const openKeys = useMemo(() => {
    const keys: string[] = [];
    if (['/admin/users', '/admin/orgs', '/admin/user-groups'].includes(location.pathname)) {
      keys.push('identity');
    }
    if (['/admin/roles', '/admin/app-perms'].includes(location.pathname)) {
      keys.push('perms');
    }
    return keys;
  }, [location.pathname]);

  return (
    <Layout className="admin-shell" style={{ height: '100vh' }}>
      <Sider collapsed={collapsed} width={220} className="admin-sider" theme="light">
        <div className="admin-logo">
          <SiteLogo size={32} />
          {!collapsed && <span>{site.name}</span>}
        </div>
        <Menu
          mode="inline"
          selectedKeys={[location.pathname]}
          defaultOpenKeys={openKeys}
          items={menuItems}
          onClick={(e) => {
            if (e.key.startsWith('/')) navigate(e.key);
          }}
          style={{ borderRight: 0 }}
        />
      </Sider>
      <Layout>
        <Header className="admin-header">
          <div className="header-left">
            <span className="collapse-btn" onClick={() => setCollapsed(!collapsed)}>
              {collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            </span>
            <Breadcrumb
              items={
                parentLabel
                  ? [{ title: '首页' }, { title: parentLabel }, { title: currentLabel }]
                  : [{ title: '首页' }, { title: currentLabel }]
              }
            />
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
