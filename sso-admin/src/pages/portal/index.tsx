import { useEffect, useMemo, useState } from 'react';
import { Input, Dropdown, Empty, Spin, App as AntdApp, Tooltip } from 'antd';
import {
  SearchOutlined,
  AppstoreOutlined,
  UnorderedListOutlined,
  SafetyCertificateOutlined,
  UserOutlined,
  LogoutOutlined,
  SwapOutlined,
  ArrowRightOutlined,
  LockOutlined,
  DownOutlined,
  StarOutlined,
  StarFilled,
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
  category?: string;
  description: string;
  protocol?: string;
  logo_url: string;
  home_url: string;
  is_builtin: boolean;
  granted: boolean;
}

const FAVORITE_KEY = 'portal-favorites';

function loadFavorites(): string[] {
  try {
    const arr = JSON.parse(localStorage.getItem(FAVORITE_KEY) || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function saveFavorites(ids: string[]) {
  localStorage.setItem(FAVORITE_KEY, JSON.stringify(ids));
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
  const [filter, setFilter] = useState<'all' | 'favorites'>('all');
  const [categoryFilter, setCategoryFilter] = useState<'all' | '__uncategorized__' | string>('all');
  const [favoriteIds, setFavoriteIds] = useState<string[]>(() => loadFavorites());
  const [hoveredCardId, setHoveredCardId] = useState<string | null>(null);
  const [failedLogos, setFailedLogos] = useState<Set<string>>(new Set());
  const noticeText = useMemo(
    () => String(site.notice_text || '').replace(/\s+/g, ' ').trim(),
    [site.notice_text]
  );
  const showNotice = site.notice_enabled === true && Boolean(noticeText);
  const noticeDuration = `${Math.max(12, Math.round(noticeText.length * 0.35))}s`;
  const noticeDelay = '3s';
  const categoryOptions = useMemo(() => {
    const items = new Set<string>();
    apps.forEach((app) => {
      const v = String(app.category || '').trim();
      if (v) items.add(v);
    });
    return Array.from(items).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
  }, [apps]);
  const categoryMenu = useMemo(
    () => [
      { key: 'all', label: '全部分类' },
      { key: '__uncategorized__', label: '未分类' },
      { type: 'divider' as const },
      ...categoryOptions.map((item) => ({ key: item, label: item })),
    ],
    [categoryOptions]
  );
  const favoriteSet = useMemo(() => new Set(favoriteIds), [favoriteIds]);
  const isFavorite = (id: string) => favoriteSet.has(id);
  const toggleFavorite = (app: PortalApp) => {
    setFavoriteIds((prev) => {
      const next = prev.includes(app.id) ? prev.filter((id) => id !== app.id) : [app.id, ...prev];
      saveFavorites(next);
      return next;
    });
  };

  useEffect(() => {
    setLoading(true);
    portalApi
      .apps()
      .then(setApps)
      .finally(() => setLoading(false));
  }, []);

  const handleEnter = (app: PortalApp) => {
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
    if (categoryFilter !== 'all') {
      r = r.filter((a) => {
        const cat = String(a.category || '').trim();
        return categoryFilter === '__uncategorized__' ? !cat : cat === categoryFilter;
      });
    }
    if (filter === 'favorites') {
      const order = new Map(favoriteIds.map((id, i) => [id, i]));
      r = r.filter((a) => order.has(a.id)).sort((a, b) => order.get(a.id)! - order.get(b.id)!);
    }
    return r;
  }, [apps, keyword, filter, categoryFilter, favoriteIds]);

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
    if (failedLogos.has(app.id) || !app.logo_url) return <SafetyCertificateOutlined />;
    if (app.logo_url.length <= 4) return <span className="emoji-logo">{app.logo_url}</span>;
    return (
      <img
        src={app.logo_url}
        alt=""
        onError={() => setFailedLogos((prev) => new Set(prev).add(app.id))}
      />
    );
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

      {/* 公告栏 */}
      {showNotice && (
        <div className="portal-notice-bar">
          <div className="notice-track">
            <div
              className="notice-marquee"
              aria-label="门户公告"
              style={{
                ['--notice-duration' as any]: noticeDuration,
                ['--notice-delay' as any]: noticeDelay,
              }}
            >
              <span className="notice-text">
                <span className="notice-icon">📢</span>
                <span>{noticeText}</span>
              </span>
            </div>
          </div>
        </div>
      )}

      {/* 工具栏 */}
      <div className="portal-toolbar">
        <div className="portal-filter-group">
          <span
            className={`portal-filter-item portal-filter-item--dropdown ${
              filter === 'all' || categoryFilter !== 'all' ? 'portal-filter-item--active' : ''
            }`}
          >
            <span
              className="portal-filter-item-label portal-filter-item-label--clickable"
              onClick={() => {
                setFilter('all');
                setCategoryFilter('all');
              }}
            >
              {categoryFilter === 'all'
                ? '全部应用'
                : categoryFilter === '__uncategorized__'
                  ? '全部应用 · 未分类'
                  : `全部应用 · ${categoryFilter}`}
            </span>
            <Dropdown
              menu={{
                items: categoryMenu,
                onClick: ({ key }) => {
                  setFilter('all');
                  setCategoryFilter(key === 'all' ? 'all' : (key as string));
                },
              }}
              trigger={['click']}
            >
              <span className="portal-filter-item-arrow-wrap" onClick={(e) => e.stopPropagation()}>
                <DownOutlined className="portal-filter-item-arrow" />
              </span>
            </Dropdown>
          </span>
          <span
            className={`portal-filter-item ${filter === 'favorites' ? 'portal-filter-item--active' : ''}`}
            onClick={() => setFilter('favorites')}
          >
            <span className="portal-filter-item-label">我的收藏</span>
          </span>
        </div>
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
              <Tooltip key={app.id} title={app.description || undefined} mouseEnterDelay={0.3} placement="bottom">
                <div
                  className="app-tile"
                  data-tone={toneOf(app.client_id)}
                  onClick={() => handleEnter(app)}
                  onMouseEnter={() => setHoveredCardId(app.id)}
                  onMouseLeave={() => setHoveredCardId((curr) => (curr === app.id ? null : curr))}
                >
                  <button
                    type="button"
                    className={`app-fav-btn ${hoveredCardId === app.id ? 'is-visible' : ''} ${isFavorite(app.id) ? 'is-fav' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleFavorite(app);
                    }}
                  >
                    <Tooltip title={isFavorite(app.id) ? '取消收藏该应用' : '添加至我的收藏'}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                        {isFavorite(app.id) ? <StarFilled /> : <StarOutlined />}
                      </span>
                    </Tooltip>
                  </button>
                  <div className="app-tile-logo" style={{ position: 'relative' }}>
                    {renderLogo(app)}
                    {app.protocol === 'link' && (
                      <span
                        title="非 SSO，点击直接跳转应用登录页"
                        style={{
                          position: 'absolute',
                          right: -2,
                          bottom: -2,
                          width: 18,
                          height: 18,
                          borderRadius: '50%',
                          background: '#f97316',
                          color: '#fff',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 11,
                          boxShadow: '0 0 0 2px #fff',
                        }}
                      >
                        <LockOutlined />
                      </span>
                    )}
                  </div>
                  <div className="app-tile-name">{app.name}</div>
                  {app.category && (
                    <div style={{ marginTop: 8 }}>
                      <span style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        padding: '0 8px',
                        height: 22,
                        borderRadius: 11,
                        background: '#eff6ff',
                        color: '#2563eb',
                        fontSize: 12,
                        fontWeight: 500,
                      }}>
                        {app.category}
                      </span>
                    </div>
                  )}
                </div>
              </Tooltip>
            ))}
          </div>
        ) : (
          <div className="portal-list">
            {filtered.map((app) => (
              <div key={app.id} className="app-list-item" onClick={() => handleEnter(app)}>
                <div className="list-logo" style={{ position: 'relative' }}>
                  {failedLogos.has(app.id) || !app.logo_url ? (
                    <SafetyCertificateOutlined />
                  ) : app.logo_url.length <= 4 ? (
                    app.logo_url
                  ) : (
                    <img
                      src={app.logo_url}
                      alt=""
                      onError={() => setFailedLogos((prev) => new Set(prev).add(app.id))}
                    />
                  )}
                  {app.protocol === 'link' && (
                    <span
                      style={{
                        position: 'absolute',
                        right: -2,
                        bottom: -2,
                        width: 16,
                        height: 16,
                        borderRadius: '50%',
                        background: '#f97316',
                        color: '#fff',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 10,
                        boxShadow: '0 0 0 2px #fff',
                      }}
                    >
                      <LockOutlined />
                    </span>
                  )}
                </div>
                <div className="list-text">
                  <div className="list-name">
                    {app.name}
                    <button
                      type="button"
                      className={`app-fav-btn app-fav-btn--list ${isFavorite(app.id) ? 'is-fav' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleFavorite(app);
                      }}
                    >
                      <Tooltip title={isFavorite(app.id) ? '取消收藏该应用' : '添加至我的收藏'}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                          {isFavorite(app.id) ? <StarFilled /> : <StarOutlined />}
                        </span>
                      </Tooltip>
                    </button>
                    {app.category && (
                      <span style={{ marginLeft: 8, color: '#1d4ed8', fontSize: 11, padding: '1px 6px', background: '#dbeafe', borderRadius: 4 }}>
                        {app.category}
                      </span>
                    )}
                    {app.protocol === 'link' && (
                      <span style={{ marginLeft: 8, color: '#dc2626', fontSize: 11, padding: '1px 6px', background: '#fee2e2', borderRadius: 4 }}>非 SSO</span>
                    )}
                  </div>
                  <div className="list-desc">{app.description || '一站式应用入口'}</div>
                </div>
                <div className="list-action">
                  <span>进入应用</span> <ArrowRightOutlined />
                </div>
              </div>
            ))}
          </div>
        )}
      </Spin>
    </div>
  );
}
