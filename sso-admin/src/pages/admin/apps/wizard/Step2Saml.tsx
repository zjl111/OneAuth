import { Form, Input, Select, Radio, InputNumber } from 'antd';

export default function Step2Saml() {
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
        name="saml_entity_id"
        label="Entity ID"
        rules={[{ required: true, message: '请输入 SP Entity ID' }]}
        tooltip="服务提供方（SP）的唯一标识，由对方 metadata 给出"
      >
        <Input placeholder="urn:example:sp 或 https://sp.example.com/saml" />
      </Form.Item>

      <Form.Item
        name="saml_acs_url"
        label="ACS URL"
        rules={[{ required: true, message: '请输入 Assertion Consumer Service URL' }]}
        tooltip="IdP 签发断言后回调到 SP 的地址"
      >
        <Input placeholder="https://sp.example.com/saml/acs" />
      </Form.Item>

      <Form.Item name="saml_audience" label="Audience">
        <Input placeholder="留空则使用 Entity ID" />
      </Form.Item>

      <Form.Item name="saml_issuer" label="Issuer (IdP)">
        <Input placeholder="留空使用 OneAuth 默认 issuer" />
      </Form.Item>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: '0 32px' }}>
        <Form.Item name="saml_binding" label="Binding" rules={[{ required: true }]}>
          <Select
            options={[
              { value: 'Redirect-Post',            label: 'Redirect → POST' },
              { value: 'Post-Post',                label: 'POST → POST' },
              { value: 'IdpInit-Post',             label: 'IdP-Init → POST' },
              { value: 'Redirect-PostSimpleSign',  label: 'Redirect → PostSimpleSign' },
              { value: 'Post-PostSimpleSign',      label: 'POST → PostSimpleSign' },
            ]}
          />
        </Form.Item>
        <Form.Item name="saml_nameid_format" label="NameID Format" rules={[{ required: true }]}>
          <Select
            options={[
              { value: 'unspecified',                label: 'unspecified' },
              { value: 'persistent',                 label: 'persistent' },
              { value: 'transient',                  label: 'transient' },
              { value: 'emailAddress',               label: 'emailAddress' },
              { value: 'X509SubjectName',            label: 'X509SubjectName' },
              { value: 'WindowsDomainQualifiedName', label: 'WindowsDomainQualifiedName' },
              { value: 'entity',                     label: 'entity' },
            ]}
          />
        </Form.Item>

        <Form.Item name="saml_nameid_convert" label="NameID 转换">
          <Select
            options={[
              { value: 'original',  label: '保持原样' },
              { value: 'uppercase', label: '转大写' },
              { value: 'lowercase', label: '转小写' },
            ]}
          />
        </Form.Item>

        <Form.Item name="saml_signature_algorithm" label="签名算法" rules={[{ required: true }]}>
          <Select
            options={[
              { value: 'RSAwithSHA256', label: 'RSAwithSHA256' },
              { value: 'RSAwithSHA1',   label: 'RSAwithSHA1' },
              { value: 'RSAwithSHA384', label: 'RSAwithSHA384' },
              { value: 'RSAwithSHA512', label: 'RSAwithSHA512' },
            ]}
          />
        </Form.Item>
        <Form.Item name="saml_digest_algorithm" label="摘要算法" rules={[{ required: true }]}>
          <Select
            options={[
              { value: 'SHA256', label: 'SHA256' },
              { value: 'SHA1',   label: 'SHA1' },
              { value: 'SHA384', label: 'SHA384' },
              { value: 'SHA512', label: 'SHA512' },
            ]}
          />
        </Form.Item>

        <Form.Item
          name="saml_encrypted"
          label="加密 Assertion"
          getValueProps={(v) => ({ value: v ? 'yes' : 'no' })}
          getValueFromEvent={(e) => e.target.value === 'yes'}
        >
          <Radio.Group buttonStyle="solid">
            <Radio.Button value="yes">是</Radio.Button>
            <Radio.Button value="no">否</Radio.Button>
          </Radio.Group>
        </Form.Item>

        <Form.Item
          name="saml_validity_seconds"
          label="断言有效期"
          rules={[{ required: true }]}
          extra={<span style={{ color: '#94a3b8', fontSize: 12 }}>建议值：60 ~ 600 秒</span>}
        >
          <InputNumber min={30} max={3600} addonAfter="秒" style={{ width: '100%' }} />
        </Form.Item>
      </div>

      <Form.Item
        name="saml_certificate"
        label="SP 公钥证书"
        tooltip="粘贴 PEM 格式的 X.509 证书（用于校验 SP 签名 / 加密 Assertion）"
      >
        <Input.TextArea
          rows={5}
          placeholder={'-----BEGIN CERTIFICATE-----\nMIIC...\n-----END CERTIFICATE-----'}
        />
      </Form.Item>
    </div>
  );
}
