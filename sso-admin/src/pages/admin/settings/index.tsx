import { useEffect, useMemo, useState } from 'react';
import { Card, Form, Input, InputNumber, Button, App as AntdApp, Tabs, Skeleton } from 'antd';
import { configApi, type SystemConfig } from '@/api/misc';
import { invalidateSiteCache } from '@/hooks/useSite';
import { useAuthStore } from '@/store/authStore';
import request from '@/api/request';

import PlatformPanel from './panels/Platform';
import MonitorPanel from './panels/Monitor';
import SecurityPanel from './panels/Security';
import SmtpPanel from './panels/Smtp';
import LdapPanel from './panels/Ldap';
import WecomPanel from './panels/Wecom';

const NUMERIC_SECURITY_KEYS = new Set([
  'session_timeout',
  'password_min_length',
  'login_lockout_threshold',
  'login_lockout_duration',
]);
const NUMERIC_MONITOR_KEYS = new Set(['interval']);
const NUMERIC_SMTP_KEYS = new Set(['port']);
const PASSWORD_SMTP_KEYS = new Set(['password']);
const PASSWORD_LDAP_KEYS = new Set(['bind_password']);
const PASSWORD_WECOM_KEYS = new Set(['secret']);

const categoryLabel: Record<string, string> = {
  platform: '平台信息',
  security: '安全策略',
  monitor: '监控设置',
  smtp: '邮件 (SMTP)',
  ldap: 'LDAP / AD',
  wecom: '企业微信',
};

function isNumeric(category: string, key: string) {
  if (category === 'security') return NUMERIC_SECURITY_KEYS.has(key);
  if (category === 'monitor') return NUMERIC_MONITOR_KEYS.has(key);
  if (category === 'smtp') return NUMERIC_SMTP_KEYS.has(key);
  return false;
}

export default function SettingsPage() {
  const { message, modal } = AntdApp.useApp();
  const [data, setData] = useState<SystemConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [form] = Form.useForm();
  const accessToken = useAuthStore((s) => s.accessToken);

  const load = async () => {
    setLoading(true);
    const d = await configApi.list();
    setData(d);
    setLoading(false);
    const obj: Record<string, string | number | boolean> = {};
    d.forEach((c) => {
      const isPasswordField =
        (c.category === 'smtp' && PASSWORD_SMTP_KEYS.has(c.key)) ||
        (c.category === 'ldap' && PASSWORD_LDAP_KEYS.has(c.key)) ||
        (c.category === 'wecom' && PASSWORD_WECOM_KEYS.has(c.key));
      const isBoolSwitch =
        (c.category === 'monitor' && c.key === 'public_status_page') ||
        (c.category === 'smtp' && c.key === 'enabled') ||
        (c.category === 'ldap' && (c.key === 'enabled' || c.key === 'start_tls')) ||
        (c.category === 'wecom' && (c.key === 'enabled' || c.key === 'auto_create_user'));
      if (isPasswordField) {
        obj[`${c.category}.${c.key}`] = '';
      } else if (isBoolSwitch) {
        obj[`${c.category}.${c.key}`] = c.value === 'true';
      } else {
        obj[`${c.category}.${c.key}`] = isNumeric(c.category, c.key) ? Number(c.value) : c.value;
      }
    });
    form.setFieldsValue(obj);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const grouped = useMemo(() => {
    // 强制 tab 顺序：平台信息 > 监控设置 > 安全策略 > SMTP
    const order = ['platform', 'monitor', 'security', 'smtp', 'ldap', 'wecom'];
    const g: Record<string, SystemConfig[]> = {};
    order.forEach((k) => (g[k] = []));
    data.forEach((c) => {
      if (c.category === 'oauth') return; // OAuth/OIDC 已下沉到应用级别
      (g[c.category] ||= []).push(c);
    });
    for (const k of Object.keys(g)) {
      if (g[k].length === 0) delete g[k];
    }
    return g;
  }, [data]);

  const handleSave = async () => {
    const values = form.getFieldsValue();
    const items: Array<{ category: string; key: string; value: string }> = [];
    for (const [k, v] of Object.entries(values)) {
      if (v == null) continue;
      const [category, ...rest] = k.split('.');
      const key = rest.join('.');
      if (category === 'smtp' && PASSWORD_SMTP_KEYS.has(key) && v === '') continue;
      if (category === 'ldap' && PASSWORD_LDAP_KEYS.has(key) && v === '') continue;
      if (category === 'wecom' && PASSWORD_WECOM_KEYS.has(key) && v === '') continue;
      const strVal = typeof v === 'boolean' ? (v ? 'true' : 'false') : String(v);
      items.push({ category, key, value: strVal });
    }
    await configApi.set(items);
    invalidateSiteCache();
    message.success('已保存');
    load();
  };

  const logoValue = (Form.useWatch('platform.logo', form) as string | undefined) || '';

  const testSMTP = () => {
    let to = '';
    modal.confirm({
      title: '发送测试邮件',
      content: (
        <Input placeholder="测试收件邮箱" onChange={(e) => (to = e.target.value)} />
      ),
      okText: '发送',
      onOk: async () => {
        if (!to) {
          message.error('请输入收件邮箱');
          return Promise.reject();
        }
        try {
          await request.post('/configs/test-smtp', { to });
          message.success(`已发送测试邮件到 ${to}`);
        } catch (e: any) {
          message.error(e?.response?.data?.message || '发送失败');
        }
      },
    });
  };

  const [activeTab, setActiveTab] = useState<string>('platform');

  if (loading && data.length === 0) {
    return (
      <Card>
        <Skeleton active paragraph={{ rows: 8 }} />
      </Card>
    );
  }

  return (
    <Card>
      <Form form={form} layout="vertical">
        <Tabs
          activeKey={activeTab}
          onChange={setActiveTab}
          items={Object.entries(grouped).map(([cat, items]) => ({
            key: cat,
            label: categoryLabel[cat] || cat,
            children: (
              <>
                {cat === 'platform' && (
                  <PlatformPanel
                    items={items}
                    form={form}
                    accessToken={accessToken}
                    onLogoUrl={(u) => form.setFieldValue('platform.logo', u)}
                    logoValue={logoValue}
                    message={message}
                  />
                )}
                {cat === 'smtp' && (
                  <SmtpPanel onTest={testSMTP} onSave={handleSave} onReset={load} />
                )}
                {cat === 'security' && <SecurityPanel />}
                {cat === 'monitor' && <MonitorPanel />}
                {cat === 'ldap' && <LdapPanel />}
                {cat === 'wecom' && <WecomPanel />}
                {/* 其余分组（如未来新增）走兜底渲染 */}
                {!['platform', 'smtp', 'security', 'monitor', 'ldap', 'wecom'].includes(cat) && items.map((c) => (
                  <Form.Item key={c.id} label={c.description || c.key} name={`${c.category}.${c.key}`}>
                    {isNumeric(c.category, c.key)
                      ? <InputNumber min={0} style={{ width: '100%' }} />
                      : <Input />}
                  </Form.Item>
                ))}
              </>
            ),
          }))}
        />
        {activeTab !== 'smtp' && (
          <Button type="primary" onClick={handleSave}>
            保存
          </Button>
        )}
      </Form>
    </Card>
  );
}
