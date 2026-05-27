import { useEffect, useState } from 'react';
import { Spin } from 'antd';
import { ArrowRightOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { statusApi, type StatusOverview } from '@/api/status';

type Tone = 'ok' | 'warn' | 'mute';

const TONE_STYLE: Record<Tone, { bg: string; border: string; fg: string; dot: string; ring: string }> = {
  ok:   { bg: 'rgba(16,185,129,0.10)', border: 'rgba(16,185,129,0.22)', fg: '#047857', dot: '#10b981', ring: 'rgba(16,185,129,0.22)' },
  warn: { bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.25)', fg: '#b45309', dot: '#f59e0b', ring: 'rgba(245,158,11,0.22)' },
  mute: { bg: 'rgba(99,102,241,0.10)', border: 'rgba(99,102,241,0.22)', fg: '#4f46e5', dot: '#6366f1', ring: 'rgba(99,102,241,0.20)' },
};

/**
 * 系统运行状态胶囊。完全使用 inline style，避免被父级（如 portal-brand 17px/700）继承污染。
 */
export default function StatusBadge() {
  const navigate = useNavigate();
  const [data, setData] = useState<StatusOverview | null>(null);

  useEffect(() => {
    const load = () => statusApi.overview().then(setData).catch(() => {});
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, []);

  const baseStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    padding: '6px 14px',
    borderRadius: 999,
    fontSize: 13,
    fontWeight: 500,
    lineHeight: 1.2,
    letterSpacing: 0,
    whiteSpace: 'nowrap',
    flexShrink: 0,
    border: '1px solid transparent',
    cursor: 'pointer',
    userSelect: 'none',
    transition: 'transform 0.18s, filter 0.18s',
    boxSizing: 'border-box',
    minHeight: 30,
  };

  if (!data) {
    return (
      <div
        style={{ ...baseStyle, background: '#f5f7fb', color: '#94a3b8', cursor: 'default' }}
      >
        <Spin size="small" />
        <span style={{ fontSize: 13, fontWeight: 500 }}>加载中…</span>
      </div>
    );
  }

  const overall = data.overall_status;
  const tone: Tone = overall === 'operational' ? 'ok' : overall === 'maintenance' ? 'mute' : 'warn';
  const t = TONE_STYLE[tone];
  const label =
    overall === 'operational' ? '所有系统运行正常' :
    overall === 'maintenance' ? '部分系统维护中' :
    '部分系统异常';

  return (
    <div
      onClick={() => navigate('/status')}
      title={label}
      role="button"
      style={{
        ...baseStyle,
        background: t.bg,
        borderColor: t.border,
        color: t.fg,
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLDivElement).style.filter = 'brightness(0.97)';
        (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-1px)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLDivElement).style.filter = '';
        (e.currentTarget as HTMLDivElement).style.transform = '';
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: t.dot,
          boxShadow: `0 0 0 3px ${t.ring}`,
          flexShrink: 0,
          display: 'inline-block',
        }}
      />
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 500 }}>
        <span>整体可用性</span>
        <b style={{ fontWeight: 600, fontSize: 13 }}>{data.availability_24h_percent.toFixed(1)}%</b>
        {data.avg_response_ms > 0 && (
          <>
            <span style={{ opacity: 0.4, margin: '0 2px', fontSize: 13 }}>·</span>
            <span>平均延迟</span>
            <b style={{ fontWeight: 600, fontSize: 13 }}>{data.avg_response_ms}ms</b>
          </>
        )}
      </span>
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          marginLeft: 12,
          paddingLeft: 12,
          borderLeft: `1px solid ${t.fg}`,
          opacity: 0.85,
          fontSize: 13,
          fontWeight: 500,
        }}
      >
        查看详情 <ArrowRightOutlined style={{ fontSize: 11 }} />
      </span>
    </div>
  );
}
