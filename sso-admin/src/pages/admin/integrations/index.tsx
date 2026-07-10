import { Card, Tabs } from 'antd';
import './integrations.css';
import LdapConfigPanel from './LdapConfigPanel';
import WecomConfigPanel from './WecomConfigPanel';
import DirectorySyncPanel from './DirectorySyncPanel';

export default function IntegrationsPage() {
  return (
    <div className="integrations-page">
      <Card>
        <Tabs
          defaultActiveKey="ldap"
          items={[
            {
              key: 'ldap',
              label: 'LDAP / AD',
              children: <LdapConfigPanel />,
            },
            {
              key: 'wecom',
              label: '企业微信',
              children: <WecomConfigPanel />,
            },
            {
              key: 'directory',
              label: '用户同步',
              children: <DirectorySyncPanel />,
            },
          ]}
        />
      </Card>
    </div>
  );
}
