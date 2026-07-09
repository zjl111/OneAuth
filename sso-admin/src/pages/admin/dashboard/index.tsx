import { useCallback, useEffect, useRef, useState } from 'react';
import { Card, Col, Row, Empty, Segmented, Space, Table, Tabs, Tag } from 'antd';
import ChinaMap from '@/components/ChinaMap';
import * as echarts from 'echarts/core';
import { LineChart } from 'echarts/charts';
import {
  TooltipComponent,
  LegendComponent,
  GridComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import {
  UserOutlined,
  AppstoreOutlined,
  LoginOutlined,
  ArrowRightOutlined,
  TeamOutlined,
  EnvironmentOutlined,
  CheckCircleOutlined,
  ThunderboltOutlined,
  LineChartOutlined,
  SafetyOutlined,
  ClockCircleOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { dashboardApi } from '@/api/misc';
import { statusApi, type StatusOverview } from '@/api/status';
import './dashboard.css';

echarts.use([LineChart, TooltipComponent, LegendComponent, GridComponent, CanvasRenderer]);

type DateRange = 'day' | 'week' | 'month';

const RANGE_DAYS: Record<DateRange, number> = { day: 1, week: 7, month: 30 };

const RANGE_TAB_LABEL: Record<DateRange, string> = {
  day: '今日登录与访问趋势',
  week: '7 日登录与访问趋势',
  month: '30 日登录与访问趋势',
};

const RANGE_MAP_LABEL: Record<DateRange, string> = {
  day: '今日访问地域分布',
  week: '7 日访问地域分布',
  month: '30 日访问地域分布',
};

type StatCard = {
  key: string;
  title: string;
  value: string | number;
  icon: React.ReactNode;
  tone: 'blue' | 'green' | 'purple' | 'red' | 'orange';
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
  blue: 'var(--primary-color)',
  green: '#10b981',
  purple: '#8b5cf6',
  red: '#ef4444',
  orange: '#f59e0b',
};

type TrafficPoint = { label: string; login_count: number; access_count: number };

type SecurityAlert = {
  type: string;
  title: string;
  description: string;
  severity: string;
  username: string;
  display_name: string;
  ip: string;
  created_at: string;
  unknown_user: boolean;
};

const ALERT_TYPE_CONFIG: Record<string, { icon: React.ReactNode; color: string }> = {
  failed_login:      { icon: <LoginOutlined />,       color: '#f59e0b' },
  brute_force:       { icon: <ThunderboltOutlined />, color: '#ef4444' },
  unusual_location:  { icon: <EnvironmentOutlined />, color: '#8b5cf6' },
  user_locked:       { icon: <SafetyOutlined />,      color: '#dc2626' },
  operation_failure: { icon: <ClockCircleOutlined />, color: '#f97316' },
};

const SEVERITY_STYLE: Record<string, { border: string; bg: string }> = {
  high: { border: '#dc2626', bg: '#fef2f2' },
  medium: { border: '#d97706', bg: '#fffbeb' },
  low: { border: '#6b7280', bg: '#f9fafb' },
};

export default function DashboardPage() {
  const navigate = useNavigate();
  const [range, setRange] = useState<DateRange>('day');
  const [tabKey, setTabKey] = useState('trend');
  const [stats, setStats] = useState({
    user_count: 0, login_today: 0, app_count: 0, abnormal_count: 0,
    uptime_percent: 100, monitor_total: 0,
    active_users: 0, active_window_minutes: 120,
  });
  const [dist, setDist] = useState<Array<{ client_id: string; client_name: string; logo_url?: string; count: number }>>([]);
  const [regionTop, setRegionTop] = useState<Array<{ province: string; count: number }>>([]);
  const [overview, setOverview] = useState<StatusOverview | null>(null);
  const [traffic, setTraffic] = useState<TrafficPoint[]>([]);
  const [alerts, setAlerts] = useState<SecurityAlert[]>([]);
  const [topUsers, setTopUsers] = useState<Array<{ username: string; display_name: string; login_count: number }>>([]);
  const dualChartRef = useRef<HTMLDivElement | null>(null);
  const dualChartInstance = useRef<echarts.ECharts | null>(null);

  // 初始加载：stats / overview / alerts / appDistribution 只请求一次
  useEffect(() => {
    dashboardApi.stats().then(setStats).catch((e) => console.error('[dashboard] stats failed', e));
    dashboardApi.appDistribution(30).then((d) => setDist(d || [])).catch((e) => console.error('[dashboard] app-distribution failed', e));
    statusApi.overview().then(setOverview).catch((e) => console.error('[dashboard] status-overview failed', e));
    dashboardApi.securityAlerts().then((d) => setAlerts(d || [])).catch((e) => console.error('[dashboard] security-alerts failed', e));
  }, []);

  // range 变化时重新拉取地域 + 流量趋势 + 登录用户排行
  const fetchRangeData = useCallback((r: DateRange) => {
    const days = RANGE_DAYS[r];
    dashboardApi.regionTop10(days).then((d) => setRegionTop(d || [])).catch((e) => console.error('[dashboard] region-top10 failed', e));
    dashboardApi.hourlyTrends(r).then((d) => setTraffic(d || [])).catch((e) => console.error('[dashboard] hourly-trends failed', e));
    dashboardApi.topUsers(days, 5).then((d) => setTopUsers(d || [])).catch((e) => console.error('[dashboard] top-users failed', e));
  }, []);

  useEffect(() => { fetchRangeData(range); }, [range, fetchRangeData]);

  // ECharts 双折线图：登录次数 + 应用访问次数
  useEffect(() => {
    if (!dualChartRef.current || tabKey !== 'trend') return;
    // 延迟一帧让 Tab 面板完成布局
    requestAnimationFrame(() => {
      if (!dualChartRef.current) return;
      if (!dualChartInstance.current) {
        dualChartInstance.current = echarts.init(dualChartRef.current);
      }
      dualChartInstance.current.resize();
      const labels = traffic.map((h) => h.label);
      const loginCounts = traffic.map((h) => h.login_count);
      const accessCounts = traffic.map((h) => h.access_count);

      dualChartInstance.current.setOption({
        tooltip: {
          trigger: 'axis',
          textStyle: { fontSize: 13 },
        },
        legend: {
          data: ['用户登录', '应用访问'],
          right: 16,
          top: 0,
          textStyle: { fontSize: 13, color: '#4b5563' },
        },
        grid: { left: 48, right: 24, top: 36, bottom: 24 },
        xAxis: {
          type: 'category',
          data: labels,
          axisLabel: { fontSize: 12, color: '#94a3b8' },
          axisLine: { lineStyle: { color: '#eef0f5' } },
          axisTick: { show: false },
        },
        yAxis: {
          type: 'value',
          name: '次数',
          nameTextStyle: { fontSize: 12, color: '#94a3b8' },
          axisLabel: { fontSize: 12, color: '#94a3b8' },
          splitLine: { lineStyle: { color: '#f3f4f6' } },
        },
        series: [
          {
            name: '用户登录',
            type: 'line',
            smooth: true,
            symbol: 'circle',
            symbolSize: 6,
            data: loginCounts,
            lineStyle: { color: '#2563eb', width: 2.5 },
            itemStyle: { color: '#2563eb' },
            areaStyle: {
              color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                { offset: 0, color: 'rgba(37,99,235,0.15)' },
                { offset: 1, color: 'rgba(37,99,235,0.01)' },
              ]),
            },
          },
          {
            name: '应用访问',
            type: 'line',
            smooth: true,
            symbol: 'circle',
            symbolSize: 6,
            data: accessCounts,
            lineStyle: { color: '#f59e0b', width: 2.5 },
            itemStyle: { color: '#f59e0b' },
            areaStyle: {
              color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                { offset: 0, color: 'rgba(245,158,11,0.12)' },
                { offset: 1, color: 'rgba(245,158,11,0.01)' },
              ]),
            },
          },
        ],
      }, true);
    });
  }, [traffic, tabKey]);

  useEffect(() => {
    const onResize = () => dualChartInstance.current?.resize();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      dualChartInstance.current?.dispose();
      dualChartInstance.current = null;
    };
  }, []);

  const winMin = stats.active_window_minutes || 120;
  const winLabel = winMin % 60 === 0 ? `${winMin / 60} 小时` : `${winMin} 分钟`;
  const cards: StatCard[] = [
    { key: 'u', title: '用户总数', value: stats.user_count, icon: <UserOutlined />, tone: 'blue' },
    { key: 's', title: '活跃用户', value: stats.active_users, icon: <TeamOutlined />, tone: 'green', footnote: `近 ${winLabel}` },
    { key: 'l', title: '今日登录次数', value: stats.login_today, icon: <LoginOutlined />, tone: 'green' },
    { key: 'a', title: '已接入应用', value: stats.app_count, icon: <AppstoreOutlined />, tone: 'purple' },
    {
      key: 'lat',
      title: '平均延迟',
      value: overview && overview.avg_response_ms > 0 ? `${overview.avg_response_ms}ms` : '—',
      icon: <ThunderboltOutlined />,
      tone: 'orange',
      footnote: '全部应用',
    },
    {
      key: 'avail',
      title: '综合可用性',
      value: overview ? `${overview.availability_24h_percent.toFixed(1)}%` : '—',
      icon: <CheckCircleOutlined />,
      tone: 'green',
      footnote: '近 24 小时',
    },
  ];

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

      {/* 2. 中部：Tab 切换（地域统计 / 流量趋势）+ 安全预警 */}
      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} xl={17}>
          <Card className="dash-card" bodyStyle={{ padding: 0 }}>
            <Tabs
              className="dash-tabs"
              activeKey={tabKey}
              onChange={setTabKey}
              tabBarExtraContent={{
                right: (
                  <Segmented
                    className="dash-range-seg"
                    options={[
                      { label: '按天', value: 'day' },
                      { label: '按周', value: 'week' },
                      { label: '按月', value: 'month' },
                    ]}
                    value={range}
                    onChange={(v) => setRange(v as DateRange)}
                  />
                ),
              }}
              items={[
                {
                  key: 'trend',
                  label: (
                    <Space size={4}>
                      <LineChartOutlined style={{ color: '#3b82f6' }} />
                      <span>{RANGE_TAB_LABEL[range]}</span>
                    </Space>
                  ),
                  children: (
                    <div className="dash-tab-body">
                      {traffic.length === 0 ? (
                        <Empty description="暂无流量数据" style={{ padding: '80px 0' }} />
                      ) : (
                        <div ref={dualChartRef} style={{ width: '100%', height: 420 }} />
                      )}
                    </div>
                  ),
                },
                {
                  key: 'region',
                  label: (
                    <Space size={4}>
                      <EnvironmentOutlined style={{ color: 'var(--primary-color)' }} />
                      <span>{RANGE_MAP_LABEL[range]}</span>
                    </Space>
                  ),
                  children: (
                    <div className="dash-tab-body">
                      <Row gutter={[16, 16]} align="top">
                        <Col xs={24} xl={16}>
                          <ChinaMap data={regionTop} height={420} />
                        </Col>
                        <Col xs={24} xl={8} style={{ display: 'flex', justifyContent: 'center', alignItems: 'flex-start', paddingTop: 16 }}>
                          <div style={{ width: '85%' }}>
                            <Table
                              size="middle"
                              pagination={false}
                              rowKey={(r) => `${r.province}-${r.count}`}
                              dataSource={regionTop}
                              locale={{ emptyText: '暂无数据' }}
                              columns={[
                                {
                                  title: '序号',
                                  key: 'idx',
                                  width: 50,
                                  align: 'center',
                                  render: (_, _r, i) => <span className={`rank-badge rank-${i + 1}`}>{i + 1}</span>,
                                },
                                { title: '省 / 市', dataIndex: 'province', align: 'center' },
                                { title: '浏览量(PV)', dataIndex: 'count', align: 'center' },
                              ]}
                            />
                          </div>
                        </Col>
                      </Row>
                    </div>
                  ),
                },
              ]}
            />
          </Card>
        </Col>

        {/* 实时安全风险预警 */}
        <Col xs={24} xl={7}>
          <Card
            className="dash-card security-card"
            title={
              <Space>
                <SafetyOutlined style={{ color: '#dc2626' }} />
                <span style={{ fontSize: 15, fontWeight: 600, color: '#1d2c5b' }}>实时安全风险预警</span>
              </Space>
            }
          >
            {alerts.length === 0 ? (
              <Empty description="暂无安全风险" style={{ padding: '40px 0' }} />
            ) : (
              <div className="alert-list">
                {alerts.map((a, i) => {
                  const style = SEVERITY_STYLE[a.severity] || SEVERITY_STYLE.low;
                  const typeCfg = ALERT_TYPE_CONFIG[a.type] || { icon: <SafetyOutlined />, color: '#6b7280' };
                  return (
                    <div key={i} className="alert-item" style={{ borderLeft: `3px solid ${style.border}`, background: style.bg }}>
                      <div className="alert-title">
                        <span className="alert-type-icon" style={{ color: typeCfg.color }}>{typeCfg.icon}</span>
                        <span>{a.title}</span>
                        {a.display_name && a.display_name !== a.username && (
                          <span style={{ fontWeight: 500, color: '#4b5563', fontSize: 12 }}>— {a.display_name}</span>
                        )}
                        {a.unknown_user && (
                          <Tag color="error" style={{ marginLeft: 6, fontSize: 11, lineHeight: '18px', padding: '0 6px' }}>非系统用户</Tag>
                        )}
                      </div>
                      <div className="alert-desc">{a.description}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </Col>
      </Row>

      {/* 3. 底部：热门应用排行 + 活跃用户排行 */}
      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} xl={12}>
          <Card
            className="dash-card"
            title={
              <Space>
                <AppstoreOutlined style={{ color: '#8b5cf6' }} />
                <span>热门应用 Top 5</span>
              </Space>
            }
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
                {dist.slice(0, 5).map((d, i) => {
                  const isImg = d.logo_url && /^(https?:|\/)/i.test(d.logo_url);
                  const isEmoji = d.logo_url && d.logo_url.length <= 4 && !isImg;
                  return (
                    <li key={d.client_id}>
                      <span className={`rank-badge rank-${i + 1}`}>{i + 1}</span>
                      <span className="rank-icon">
                        {isImg ? (
                          <img
                            src={d.logo_url!}
                            alt={d.client_name}
                            style={{ width: 28, height: 28, objectFit: 'contain', borderRadius: 6 }}
                          />
                        ) : isEmoji ? (
                          <span style={{ fontSize: 22 }}>{d.logo_url}</span>
                        ) : (
                          <span
                            style={{
                              width: 28,
                              height: 28,
                              borderRadius: 6,
                              background: '#e0e7ff',
                              color: '#4338ca',
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontSize: 13,
                              fontWeight: 600,
                            }}
                          >
                            {(d.client_name || '?').slice(0, 1).toUpperCase()}
                          </span>
                        )}
                      </span>
                      <span className="rank-name">{d.client_name}</span>
                      <span className="rank-count">{d.count.toLocaleString()}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </Col>
        <Col xs={24} xl={12}>
          <Card
            className="dash-card"
            title={
              <Space>
                <TeamOutlined style={{ color: '#10b981' }} />
                <span>活跃用户 Top 5</span>
              </Space>
            }
            extra={
              <a onClick={() => navigate('/admin/users')}>
                查看全部 <ArrowRightOutlined />
              </a>
            }
          >
            {topUsers.length === 0 ? (
              <Empty description="暂无登录数据" />
            ) : (
              <ul className="rank-list">
                {topUsers.map((u, i) => (
                  <li key={u.username}>
                    <span className={`rank-badge rank-${i + 1}`}>{i + 1}</span>
                    <span className="rank-icon">
                      <span
                        style={{
                          width: 28,
                          height: 28,
                          borderRadius: 6,
                          background: '#d1fae5',
                          color: '#059669',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 13,
                          fontWeight: 600,
                        }}
                      >
                        {(u.display_name || u.username || '?').slice(0, 1).toUpperCase()}
                      </span>
                    </span>
                    <span className="rank-name">{u.display_name || u.username}</span>
                    <span className="rank-count">{u.login_count.toLocaleString()} 次</span>
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
