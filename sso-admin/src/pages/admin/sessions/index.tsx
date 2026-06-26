import { Card } from 'antd';
import OnlineSessionTable from '@/components/OnlineSessionTable';
import './sessions.css';

export default function OnlineSessionsPage() {
  return (
    <Card className="session-page">
      <OnlineSessionTable />
    </Card>
  );
}
