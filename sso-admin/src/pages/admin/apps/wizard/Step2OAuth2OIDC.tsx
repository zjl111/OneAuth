import { Form, Input, Select, Radio, InputNumber, Switch, Tag, Collapse } from 'antd';

export default function Step2OAuth2OIDC({ isOIDC }: { isOIDC: boolean }) {
  return (
    <div
      className="app-wizard-step2"
      style={{
        border: '1px solid #eef0f5',
        borderRadius: 12,
        padding: '32px 40px 16px',
        background: '#fff',
      }}
    >
      <Form.Item
        name="redirect_uris"
        label="回调地址"
        tooltip="多个回调地址换行分隔，格式如 https://app.example.com/callback"
        rules={[{ required: true, message: '请填写至少一个回调地址' }]}
        getValueFromEvent={(e) =>
          typeof e?.target?.value === 'string'
            ? e.target.value.split('\n').map((s: string) => s.trim()).filter(Boolean)
            : e
        }
        getValueProps={(v) => ({ value: Array.isArray(v) ? v.join('\n') : v })}
      >
        <Input.TextArea rows={4} placeholder="https://app.example.com/callback" />
      </Form.Item>

      <Form.Item name="grant_types" label="授权方式" rules={[{ required: true }]}>
        <Select
          mode="multiple"
          options={[{ value: 'authorization_code', label: 'authorization_code' }]}
        />
      </Form.Item>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: '0 32px' }}>
        <Form.Item name="subject_type" label="用户标识字段" rules={[{ required: true }]}>
          <Select
            options={[
              { value: 'username', label: '用户名' },
              { value: 'user_id',  label: '用户 UUID' },
              { value: 'email',    label: '邮箱' },
              { value: 'mobile',   label: '手机号' },
            ]}
          />
        </Form.Item>
        <Form.Item
          name="scope"
          label="作用域"
          rules={[{ required: true, message: '至少配置一个 Scope' }]}
        >
          <Select
            mode="multiple"
            placeholder="选择需要的作用域"
            options={[
              ...(isOIDC ? [{ value: 'openid', label: 'openid', disabled: true }] : []),
              { value: 'profile', label: 'profile' },
              { value: 'email',   label: 'email' },
              { value: 'phone',   label: 'phone' },
              { value: 'roles',   label: 'roles' },
              { value: 'read',    label: 'read' },
              { value: 'write',   label: 'write' },
            ]}
            tagRender={isOIDC ? ({ label, value, closable, onClose }) => {
              if (value === 'openid') {
                return (
                  <Tag color="default" style={{ marginInlineEnd: 4, color: '#94a3b8', cursor: 'not-allowed' }}>
                    {label}
                  </Tag>
                );
              }
              return (
                <Tag closable={closable} onClose={onClose} style={{ marginInlineEnd: 4 }}>
                  {label}
                </Tag>
              );
            } : undefined}
          />
        </Form.Item>

        <Form.Item
          name="require_consent"
          label="许可确认"
          rules={[{ required: true }]}
          tooltip="强制：每次首次授权需用户点击确认；自动：跳过同意页"
          getValueProps={(v) => ({ value: v ? 'force' : 'auto' })}
          getValueFromEvent={(e) => e.target.value === 'force'}
        >
          <Radio.Group buttonStyle="solid">
            <Radio.Button value="force">强制</Radio.Button>
            <Radio.Button value="auto">自动</Radio.Button>
          </Radio.Group>
        </Form.Item>
        <Form.Item
          name="require_pkce"
          label="PKCE"
          rules={[{ required: true }]}
          getValueProps={(v) => ({ value: v ? 'yes' : 'no' })}
          getValueFromEvent={(e) => e.target.value === 'yes'}
        >
          <Radio.Group buttonStyle="solid">
            <Radio.Button value="yes">是</Radio.Button>
            <Radio.Button value="no">否</Radio.Button>
          </Radio.Group>
        </Form.Item>

        <Form.Item
          name="issue_refresh_token"
          label="签发 Refresh Token"
          valuePropName="checked"
          extra={<span style={{ color: '#94a3b8', fontSize: 12 }}>关闭后将不再下发 refresh_token</span>}
        >
          <Switch />
        </Form.Item>
        <Form.Item
          shouldUpdate={(p, n) => p.issue_refresh_token !== n.issue_refresh_token}
          noStyle
        >
          {({ getFieldValue }) => (
            <Form.Item
              name="refresh_token_ttl"
              label="Refresh Token 有效期"
              rules={[{ required: !!getFieldValue('issue_refresh_token') }]}
              extra={<span style={{ color: '#94a3b8', fontSize: 12 }}>建议值：86400 ~ 604800 秒</span>}
            >
              <InputNumber
                min={60}
                max={31536000}
                addonAfter="秒"
                style={{ width: '100%' }}
                disabled={!getFieldValue('issue_refresh_token')}
              />
            </Form.Item>
          )}
        </Form.Item>
        <Form.Item
          name="access_token_ttl"
          label="Access Token 有效期"
          rules={[{ required: true }]}
          extra={<span style={{ color: '#94a3b8', fontSize: 12 }}>建议值：3600 ~ 86400 秒</span>}
        >
          <InputNumber min={60} max={86400} addonAfter="秒" style={{ width: '100%' }} />
        </Form.Item>
        {isOIDC && (
          <Form.Item
            name="id_token_ttl"
            label="ID Token 有效期"
            rules={[{ required: true }]}
            extra={<span style={{ color: '#94a3b8', fontSize: 12 }}>建议值：3600 ~ 86400 秒</span>}
          >
            <InputNumber min={60} max={86400} addonAfter="秒" style={{ width: '100%' }} />
          </Form.Item>
        )}
      </div>

      {isOIDC && (
        <Collapse
          ghost
          style={{ marginTop: 8 }}
          items={[
            {
              key: 'oidc-advanced',
              label: <span style={{ color: '#1d2c5b', fontWeight: 600 }}>高级配置（OpenID Connect）</span>,
              children: (
                <>
                  <Form.Item name="oidc_issuer" label="签发人">
                    <Input placeholder="留空则使用默认 issuer（系统地址）" />
                  </Form.Item>
                  <Form.Item name="oidc_audience" label="受众">
                    <Input placeholder="留空则使用 client_id" />
                  </Form.Item>
                  <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: '0 32px' }}>
                    <Form.Item
                      name="oidc_id_token_signing_alg"
                      label="ID Token 签名"
                      rules={[{ required: true }]}
                    >
                      <Select
                        options={[
                          { value: 'RS256', label: 'RS256' },
                          { value: 'RS384', label: 'RS384' },
                          { value: 'RS512', label: 'RS512' },
                          { value: 'HS256', label: 'HS256' },
                          { value: 'HS384', label: 'HS384' },
                          { value: 'HS512', label: 'HS512' },
                        ]}
                      />
                    </Form.Item>
                    <Form.Item
                      name="oidc_userinfo_response"
                      label="用户信息接口响应格式"
                      rules={[{ required: true }]}
                      tooltip="/userinfo 接口返回的格式：普通 JSON / 签名 JWT / 加密 JWT / 签名后加密"
                    >
                      <Select
                        options={[
                          { value: 'NORMAL',              label: '普通 JSON' },
                          { value: 'SIGNING',             label: '签名 JWT' },
                          { value: 'ENCRYPTION',          label: '加密 JWT' },
                          { value: 'SIGNING_ENCRYPTION',  label: '签名并加密 JWT' },
                        ]}
                      />
                    </Form.Item>
                  </div>
                  <Form.Item
                    name="oidc_claims"
                    label="返回用户字段"
                    tooltip="ID Token 与 /userinfo 接口下发的用户字段。当前后端默认全部下发，配置仅作为前端展示。"
                  >
                    <Select
                      mode="multiple"
                      placeholder="默认全部下发"
                      options={[
                        { value: 'name',       label: 'name（姓名/昵称）' },
                        { value: 'email',      label: 'email（邮箱）' },
                        { value: 'phone',      label: 'phone（手机号）' },
                        { value: 'roles',      label: 'roles（角色列表）' },
                        { value: 'is_staff',   label: 'is_staff（是否管理员）' },
                        { value: 'department', label: 'department（部门）' },
                        { value: 'position',   label: 'position（岗位）' },
                      ]}
                    />
                  </Form.Item>
                </>
              ),
            },
          ]}
        />
      )}
    </div>
  );
}
