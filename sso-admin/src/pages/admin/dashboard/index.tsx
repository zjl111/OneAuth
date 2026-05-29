import { useEffect, useState } from 'react';
import { Card, Col, Row, Empty, Tag, Space, Table } from 'antd';
import ChinaMap from '@/components/ChinaMap';
import {
  UserOutlined,
  AppstoreOutlined,
  LoginOutlined,
  WarningOutlined,
  RiseOutlined,
  ClockCircleOutlined,
  ArrowRightOutlined,
  MailOutlined,
  TeamOutlined,
  EnvironmentOutlined,
} from '@ant-design/icons';
import { DualAxes } from '@ant-design/charts';
import { useNavigate } from 'react-router-dom';
import { dashboardApi } from '@/api/misc';
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

export default function DashboardPage() {
  const navigate = useNavigate();
  const [stats, setStats] = useState({
    user_count: 0, login_today: 0, app_count: 0, abnormal_count: 0,
    uptime_percent: 100, monitor_total: 0,
    active_users: 0, active_window_minutes: 120,
  });
  const [trend, setTrend] = useState<Array<{ date: string; count: number }>>([]);
  const [dist, setDist] = useState<Array<{ client_id: string; client_name: string; count: number }>>([]);
  const [regionTop, setRegionTop] = useState<Array<{ province: string; count: number }>>([]);

  useEffect(() => {
    dashboardApi.stats().then(setStats);
    dashboardApi.loginTrends(30).then((d) => setTrend(d || []));
    dashboardApi.appDistribution(30).then((d) => setDist(d || []));
    dashboardApi.regionTop10(30).then((d) => setRegionTop(d || []));
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

      {/* 1.5 中国地图 TOP10 访问统计 */}
      <Card
        className="dash-card region-card"
        style={{ marginTop: 16 }}
        title={
          <Space>
            <EnvironmentOutlined style={{ color: '#1677ff' }} />
            <span style={{ fontSize: 16, fontWeight: 600, color: '#1d2c5b' }}>30 日 TOP10 访问统计</span>
          </Space>
        }
      >
        <Row gutter={[16, 16]} align="top">
          <Col xs={24} xl={16}>
            <ChinaMap data={regionTop} height={520} />
          </Col>
          <Col xs={24} xl={8} style={{ display: 'flex', justifyContent: 'center', alignItems: 'flex-start', paddingTop: 0 }}>
            <div style={{ width: '80%' }}>
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
                    width: 60,
                    align: 'center',
                    render: (_, _r, i) => <span className={`rank-badge rank-${i + 1}`}>{i + 1}</span>,
                  },
                  { title: '省份', dataIndex: 'province', align: 'center' },
                  { title: '浏览量(PV)', dataIndex: 'count', align: 'center' },
                ]}
              />
            </div>
          </Col>
        </Row>
      </Card>

      {/* 2. 中部：登录趋势(柱+线) + 热门应用排行（窄） */}
      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} xl={18}>
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
              <DualAxes
                data={[trend, trend]}
                xField="date"
                yField={['count', 'count']}
                height={300}
                geometryOptions={[
                  {
                    geometry: 'column',
                    color: '#3b82f6',
                    columnWidthRatio: 0.55,
                    label: undefined,
                  },
                  {
                    geometry: 'line',
                    color: '#1677ff',
                    lineStyle: { lineWidth: 2 },
                    point: {
                      size: 3,
                      shape: 'circle',
                      style: { fill: '#fff', stroke: '#1677ff', lineWidth: 2 },
                    },
                  },
                ]}
                legend={{
                  layout: 'horizontal',
                  position: 'top-left',
                  itemName: {
                    formatter: (text: string) => (text === 'count' ? '登录次数' : '趋势'),
                  },
                }}
                yAxis={{
                  count: {
                    grid: { line: { style: { lineDash: [3, 3], stroke: '#eef0f5' } } },
                  },
                  count2: { grid: null as any, label: null as any },
                }}
                xAxis={{ tickCount: 14, label: { autoRotate: false } }}
                meta={{
                  count: { alias: '登录次数' },
                }}
              />
            )}
          </Card>
        </Col>
        <Col xs={24} xl={6}>
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
                {dist.slice(0, 10).map((d, i) => (
                  <li key={d.client_id}>
                    <span className={`rank-badge rank-${i + 1}`}>{i + 1}</span>
                    <span className="rank-icon">
                      <MailOutlined />
                    </span>
                    <span className="rank-name">{d.client_name}</span>
                    <span className="rank-count">{d.count.toLocaleString()}</span>
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
