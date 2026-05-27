import { useEffect, useMemo, useState } from 'react';
import { Input, Dropdown, Empty, Spin, Segmented, App as AntdApp } from 'antd';
import {
  SearchOutlined,
  AppstoreOutlined,
  UnorderedListOutlined,
  SafetyCertificateOutlined,
  UserOutlined,
  LogoutOutlined,
  SwapOutlined,
  ArrowRightOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { portalApi } from '@/api/misc';
import { useAuthStore } from '@/store/authStore';
import { useSite } from '@/hooks/useSite';
import SiteLogo from '@/components/SiteLogo';
import UserAvatar from '@/components/UserAvatar';
import StatusBadge from '@/components/StatusBadge';
import './portal.css';

function toneOf(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % 5;
}

interface PortalApp {
  id: string;
  client_id: string;
  name: string;
  description: string;
  logo_url: string;
  home_url: string;
  is_builtin: boolean;
  granted: boolean;
}

const RECENT_KEY = 'portal-recent';
const RECENT_MAX = 12;

function loadRecent(): string[] {
  try {
    const arr = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function pushRecent(id: string) {
  const cur = loadRecent().filter((x) => x !== id);
  cur.unshift(id);
  localStorage.setItem(RECENT_KEY, JSON.stringify(cur.slice(0, RECENT_MAX)));
}

export default function PortalPage() {
  const navigate = useNavigate();
  const { message } = AntdApp.useApp();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const site = useSite();
  const [apps, setApps] = useState<PortalApp[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState('');
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [filter, setFilter] = useState<'all' | 'recent'>('all');

  useEffect(() => {
    setLoading(true);
    portalApi
      .apps()
      .then(setApps)
      .finally(() => setLoading(false));
  }, []);

  const handleEnter = (app: PortalApp) => {
    pushRecent(app.id);
    if (app.client_id === 'sso-admin') {
      navigate('/admin');
      return;
    }
    if (!app.home_url) {
      message.info('该应用尚未配置跳转地址');
      return;
    }
    window.open(app.home_url, '_blank', 'noopener');
  };

  const filtered = useMemo(() => {
    let r = apps;
    if (keyword) {
      r = r.filter(
        (a) =>
          a.name.toLowerCase().includes(keyword.toLowerCase()) ||
          a.description.toLowerCase().includes(keyword.toLowerCase())
      );
    }
    if (filter === 'recent') {
      const recent = loadRecent();
      const order = new Map(recent.map((id, i) => [id, i]));
      r = r.filter((a) => order.has(a.id)).sort((a, b) => order.get(a.id)! - order.get(b.id)!);
    }
    return r;
  }, [apps, keyword, filter]);

  const userMenu = {
    items: [
      { key: 'profile', icon: <UserOutlined />, label: '个人资料', onClick: () => navigate('/portal/profile') },
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

  const renderLogo = (app: PortalApp) => {
    if (!app.logo_url) return <SafetyCertificateOutlined />;
    if (app.logo_url.length <= 4) return <span className="emoji-logo">{app.logo_url}</span>;
    return <img src={app.logo_url} alt={app.name} />;
  };

  return (
    <div className="portal-page">
      {/* 顶部 */}
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

      {/* 工具栏 */}
      <div className="portal-toolbar">
        <Segmented
          value={filter}
          onChange={(v) => setFilter(v as typeof filter)}
          options={[
            { label: '全部应用', value: 'all' },
            { label: '最近访问', value: 'recent' },
          ]}
        />
        <Input
          prefix={<SearchOutlined />}
          placeholder="搜索应用名称或描述"
          allowClear
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          className="portal-search"
        />
        <div className="view-switch">
          <span className={view === 'grid' ? 'active' : ''} onClick={() => setView('grid')}>
            <AppstoreOutlined />
          </span>
          <span className={view === 'list' ? 'active' : ''} onClick={() => setView('list')}>
            <UnorderedListOutlined />
          </span>
        </div>
      </div>

      {/* 应用网格 / 列表 */}
      <Spin spinning={loading}>
        {filtered.length === 0 ? (
          <Empty description="暂无可用应用" style={{ padding: 60 }} />
        ) : view === 'grid' ? (
          <div className="portal-grid">
            {filtered.map((app) => (
              <div
                key={app.id}
                className="app-tile"
                data-tone={toneOf(app.client_id)}
                onClick={() => handleEnter(app)}
                title={app.description || app.name}
              >
                <div className="app-tile-logo">{renderLogo(app)}</div>
                <div className="app-tile-name">{app.name}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="portal-list">
            {filtered.map((app) => (
              <div key={app.id} className="app-list-item" onClick={() => handleEnter(app)}>
                <div className="list-logo">
                  {app.logo_url && app.logo_url.length <= 4 ? (
                    app.logo_url
                  ) : app.logo_url ? (
                    <img src={app.logo_url} alt={app.name} />
                  ) : (
                    <SafetyCertificateOutlined />
                  )}
                </div>
                <div className="list-text">
                  <div className="list-name">{app.name}</div>
                  <div className="list-desc">{app.description || '一站式应用入口'}</div>
                </div>
                <div className="list-action">
                  进入应用 <ArrowRightOutlined />
                </div>
              </div>
            ))}
          </div>
        )}
      </Spin>
    </div>
  );
}
