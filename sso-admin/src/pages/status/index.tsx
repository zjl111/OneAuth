import { memo, useEffect, useState } from 'react';
import { Spin, Tooltip } from 'antd';
import {
  CheckCircleFilled,
  WarningFilled,
  CloseCircleFilled,
  ToolFilled,
  QuestionCircleFilled,
  BulbOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { statusApi, type StatusOverview, type AppStatus } from '@/api/status';
import './status.css';

const statusConfig: Record<
  string,
  { label: string; color: string; icon: JSX.Element; bg: string }
> = {
  up: {
    label: '正常',
    color: '#10b981',
    bg: 'rgba(16, 185, 129, 0.12)',
    icon: <CheckCircleFilled />,
  },
  degraded: {
    label: '性能下降',
    color: '#f59e0b',
    bg: 'rgba(245, 158, 11, 0.12)',
    icon: <WarningFilled />,
  },
  down: {
    label: '服务中断',
    color: '#ef4444',
    bg: 'rgba(239, 68, 68, 0.12)',
    icon: <CloseCircleFilled />,
  },
  maintenance: {
    label: '维护中',
    color: '#3b82f6',
    bg: 'rgba(59, 130, 246, 0.12)',
    icon: <ToolFilled />,
  },
  no_data: {
    label: '无数据',
    color: '#9ca3af',
    bg: 'rgba(156, 163, 175, 0.12)',
    icon: <QuestionCircleFilled />,
  },
};

export default function StatusPage() {
  const [data, setData] = useState<StatusOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [theme, setTheme] = useState<'light' | 'dark'>(
    () => (localStorage.getItem('status-theme') as 'light' | 'dark') || 'light'
  );

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('status-theme', theme);
  }, [theme]);

  useEffect(() => {
    let cancelled = false;
    const fetchData = () => {
      statusApi
        .overview()
        .then((d) => {
          if (!cancelled) setData(d);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    };
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const downCount = data?.apps.filter((a) => a.status === 'down').length || 0;
  const isAllOk = downCount === 0;

  return (
    <div className={`status-page status-${theme}`}>
      <div className="status-header">
        <div className="status-banner">
          <div className={`status-badge ${isAllOk ? 'ok' : 'fail'}`}>
            {isAllOk ? <CheckCircleFilled /> : <CloseCircleFilled />}
          </div>
          <div className="status-text">
            <h1>{isAllOk ? '所有系统运行正常' : `${downCount} 个应用异常`}</h1>
            <div className="status-time">
              最后更新：
              {data?.last_updated
                ? dayjs(data.last_updated).format('YYYY-MM-DD HH:mm:ss')
                : '加载中...'}
              （每 30 秒自动更新）
            </div>
          </div>
        </div>
        <div className="status-actions">
          <button
            className="icon-btn"
            title="主题"
            onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
          >
            <BulbOutlined />
          </button>
        </div>
      </div>

      <div className="status-legend">
        {Object.entries(statusConfig).map(([k, v]) => (
          <span key={k} className="legend-item">
            <span className="legend-dot" style={{ background: v.color }} />
            {v.label}
          </span>
        ))}
      </div>

      <Spin spinning={loading}>
        <div className="status-list">
          {data?.apps.map((app) => (
            <AppStatusCard key={app.id} app={app} />
          ))}
        </div>
      </Spin>
    </div>
  );
}

const AppStatusCard = memo(
  AppStatusCardInner,
  (prev, next) =>
    prev.app.status === next.app.status &&
    prev.app.response_time_ms === next.app.response_time_ms &&
    prev.app.last_probed_at === next.app.last_probed_at &&
    prev.app.availability_current === next.app.availability_current &&
    prev.app.timeline.length === next.app.timeline.length &&
    prev.app.timeline[prev.app.timeline.length - 1]?.status ===
      next.app.timeline[next.app.timeline.length - 1]?.status
);

function AppStatusCardInner({ app }: { app: AppStatus }) {
  const cfg = statusConfig[app.status] || statusConfig.no_data;

  return (
    <div className="status-row">
      <div className="row-head">
        <div className="row-name">
          <span className="row-check" style={{ color: cfg.color }}>
            {cfg.icon}
          </span>
          <span className="row-title">{app.name}</span>
          <span
            className="row-pill"
            style={{ color: cfg.color, background: cfg.bg }}
          >
            {cfg.label}
          </span>
        </div>
        <div className="row-metrics">
          <span className="metric-value">{app.windows['90d'] ?? 100}%</span>
          <span className="metric-label">可用性</span>
          <span className="metric-value">{app.response_time_ms}ms</span>
          <span className="metric-label">响应</span>
        </div>
      </div>

      <div className="timeline">
        {app.timeline.map((t, idx) => {
          const c = statusConfig[t.status] || statusConfig.no_data;
          return (
            <Tooltip
              key={idx}
              title={
                <div>
                  <div>{t.date}</div>
                  <div>状态：{c.label}</div>
                  {t.total_probes > 0 && (
                    <>
                      <div>可用性：{t.availability}%</div>
                      <div>平均响应：{t.avg_response_ms}ms</div>
                    </>
                  )}
                </div>
              }
              mouseEnterDelay={0.15}
            >
              <div
                className="timeline-cell"
                style={{
                  background: c.color,
                  opacity: t.status === 'no_data' ? 0.35 : 1,
                }}
              />
            </Tooltip>
          );
        })}
      </div>

      <div className="row-footer">
        <span className="row-range">90 天前 — 今天</span>
        <div className="row-windows">
          {(['24h', '7d', '30d', '90d'] as const).map((k) => (
            <span key={k} className="row-window">
              <span className="win-key">{k}</span>
              <span className="win-val">{app.windows[k] ?? 100}%</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
