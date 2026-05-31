import { useState } from 'react';
import { Form, Input, Select, Radio, InputNumber, Alert, Collapse, Button, Space, App as AntdApp } from 'antd';
import { InfoCircleOutlined, ImportOutlined } from '@ant-design/icons';
import { post } from '@/api/request';

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
  const form = Form.useFormInstance();
  const { message } = AntdApp.useApp();
  const [metaInput, setMetaInput] = useState('');
  const [metaMode, setMetaMode] = useState<'url' | 'xml'>('url');
  const [importing, setImporting] = useState(false);

  const handleImport = async () => {
    const v = metaInput.trim();
    if (!v) {
      message.warning('请粘贴 SP metadata URL 或 XML 文本');
      return;
    }
    setImporting(true);
    try {
      const payload: any = {};
      if (metaMode === 'url') payload.url = v;
      else payload.xml = v;
      const d: any = await post('/apps/saml/parse-metadata', payload);
      const patch: any = {};
      if (d?.entity_id) patch.saml_entity_id = d.entity_id;
      if (d?.acs_url) patch.saml_acs_url = d.acs_url;
      if (d?.binding) patch.saml_binding = d.binding;
      if (d?.nameid_format) patch.saml_nameid_format = d.nameid_format;
      if (d?.certificate) patch.saml_certificate = d.certificate;
      form.setFieldsValue(patch);
      const filled = Object.keys(patch).length;
      if (filled === 0) {
        message.warning('解析成功但未抽取到任何字段，请检查 metadata 内容');
      } else {
        message.success(`已自动填入 ${filled} 项配置`);
      }
    } catch (e: any) {
      message.error(e?.response?.data?.message || '解析失败');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Alert
        type="info"
        showIcon
        icon={<InfoCircleOutlined />}
        message="通常只需要填写业务系统（SP）的 Entity ID 和 ACS URL，其余保持默认即可"
      />

      {/* —— 一键导入 SP Metadata —— */}
      <div style={sectionStyle}>
        <div style={titleStyle}>从 SP Metadata 一键导入（可选）</div>
        <Space.Compact style={{ width: '100%', marginBottom: 8 }}>
          <Select
            value={metaMode}
            onChange={setMetaMode}
            style={{ width: 110 }}
            options={[
              { value: 'url', label: 'URL' },
              { value: 'xml', label: 'XML 文本' },
            ]}
          />
          {metaMode === 'url' ? (
            <Input
              placeholder="https://sp.example.com/saml/metadata"
              value={metaInput}
              onChange={(e) => setMetaInput(e.target.value)}
              onPressEnter={handleImport}
            />
          ) : (
            <Input.TextArea
              rows={4}
              placeholder="粘贴 SP metadata XML（以 <EntityDescriptor 开头）"
              value={metaInput}
              onChange={(e) => setMetaInput(e.target.value)}
            />
          )}
          <Button type="primary" icon={<ImportOutlined />} loading={importing} onClick={handleImport}>
            导入
          </Button>
        </Space.Compact>
        <span style={{ color: '#94a3b8', fontSize: 12 }}>
          解析 SP 的 Entity ID / ACS URL / Binding / NameID Format / 公钥证书并自动填入下方字段
        </span>
      </div>

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
          label="用户标识字段"
          tooltip="OneAuth 返回给业务系统作为登录账号的用户字段"
          extra={
            <span style={{ color: '#94a3b8', fontSize: 12 }}>
              OneAuth 返回给业务系统作为登录账号的用户字段
            </span>
          }
        >
          <Select
            options={[
              { value: 'original', label: '用户名' },
              { value: 'email',    label: '邮箱' },
              { value: 'mobile',   label: '手机号' },
              { value: 'user_id',  label: '用户 UUID' },
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
                  <Form.Item
                    noStyle
                    shouldUpdate={(p, n) =>
                      p.saml_nameid_convert !== n.saml_nameid_convert ||
                      p.saml_nameid_format !== n.saml_nameid_format
                    }
                  >
                    {({ getFieldValue }) => {
                      const subject = getFieldValue('saml_nameid_convert');
                      const format = getFieldValue('saml_nameid_format');
                      let warn = '';
                      if (subject === 'email' && format !== 'emailAddress') {
                        warn = '建议「NameID 格式」选择 emailAddress';
                      } else if (subject !== 'email' && format === 'emailAddress') {
                        warn = '当前用户标识不是邮箱，「NameID 格式」一般保持 unspecified';
                      }
                      return (
                        <Form.Item
                          name="saml_nameid_format"
                          label="NameID 格式"
                          rules={[{ required: true }]}
                          extra={
                            warn ? (
                              <span style={{ color: '#d97706', fontSize: 12 }}>{warn}</span>
                            ) : (
                              <span style={{ color: '#94a3b8', fontSize: 12 }}>默认 unspecified；选择邮箱时可改为 emailAddress</span>
                            )
                          }
                        >
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
                      );
                    }}
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
                      <Radio.Button value="no">否</Radio.Button>
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
                  noStyle
                  shouldUpdate={(p, n) => p.saml_encrypted !== n.saml_encrypted}
                >
                  {({ getFieldValue }) => {
                    const enc = !!getFieldValue('saml_encrypted');
                    if (!enc) {
                      return (
                        <Form.Item label="SP 公钥证书">
                          <span style={{ color: '#94a3b8', fontSize: 12 }}>
                            仅在开启「加密断言」时需要填写，由业务系统 SP 提供 PEM 格式公钥证书。
                          </span>
                          <Form.Item name="saml_certificate" hidden>
                            <Input.TextArea />
                          </Form.Item>
                        </Form.Item>
                      );
                    }
                    return (
                      <Form.Item
                        name="saml_certificate"
                        label="SP 公钥证书"
                        rules={[{ required: true, message: '开启加密断言时必须提供 SP 公钥证书' }]}
                        tooltip="业务系统（SP）的 X.509 公钥证书。仅在开启「加密断言」时必填。"
                        extra={
                          <span style={{ color: '#94a3b8', fontSize: 12 }}>
                            由业务系统（SP）提供，PEM 格式
                          </span>
                        }
                      >
                        <Input.TextArea
                          rows={5}
                          placeholder={'-----BEGIN CERTIFICATE-----\nMIIC...\n-----END CERTIFICATE-----'}
                        />
                      </Form.Item>
                    );
                  }}
                </Form.Item>
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}
