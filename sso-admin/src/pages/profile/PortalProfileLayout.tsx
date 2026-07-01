import { useNavigate } from 'react-router-dom';
import { Dropdown, type MenuProps } from 'antd';
import {
  ArrowLeftOutlined,
  LogoutOutlined,
  SwapOutlined,
} from '@ant-design/icons';
import { useAuthStore } from '@/store/authStore';
import { useSite } from '@/hooks/useSite';
import SiteLogo from '@/components/SiteLogo';
import UserAvatar from '@/components/UserAvatar';
import StatusBadge from '@/components/StatusBadge';
import ProfilePage from './index';
import '../portal/portal.css';

export default function PortalProfileLayout() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const site = useSite();

  const userMenu: MenuProps = {
    items: [
      { key: 'portal', icon: <ArrowLeftOutlined />, label: '返回应用', onClick: () => navigate('/portal') },
      ...(user?.is_staff
        ? [
            {
              key: 'admin',
              icon: <SwapOutlined />,
              label: '管理后台',
              onClick: () => navigate('/admin'),
            },
          ]
        : []),
      { type: 'divider' },
      { key: 'logout', icon: <LogoutOutlined />, label: '退出登录', onClick: () => logout() },
    ],
  };

  return (
    <div className="portal-page">
      {/* 顶部导航 */}
      <div className="portal-header">
        <div className="portal-brand">
          <SiteLogo size={32} />
          <span>{site.name}</span>
          <StatusBadge />
        </div>
        <Dropdown menu={userMenu} placement="bottomRight">
          <div className="portal-user">
            <UserAvatar src={user?.avatar} name={user?.nickname || user?.username} size={36} />
            <span>{user?.nickname || user?.username}</span>
          </div>
        </Dropdown>
      </div>

      {/* 返回按钮 + 内容 */}
      <div style={{ padding: '0 24px 24px', background: '#f5f7fb', minHeight: 'calc(100vh - 64px)' }}>
        <div
          style={{
            maxWidth: 960,
            margin: '0 auto',
            paddingTop: 16,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginBottom: 16,
              cursor: 'pointer',
              color: '#6b7280',
              fontSize: 14,
            }}
            onClick={() => navigate('/portal')}
          >
            <ArrowLeftOutlined />
            <span>返回应用</span>
          </div>
          <ProfilePage />
        </div>
      </div>
    </div>
  );
}
