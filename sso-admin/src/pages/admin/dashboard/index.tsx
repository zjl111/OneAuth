import { useEffect, useMemo, useState } from 'react';
import { Card, Col, Row, Empty, Tag, Space } from 'antd';
import {
  UserOutlined,
  AppstoreOutlined,
  LoginOutlined,
  WarningOutlined,
  RiseOutlined,
  ClockCircleOutlined,
  ArrowRightOutlined,
  TrophyFilled,
  SafetyCertificateOutlined,
  MailOutlined,
  TeamOutlined,
} from '@ant-design/icons';
import { Line, Pie } from '@ant-design/charts';
import dayjs from 'dayjs';
import { useNavigate } from 'react-router-dom';
import { dashboardApi, type OperationLog } from '@/api/misc';
import './dashboard.css';

type StatCard = {
  key: string;
  title: string;
  value: string | number;
  icon: React.ReactNode;
  tone: 'blue' | 'green' | 'purple' | 'red' | 'orange';
  /** 底部尾注；不传则显示"较昨日 0%" */
  footnote?: string;
};

const TONE_BG: Record<StatCard['tone'], string> = {
  blue: 'linear-gradient(135deg, #e9efff, #f4f7ff)',
  green: 'linear-gradient(135deg, #d6f6e7, #ecfdf5)',
  purple: 'linear-gradient(135deg, #ede9fe, #faf5ff)',
  red: 'linear-gradient(135deg, #fee2e2, #fef2f2)',
  orange: 'linear-gradient(135deg, #ffedd5, #fff7ed)',
};
const TONE_FG: Record<StatCard['tone'], string> = {
  blue: '#1677ff',
  green: '#10b981',
  purple: '#8b5cf6',
  red: '#ef4444',
  orange: '#f59e0b',
};

const RESOURCE_LABEL: Record<string, string> = {
  users: '用户管理', roles: '角色权限', departments: '组织机构', apps: '应用中心',
  configs: '系统配置', access: '访问控制', monitor: '状态监控', dictionaries: '字典',
  auth: '账户', permissions: '权限',
};
const ACTION_LABEL: Record<string, string> = {
  create: '创建', update: '更新', delete: '删除', patch: '更新', post: '创建', put: '更新',
};
const SUFFIX_LABEL: Record<string, string> = {
  'reset-password': '重置密码', lock: '锁定/解锁', roles: '设置角色', avatar: '上传头像',
  'rotate-secret': '轮换密钥', 'toggle-status': '启用/禁用', probe: '立即探测',
  maintenance: '维护模式', 'batch-delete': '批量删除', 'upload-logo': '上传 Logo',
  'upload-image': '上传图片', profile: '个人资料', 'change-password': '修改密码',
};

function translateAction(action: string): string {
  if (ACTION_LABEL[action]) return ACTION_LABEL[action];
  const i = action.indexOf('.');
  if (i > 0) {
    const v = action.slice(0, i);
    const s = action.slice(i + 1);
    return `${ACTION_LABEL[v] || v}·${SUFFIX_LABEL[s] || s}`;
  }
  return action || '-';
}

