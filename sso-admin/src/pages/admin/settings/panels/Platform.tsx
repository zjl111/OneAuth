import { Form, Input, Tag } from 'antd';
import type { SystemConfig } from '@/api/misc';
import { invalidateSiteCache } from '@/hooks/useSite';
import LogoUploader from '@/components/LogoUploader';
import { SectionHead, cardStyle } from './_shared';

export default function PlatformPanel({
  items,
  onLogoUrl,
  logoValue,
}: {
  items: SystemConfig[];
  form: any; // unused but kept for API compatibility
  accessToken: string | null;
  onLogoUrl: (url: string) => void;
  logoValue: string;
  message: any;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* 基本信息 */}
      <div style={cardStyle}>
        <SectionHead title="基本信息" />
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 360px', gap: 32, alignItems: 'start' }}>
          <div>
            <Form.Item label="网站主标题" name="platform.hero_title">
              <Input maxLength={50} showCount />
            </Form.Item>
            <Form.Item label="网站副标题" name="platform.hero_subtitle">
              <Input maxLength={100} showCount placeholder="例如：一键登录所有应用" />
            </Form.Item>
            <Form.Item label="网站描述" name="platform.hero_description">
              <Input.TextArea rows={3} maxLength={200} showCount placeholder="一句话描述平台" />
            </Form.Item>
          </div>
          <div>
            <div style={{ color: '#1d2c5b', fontWeight: 500, marginBottom: 6 }}>平台 Logo</div>
            <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 14 }}>
              建议使用透明背景的 PNG/SVG 格式，尺寸建议 240px × 240px
            </div>
            <LogoUploader
              value={logoValue}
              onChange={(u) => {
                onLogoUrl(u);
                invalidateSiteCache();
              }}
              onRemove={() => onLogoUrl('')}
              removeText="移除 Logo"
              size={200}
              buttonText="上传 Logo"
              uploadPath="/api/v1/configs/upload-logo"
              uploadPrefix="platform"
              tips={['支持 PNG / SVG / JPG', '最大 2MB']}
            />
            <Form.Item name="platform.logo" hidden><Input /></Form.Item>
          </div>
        </div>
      </div>

      {/* 平台配置 */}
      <div style={cardStyle}>
        <SectionHead title="平台配置" />
        <Form.Item label="平台名称" name="platform.name">
          <Input maxLength={50} showCount />
        </Form.Item>
        <Form.Item
          label={
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: '#1d2c5b', fontWeight: 500 }}>当前站点 URL</span>
              <Tag color="blue" style={{ margin: 0 }}>生产环境必须项</Tag>
            </div>
          }
          name="platform.site_url"
        >
          <Input placeholder="请输入当前站点 URL，例如：https://sso.example.com" />
        </Form.Item>
      </div>

      {/* 外观设置 */}
      <div style={cardStyle}>
        <SectionHead title="外观设置" />
        <Form.Item label="主题色" name="platform.theme_color">
          <Input type="color" style={{ width: 80, padding: 4 }} />
        </Form.Item>
      </div>

      {/* 兜底：自动渲染未识别的 platform.* 字段 */}
      {items
        .filter((c) => !['name', 'logo', 'theme_color', 'hero_title', 'hero_subtitle', 'hero_description', 'site_url'].includes(c.key))
        .map((c) => (
          <Form.Item
            key={c.id}
            label={c.description || c.key}
            name={`${c.category}.${c.key}`}
            extra={<span style={{ color: '#94a3b8', fontSize: 12 }}><code>{c.key}</code></span>}
          >
            <Input />
          </Form.Item>
        ))}
    </div>
  );
}
