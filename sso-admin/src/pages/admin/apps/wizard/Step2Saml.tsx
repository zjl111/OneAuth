import { Form, Input, Select, Radio, InputNumber, Alert, Collapse } from 'antd';
import { InfoCircleOutlined } from '@ant-design/icons';

const sectionStyle: React.CSSProperties = {
  border: '1px solid #eef0f5',
  borderRadius: 12,
  padding: '20px 28px 6px',
  background: '#fff',
};

const titleStyle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  color: '#1d2c5b',
  marginBottom: 16,
};

export default function Step2Saml() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Alert
        type="info"
        showIcon
        icon={<InfoCircleOutlined />}
        message="通常只需要填写业务系统（SP）的 Entity ID 和 ACS URL，其余保持默认即可"
      />

      {/* —— 必填配置 —— */}
      <div style={sectionStyle}>
        <div style={titleStyle}>必填配置</div>

        <Form.Item
          name="saml_entity_id"
          label="Entity ID"
          rules={[{ required: true, message: '请输入 SP Entity ID' }]}
          tooltip="业务系统（SP）的唯一标识，由业务系统提供。不是 OneAuth 自己的 Entity ID。"
          extra={<span style={{ color: '#94a3b8', fontSize: 12 }}>业务系统（SP）的唯一标识</span>}
        >
          <Input placeholder="urn:example:sp 或 https://sp.example.com/saml" />
        </Form.Item>

        <Form.Item
          name="saml_acs_url"
          label="ACS URL"
          rules={[{ required: true, message: '请输入 Assertion Consumer Service URL' }]}
          tooltip="业务系统（SP）的回调地址。OneAuth 签发登录断言后会把浏览器 302 到这里。由业务系统提供。"
          extra={<span style={{ color: '#94a3b8', fontSize: 12 }}>业务系统（SP）的回调地址</span>}
        >
          <Input placeholder="https://sp.example.com/saml/acs" />
        </Form.Item>

        <Form.Item
          name="saml_nameid_convert"
          label="登录账号字段"
          tooltip="作为 NameID 写入 SAML Assertion 的用户字段"
          extra={<span style={{ color: '#94a3b8', fontSize: 12 }}>对应业务系统中识别用户的字段</span>}
        >
          <Select
            options={[
              { value: 'original', label: '用户名' },
              { value: 'email',    label: '邮箱' },
              { value: 'mobile',   label: '手机号' },
              { value: 'employee', label: '工号' },
            ]}
          />
        </Form.Item>
      </div>

      {/* —— 高级配置 —— */}
      <Collapse
        ghost
        items={[
          {
            key: 'advanced',
            label: <span style={{ color: '#1d2c5b', fontWeight: 600 }}>高级配置（一般保持默认）</span>,
            children: (
              <div style={sectionStyle}>
                <Form.Item
                  name="saml_audience"
                  label="Audience"
                  tooltip="受众；留空则使用 Entity ID"
                >
                  <Input placeholder="留空则使用 Entity ID" />
                </Form.Item>

                <Form.Item
                  name="saml_issuer"
                  label="Issuer"
                  tooltip="OneAuth 签发方；留空使用 OneAuth 默认 issuer（站点 URL）"
                >
                  <Input placeholder="留空使用 OneAuth 默认 issuer" />
                </Form.Item>

                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: '0 32px' }}>
                  <Form.Item name="saml_binding" label="传输方式" rules={[{ required: true }]}>
                    <Select
                      options={[
                        { value: 'Redirect-Post',           label: 'Redirect → POST（推荐）' },
                        { value: 'Post-Post',               label: 'POST → POST' },
                        { value: 'IdpInit-Post',            label: 'IdP-Init → POST' },
                        { value: 'Redirect-PostSimpleSign', label: 'Redirect → PostSimpleSign' },
                        { value: 'Post-PostSimpleSign',     label: 'POST → PostSimpleSign' },
                      ]}
                    />
                  </Form.Item>
                  <Form.Item name="saml_nameid_format" label="NameID 格式" rules={[{ required: true }]}>
                    <Select
                      options={[
                        { value: 'unspecified',                label: 'unspecified（推荐）' },
                        { value: 'persistent',                 label: 'persistent' },
                        { value: 'transient',                  label: 'transient' },
                        { value: 'emailAddress',               label: 'emailAddress' },
                        { value: 'X509SubjectName',            label: 'X509SubjectName' },
                        { value: 'WindowsDomainQualifiedName', label: 'WindowsDomainQualifiedName' },
                        { value: 'entity',                     label: 'entity' },
                      ]}
                    />
                  </Form.Item>

                  <Form.Item name="saml_signature_algorithm" label="签名算法" rules={[{ required: true }]}>
                    <Select
                      options={[
                        { value: 'RSAwithSHA256', label: 'RSAwithSHA256（推荐）' },
                        { value: 'RSAwithSHA1',   label: 'RSAwithSHA1' },
                        { value: 'RSAwithSHA384', label: 'RSAwithSHA384' },
                        { value: 'RSAwithSHA512', label: 'RSAwithSHA512' },
                      ]}
                    />
                  </Form.Item>
                  <Form.Item name="saml_digest_algorithm" label="摘要算法" rules={[{ required: true }]}>
                    <Select
                      options={[
                        { value: 'SHA256', label: 'SHA256（推荐）' },
                        { value: 'SHA1',   label: 'SHA1' },
                        { value: 'SHA384', label: 'SHA384' },
                        { value: 'SHA512', label: 'SHA512' },
                      ]}
                    />
                  </Form.Item>

                  <Form.Item
                    name="saml_encrypted"
                    label="加密断言"
                    tooltip="是否加密 SAML Assertion"
                    getValueProps={(v) => ({ value: v ? 'yes' : 'no' })}
                    getValueFromEvent={(e) => e.target.value === 'yes'}
                  >
                    <Radio.Group buttonStyle="solid">
                      <Radio.Button value="yes">是</Radio.Button>
                      <Radio.Button value="no">否（推荐）</Radio.Button>
                    </Radio.Group>
                  </Form.Item>

                  <Form.Item
                    name="saml_validity_seconds"
                    label="断言有效期"
                    rules={[{ required: true }]}
                    extra={<span style={{ color: '#94a3b8', fontSize: 12 }}>建议 60 ~ 600 秒</span>}
                  >
                    <InputNumber min={30} max={3600} addonAfter="秒" style={{ width: '100%' }} />
                  </Form.Item>
                </div>

                <Form.Item
                  name="saml_certificate"
                  label="SP 公钥证书"
                  tooltip="业务系统（SP）的 X.509 公钥证书。仅在以下两种情况需要：1) 开启了上方「加密断言」；2) SP 会对 AuthnRequest 签名。否则留空即可。"
                  extra={
                    <span style={{ color: '#94a3b8', fontSize: 12 }}>
                      由业务系统（SP）提供，PEM 格式。多数对接不需要填，留空即可。
                    </span>
                  }
                >
                  <Input.TextArea
                    rows={5}
                    placeholder={'-----BEGIN CERTIFICATE-----\nMIIC...\n-----END CERTIFICATE-----'}
                  />
                </Form.Item>
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}