function describeOp(log: OperationLog): string {
  switch (log.action) {
    case 'create':
      return `创建${RESOURCE_LABEL[log.resource_type] || log.resource_type}`;
    case 'update':
      return `更新${RESOURCE_LABEL[log.resource_type] || log.resource_type}`;
    case 'delete':
      return `删除${RESOURCE_LABEL[log.resource_type] || log.resource_type}`;
    default:
      return `${RESOURCE_LABEL[log.resource_type] || log.resource_type} · ${translateAction(log.action)}`;
  }
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const [stats, setStats] = useState({
    user_count: 0, login_today: 0, app_count: 0, abnormal_count: 0,
    uptime_percent: 100, monitor_total: 0,
    active_users: 0, active_window_minutes: 120,
  });
  const [trend, setTrend] = useState<Array<{ date: string; count: number }>>([]);
  const [dist, setDist] = useState<Array<{ client_id: string; client_name: string; count: number }>>([]);
  const [recentOps, setRecentOps] = useState<OperationLog[]>([]);

  useEffect(() => {
    dashboardApi.stats().then(setStats);
    dashboardApi.loginTrends(30).then((d) => setTrend(d || []));
    dashboardApi.appDistribution(30).then((d) => setDist(d || []));
    dashboardApi.recentOperations(5).then((d) => setRecentOps(d || []));
  }, []);

  const winMin = stats.active_window_minutes || 120;
  const winLabel = winMin % 60 === 0 ? `${winMin / 60} 小时` : `${winMin} 分钟`;
  const cards: StatCard[] = [
    { key: 'u', title: '用户总数', value: stats.user_count, icon: <UserOutlined />, tone: 'blue' },
    { key: 's', title: '活跃用户', value: stats.active_users, icon: <TeamOutlined />, tone: 'green', footnote: `近 ${winLabel}` },
    { key: 'l', title: '今日登录次数', value: stats.login_today, icon: <LoginOutlined />, tone: 'green' },
    { key: 'a', title: '已接入应用', value: stats.app_count, icon: <AppstoreOutlined />, tone: 'purple' },
    { key: 'e', title: '异常告警', value: stats.abnormal_count, icon: <WarningOutlined />, tone: 'red' },
    {
      key: 'p',
      title: '在线率',
      value: `${stats.uptime_percent.toFixed(1)}%`,
      icon: <RiseOutlined />,
      tone: 'orange',
    },
  ];

  const totalAccess = useMemo(() => dist.reduce((s, x) => s + Number(x.count), 0), [dist]);

  return (
    <div className="dashboard">
      {/* 1. 统计卡片行 */}
      <Row gutter={[16, 16]}>
        {cards.map((c) => (
          <Col xs={24} sm={12} md={12} lg={8} xl={4} key={c.key}>
            <div className="stat-card">
              <div className="stat-card-icon" style={{ background: TONE_BG[c.tone], color: TONE_FG[c.tone] }}>
                {c.icon}
              </div>
              <div className="stat-card-body">
                <div className="stat-card-title">{c.title}</div>
                <div className="stat-card-value">{c.value}</div>
                <div className="stat-card-delta">{c.footnote || '较昨日 0%'}</div>
              </div>
            </div>
          </Col>
        ))}
      </Row>

      {/* 2. 中部：登录趋势 + 应用访问占比 */}
      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} xl={16}>
          <Card
            className="dash-card"
            title={
              <Space>
                <ClockCircleOutlined style={{ color: '#1677ff' }} />
                <span>近 30 天登录趋势</span>
              </Space>
            }
            extra={<Tag color="blue">近 30 天</Tag>}
          >
            {trend.length === 0 ? (
              <Empty description="暂无数据" />
            ) : (
              <Line
                data={trend}
                xField="date"
                yField="count"
                smooth
                height={300}
                area={{ style: { fillOpacity: 0.18 } }}
                color="#1677ff"
                point={{ size: 3, shape: 'circle', style: { fill: '#1677ff', stroke: '#fff', lineWidth: 1 } }}
                xAxis={{ tickCount: 8 }}
              />
            )}
          </Card>
        </Col>
        <Col xs={24} xl={8}>
          <Card className="dash-card" title="应用访问占比">
            {dist.length === 0 ? (
              <Empty description="暂无数据" />
            ) : (
              <>
                <div style={{ height: 220, position: 'relative' }}>
                  <Pie
                    data={dist}
                    angleField="count"
                    colorField="client_name"
                    radius={0.85}
                    innerRadius={0.65}
                    height={220}
                    legend={false}
                    label={false}
                    statistic={{
                      title: { content: '总访问次数', style: { fontSize: 12, color: '#94a3b8' } },
                      content: { content: `${totalAccess}`, style: { fontSize: 22, fontWeight: 600, color: '#1d2c5b' } },
                    }}
                  />
                </div>
                <ul className="dash-legend">
                  {dist.slice(0, 5).map((d, i) => (
                    <li key={d.client_id}>
                      <span className="dot" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                      <span className="name">{d.client_name}</span>
                      <span className="pct">
                        {totalAccess > 0 ? ((Number(d.count) / totalAccess) * 100).toFixed(1) : 0}%
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Card>
        </Col>
      </Row>

      {/* 3. 下部：最近操作日志 + 热门应用排行 */}
      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} xl={12}>
          <Card
            className="dash-card"
            title="最近操作日志"
            extra={
              <a onClick={() => navigate('/admin/logs')}>
                查看全部 <ArrowRightOutlined />
              </a>
            }
          >
            {recentOps.length === 0 ? (
              <Empty description="暂无操作记录" />
            ) : (
              <ul className="op-list">
                {recentOps.map((log) => (
                  <li key={log.id}>
                    <div className="op-icon">
                      <SafetyCertificateOutlined />
                    </div>
                    <div className="op-text">
                      <div className="op-title">{describeOp(log)}</div>
                      <div className="op-sub">
                        用户 <b>{log.username || '-'}</b> · {log.description}
                      </div>
                    </div>
                    <div className="op-time">{dayjs(log.created_at).format('MM-DD HH:mm:ss')}</div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </Col>

        <Col xs={24} xl={12}>
          <Card
            className="dash-card"
            title="热门应用排行"
            extra={
              <a onClick={() => navigate('/admin/apps')}>
                查看全部 <ArrowRightOutlined />
              </a>
            }
          >
            {dist.length === 0 ? (
              <Empty description="暂无访问数据" />
            ) : (
              <ul className="rank-list">
                {dist.slice(0, 5).map((d, i) => (
                  <li key={d.client_id}>
                    <span className={`rank-badge rank-${i + 1}`}>
                      {i < 3 ? <TrophyFilled /> : i + 1}
                    </span>
                    <span className="rank-icon">
                      <MailOutlined />
                    </span>
                    <span className="rank-name">{d.client_name}</span>
                    <span className="rank-count">{d.count} 次</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </Col>
      </Row>
    </div>
  );
}

const PIE_COLORS = ['#1677ff', '#10b981', '#8b5cf6', '#f59e0b', '#06b6d4', '#ec4899'];
