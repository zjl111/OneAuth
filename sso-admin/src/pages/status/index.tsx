import { memo, useEffect, useState } from 'react';
import { Button, Empty, Spin, Tooltip } from 'antd';
import {
  CheckCircleFilled,
  WarningFilled,
  CloseCircleFilled,
  ToolFilled,
  QuestionCircleFilled,
  BulbOutlined,
  ArrowLeftOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import { statusApi, type StatusOverview, type AppStatus } from '@/api/status';
import './status.css';

// 顶部行状态（应用当前状态）：up/degraded/down/maintenance/no_data
// 时间线小格状态（每日聚合）：full/degraded/down/maintenance/none
// "full" 是小格特有的"当日 100% 可用"语义，复用 up 的绿
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
  full: {
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
  none: {
    label: '无数据',
    color: '#9ca3af',
    bg: 'rgba(156, 163, 175, 0.12)',
    icon: <QuestionCircleFilled />,
  },
};

// 把秒数格式化成 "1分23秒" / "2小时5分" / "—"
function formatOutage(sec: number): string {
  if (!sec || sec <= 0) return '—';
  if (sec < 60) return `${sec} 秒`;
  if (sec < 3600) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return s > 0 ? `${m} 分 ${s} 秒` : `${m} 分钟`;
  }
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return m > 0 ? `${h} 小时 ${m} 分` : `${h} 小时`;
}

export default function StatusPage() {
  const navigate = useNavigate();
  const [data, setData] = useState<StatusOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [theme, setTheme] = useState<'light' | 'dark'>(
    () => (localStorage.getItem('status-theme') as 'light' | 'dark') || 'light'
  );

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('status-theme', theme);
  }, [theme]);

  // 后端用 refresh_interval_seconds 告诉我们当前监控周期；前端轮询按它走
  const refreshSec = data?.refresh_interval_seconds || 30;

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
    const interval = setInterval(fetchData, refreshSec * 1000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [refreshSec]);

  const visibleApps = data?.apps.filter((a) => a.enabled !== false) || [];
  const downCount = visibleApps.filter((a) => a.status === 'down').length || 0;
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
              （每 {refreshSec} 秒自动更新）
            </div>
          </div>
        </div>
        <div className="status-actions">
          <Button
            className="status-back-btn"
            icon={<ArrowLeftOutlined />}
            onClick={() => navigate('/portal')}
          >
            返回门户
          </Button>
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
        {[
          { key: 'full', label: '可用率 ≥ 98%' },
          { key: 'degraded', label: '可用率 90% ~ 97%' },
          { key: 'down', label: '可用率 < 90%' },
          { key: 'maintenance', label: '维护中' },
          { key: 'none', label: '无数据' },
        ].map((it) => (
          <span key={it.key} className="legend-item">
            <span
              className="legend-dot"
              style={{ background: statusConfig[it.key].color }}
            />
            {it.label}
          </span>
        ))}
      </div>

      <Spin spinning={loading}>
        {visibleApps.length > 0 ? (
          <div className="status-list">
            {visibleApps.map((app) => (
              <AppStatusCard key={app.id} app={app} />
            ))}
          </div>
        ) : (
          <div className="status-empty">
            <Empty description="暂无已启用监控的应用" />
          </div>
        )}
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
          const c = statusConfig[t.status] || statusConfig.none;
          const isNone = t.status === 'none' || t.status === 'no_data';
          return (
            <Tooltip
              key={idx}
              title={
                <div style={{ minWidth: 180 }}>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>{t.date}</div>
                  <div>状态：{c.label}</div>
                  {!isNone && (
                    <>
                      <div>可用率：{t.availability}%</div>
                      <div>检查次数：{t.total_probes}</div>
                      <div>成功次数：{t.success_probes}</div>
                      <div>失败次数：{t.failed_probes}</div>
                      <div>平均延迟：{t.avg_response_ms} ms</div>
                      <div>最长故障：{formatOutage(t.max_outage_seconds)}</div>
                    </>
                  )}
                  {isNone && t.max_outage_seconds > 0 && (
                    <div>最长故障：{formatOutage(t.max_outage_seconds)}</div>
                  )}
                </div>
              }
              mouseEnterDelay={0.15}
            >
              <div
                className="timeline-cell"
                style={{
                  background: c.color,
                  opacity: isNone ? 0.35 : 1,
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
