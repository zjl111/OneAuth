import { useEffect, useState } from 'react';
import { Spin } from 'antd';
import { RightOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { statusApi, type StatusOverview } from '@/api/status';
import './StatusBadge.css';

/**
 * 系统运行状态徽章 —— 显示在应用门户顶部
 * - 绿色：所有系统正常
 * - 橙色：部分异常
 * - 灰色：维护中
 * 点击跳 /status 详情页
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

  if (!data) {
    return (
      <div className="status-badge status-badge-loading">
        <Spin size="small" />
        <span>加载中…</span>
      </div>
    );
  }

  const overall = data.overall_status;
  const tone = overall === 'operational' ? 'ok' : overall === 'maintenance' ? 'mute' : 'warn';
  const label =
    overall === 'operational' ? '所有系统运行正常' :
    overall === 'maintenance' ? '部分系统维护中' :
    '部分系统异常';

  return (
    <div
      className={`status-badge status-badge-${tone}`}
      onClick={() => navigate('/status')}
      role="button"
    >
      <div className="status-badge-main">
        <span className="status-dot" />
        <span className="status-title">{label}</span>
        <span className="status-metrics">
          {data.availability_24h_percent.toFixed(2)}%
          {data.avg_response_ms > 0 && <> · {data.avg_response_ms}ms</>}
        </span>
        <RightOutlined className="status-arrow" />
      </div>
      <div className="status-sub">点击查看详细应用运行状态</div>
    </div>
  );
}
