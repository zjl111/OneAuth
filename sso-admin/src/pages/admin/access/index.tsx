import { Card, Tabs } from 'antd';
import LoginRulesPage from '../login-rules';
import OnlineSessionTable from '@/components/OnlineSessionTable';

export default function AccessPage() {
  return (
    <Card>
      <Tabs
        items={[
          {
            key: 'rules',
            label: '用户登录控制',
            children: <LoginRulesPage />,
          },
          {
            key: 'sessions',
            label: '在线会话',
            children: <OnlineSessionTable />,
          },
        ]}
      />
    </Card>
  );
}
