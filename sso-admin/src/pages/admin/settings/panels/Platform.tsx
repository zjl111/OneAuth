import React, { useMemo } from 'react';
import { Form, Input, Upload, Button, Radio, Tag, Popconfirm } from 'antd';
import type { SystemConfig } from '@/api/misc';
import { SectionHead, cardStyle } from './_shared';

/* ================================================================
   预设主题色
   ================================================================ */
const DEFAULT_THEME_COLOR = '#1677ff';

const PRESET_THEMES: { label: string; color: string }[] = [
  { label: '默认', color: '#1677ff' },
  { label: '琥珀金', color: '#D9AE2C' },
  { label: '橄榄绿', color: '#6B8E23' },
  { label: '珊瑚橘', color: '#EC8D61' },
  { label: '晚霞紫', color: '#9284B4' },
  { label: '暖砂灰', color: '#DFD6D6' },
];

/* ================================================================
   主题色 + 登录方式 —— 顶部一行，标签对齐
   ================================================================ */
function TopBar({ form }: { form: any }) {
  const currentColor = (Form.useWatch('platform.theme_color', form) as string) || DEFAULT_THEME_COLOR;
  const isCustom = !PRESET_THEMES.some((t) => t.color.toLowerCase() === currentColor.toLowerCase());

  const pickPreset = (color: string) => {
    form.setFieldValue('platform.theme_color', color);
  };

  return (
    <div style={{ ...cardStyle, display: 'flex', gap: 32, flexWrap: 'wrap' }}>
      {/* 始终注册表单字段 */}
      <Form.Item name="platform.theme_color" initialValue={DEFAULT_THEME_COLOR} style={{ display: 'none' }}>
        <input type="hidden" />
      </Form.Item>

      {/* 左组：主题色 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, flex: 1, minWidth: 280 }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: '#374151' }}>主题色</span>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {PRESET_THEMES.map((t) => {
            const active = t.color.toLowerCase() === currentColor.toLowerCase();
            return (
              <div
                key={t.color}
                onClick={() => pickPreset(t.color)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '5px 12px 5px 8px',
                  borderRadius: 6,
                  cursor: 'pointer',
                  fontSize: 13,
                  color: active ? 'var(--primary-color)' : '#374151',
                  fontWeight: active ? 600 : 400,
                  background: active ? '#f0f5ff' : 'transparent',
                  border: active ? '1px solid var(--primary-color)' : '1px solid transparent',
                  transition: 'all 0.2s',
                  userSelect: 'none',
                }}
              >
                <span
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: 4,
                    background: t.color,
                    display: 'inline-block',
                    flexShrink: 0,
                    border: '1px solid rgba(0,0,0,0.08)',
                  }}
                />
                {t.label}
              </div>
            );
          })}
          <div
            onClick={() => {
              if (!isCustom && currentColor === DEFAULT_THEME_COLOR) {
                form.setFieldValue('platform.theme_color', '#1678ff');
              }
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '5px 12px 5px 8px',
              borderRadius: 6,
              cursor: 'pointer',
              fontSize: 13,
              color: isCustom ? 'var(--primary-color)' : '#374151',
              fontWeight: isCustom ? 600 : 400,
              background: isCustom ? '#f0f5ff' : 'transparent',
              border: isCustom ? '1px solid var(--primary-color)' : '1px solid transparent',
              transition: 'all 0.2s',
              userSelect: 'none',
            }}
          >
            <span
              style={{
                width: 14,
                height: 14,
                borderRadius: 4,
                background: 'conic-gradient(red, yellow, lime, aqua, blue, magenta, red)',
                display: 'inline-block',
                flexShrink: 0,
                border: '1px solid rgba(0,0,0,0.08)',
              }}
            />
            自定义
          </div>
          {isCustom && (
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: 6,
                overflow: 'hidden',
                border: '1px solid #e5e7eb',
                cursor: 'pointer',
              }}
            >
              <input
                type="color"
                value={currentColor}
                onChange={(e) => form.setFieldValue('platform.theme_color', e.target.value)}
                style={{ width: '100%', height: '100%', border: 'none', padding: 0, cursor: 'pointer', display: 'block' }}
              />
            </div>
          )}
        </div>
      </div>

      {/* 分隔线 */}
      <div style={{ width: 1, alignSelf: 'stretch', background: '#e5e7eb', flexShrink: 0 }} />

      {/* 右组：登录方式 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: '#374151' }}>登录方式</span>
        <Form.Item name="platform.login_style" initialValue="modal" style={{ marginBottom: 0 }}>
          <Radio.Group>
            <Radio.Button value="modal">弹框登录</Radio.Button>
            <Radio.Button value="inline">嵌入登录</Radio.Button>
          </Radio.Group>
        </Form.Item>
      </div>
    </div>
  );
}

/* ================================================================
   登录页预览 —— 根据当前选择的登录方式渲染单个预览
   ================================================================ */
function LoginPreview({
  logo,
  loginBg,
  loginLogo,
  siteName,
  heroTitle,
  heroDescription,
  loginStyle,
}: {
  logo?: string;
  loginBg?: string;
  loginLogo?: string;
  siteName?: string;
  heroTitle?: string;
  heroDescription?: string;
  loginStyle?: string;
}) {
  const displayLogo = logo || '/logo.png';
  const displayName = siteName || 'OneAuth';
  const displayTitle = heroTitle || '一键登录所有应用';
  const displayDesc = heroDescription || `${displayName} 是一个简单、安全、开源的 SSO 单点登录项目`;
  const style = loginStyle || 'modal';

  /* 迷你登录表单 */
  const loginFormMini = (
    <div style={{ width: 200, background: '#fff', borderRadius: 8, padding: '14px 12px', boxShadow: '0 4px 20px rgba(0,0,0,0.12)', flexShrink: 0 }}>
      <div style={{ textAlign: 'center', marginBottom: 10 }}>
        {loginLogo && <img src={loginLogo} alt="" style={{ maxWidth: 80, maxHeight: 24, objectFit: 'contain', marginBottom: 4 }} />}
        <div style={{ fontSize: 13, fontWeight: 600, color: '#1d2c5b' }}>
          登录 <span style={{ color: 'var(--primary-color)' }}>{displayName}</span>
        </div>
      </div>
      <div style={{ background: '#f5f7fb', borderRadius: 6, padding: '7px 10px', fontSize: 11, color: '#bfbfbf', marginBottom: 6 }}>账号 / 邮箱</div>
      <div style={{ background: '#f5f7fb', borderRadius: 6, padding: '7px 10px', fontSize: 11, color: '#bfbfbf', marginBottom: 10 }}>密码</div>
      <div
        style={{
          background: 'linear-gradient(135deg, var(--primary-color), #4096ff)',
          borderRadius: 6,
          padding: '7px 0',
          textAlign: 'center',
          color: '#fff',
          fontSize: 12,
          fontWeight: 500,
        }}
      >
        立即登录
      </div>
    </div>
  );

  return (
    <div
      style={{
        borderRadius: 10,
        overflow: 'hidden',
        border: '1px solid #eef0f5',
        position: 'relative',
        height: 300,
        ...(loginBg
          ? {
              backgroundImage: `url(${loginBg})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              backgroundRepeat: 'no-repeat',
            }
          : {
              background: 'linear-gradient(135deg, #e0e7ff 0%, #eef2ff 50%, #f0f4ff 100%)',
            }),
      }}
    >
      {/* 左侧渐变遮罩 */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: loginBg
            ? 'linear-gradient(90deg, rgba(244,247,255,0.82) 0%, rgba(244,247,255,0.4) 40%, rgba(244,247,255,0) 70%)'
            : 'transparent',
          zIndex: 1,
        }}
      />

      {/* 内容层 */}
      <div style={{ position: 'relative', zIndex: 2, padding: '16px 24px', height: '100%', display: 'flex', flexDirection: 'column' }}>
        {/* 顶部 Logo + 品牌名 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
          <img src={displayLogo} alt="" style={{ width: 20, height: 20, objectFit: 'contain', borderRadius: 3 }} />
          <span style={{ fontSize: 12, fontWeight: 700, color: '#1d2c5b' }}>{displayName}</span>
        </div>

        {/* Hero 文案 */}
        <div style={{ fontSize: 22, fontWeight: 600, color: '#1f2329', lineHeight: 1.15, letterSpacing: 0.5 }}>
          {displayTitle.length > 14 ? displayTitle.slice(0, 14) + '…' : displayTitle}
        </div>
        <div style={{ fontSize: 11, fontWeight: 400, color: '#646a73', lineHeight: 1.5, marginTop: 6, maxWidth: 280 }}>
          {displayDesc.length > 40 ? displayDesc.slice(0, 40) + '…' : displayDesc}
        </div>

        {/* 登录区域 */}
        <div style={{ flex: 1, display: 'flex', alignItems: 'flex-end', marginTop: 8 }}>
          {style === 'modal' ? (
            /* 弹框模式：居中弹窗 + 半透明遮罩 */
            <>
              <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.18)', zIndex: 2 }} />
              <div style={{ position: 'relative', zIndex: 3, margin: 'auto' }}>{loginFormMini}</div>
            </>
          ) : (
            /* 嵌入模式：文字下方 */
            <div style={{ marginTop: 8 }}>{loginFormMini}</div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ================================================================
   Logo 上传卡片 —— 用于基本信息区域
   ================================================================ */
function LogoUploader({
  value,
  onUrl,
  onRemove,
  label,
  tip,
  uploadPath = '/api/v1/configs/upload-logo',
  uploadPrefix = 'platform',
  accessToken,
  message,
}: {
  value?: string;
  onUrl: (url: string) => void;
  onRemove: () => void;
  label: string;
  tip: string;
  uploadPath?: string;
  uploadPrefix?: string;
  accessToken: string | null;
  message: any;
}) {
  const uploadProps = {
    name: 'file',
    action: uploadPath,
    headers: { Authorization: `Bearer ${accessToken}` },
    data: { prefix: uploadPrefix },
    accept: '.png,.jpg,.jpeg,.svg,.webp',
    showUploadList: false,
    beforeUpload: (file: File) => {
      if (file.size > 2 * 1024 * 1024) {
        message.error('图片不能超过 2MB');
        return Upload.LIST_IGNORE;
      }
      return true;
    },
    onChange: (info: any) => {
      if (info.file.status === 'done') {
        const url = info.file.response?.data?.url;
        if (url) {
          onUrl(url);
          message.success('已上传');
        }
      } else if (info.file.status === 'error') {
        message.error(info.file.response?.message || '上传失败');
      }
    },
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
      <div
        style={{
          width: 56,
          height: 56,
          borderRadius: 8,
          border: '1.5px dashed #d9d9d9',
          overflow: 'hidden',
          background: value ? '#fafafa' : '#fafbfc',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        {value ? (
          <img src={value} alt={label} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
        ) : (
          <span style={{ fontSize: 11, color: '#bfbfbf' }}>暂无</span>
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 }}>
          <span style={{ fontSize: 13, fontWeight: 500, color: '#374151' }}>{label}</span>
          <div style={{ display: 'flex', gap: 6 }}>
            <Upload {...uploadProps}>
              <Button size="small" style={{ borderRadius: 6, fontSize: 12 }}>
                替换图片
              </Button>
            </Upload>
            {value && (
              <Button size="small" danger style={{ borderRadius: 6, fontSize: 12 }} onClick={onRemove}>
                移除
              </Button>
            )}
          </div>
        </div>
        <div style={{ fontSize: 11, color: '#9ca3af', lineHeight: 1.5 }}>{tip}</div>
      </div>
    </div>
  );
}

/* ================================================================
   PlatformPanel —— 系统设置 > 平台信息
   ================================================================ */
export default function PlatformPanel({
  items,
  form,
  accessToken,
  message,
}: {
  items: SystemConfig[];
  form: any;
  accessToken: string | null;
  message: any;
}) {
  const logoValue = Form.useWatch('platform.logo', form) || '';
  const loginBgValue = Form.useWatch('platform.login_bg', form) || '';
  const loginLogoValue = Form.useWatch('platform.login_logo', form) || '';
  const siteNameValue = Form.useWatch('platform.name', form) || '';
  const heroTitleValue = Form.useWatch('platform.hero_title', form) || '';
  const heroDescValue = Form.useWatch('platform.hero_description', form) || '';
  const loginStyleValue = Form.useWatch('platform.login_style', form) || 'modal';
  const demoAppsSeeded = Form.useWatch('platform.demo_apps_seeded', form);
  const isDemoSeeded = demoAppsSeeded === 'true' || demoAppsSeeded === true;

  const previewProps = useMemo(
    () => ({
      logo: logoValue,
      loginBg: loginBgValue,
      loginLogo: loginLogoValue,
      siteName: siteNameValue,
      heroTitle: heroTitleValue,
      heroDescription: heroDescValue,
      loginStyle: loginStyleValue,
    }),
    [logoValue, loginBgValue, loginLogoValue, siteNameValue, heroTitleValue, heroDescValue, loginStyleValue],
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* ---- 顶部：主题色 + 登录方式（一行，标签对齐） ---- */}
      <TopBar form={form} />

      {/* ---- 预览 + 基本信息（双栏） ---- */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, alignItems: 'start' }}>
        {/* 左侧：登录页预览（单个，根据登录方式） */}
        <div className="login-preview-card" style={cardStyle}>
          <SectionHead title="页面预览" />
          <LoginPreview {...previewProps} />
        </div>

        {/* 右侧：基本信息 */}
        <div style={cardStyle}>
          <SectionHead title="基本信息" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0, marginBottom: 20 }}>
            <Form.Item label="网站名称" name="platform.name" rules={[{ required: true, message: '请输入网站名称' }]}>
              <Input maxLength={50} showCount placeholder="例如：OneAuth" />
            </Form.Item>
            <Form.Item label="认证页标题" name="platform.hero_title">
              <Input maxLength={100} showCount placeholder="例如：一键登录所有应用" />
            </Form.Item>
            <Form.Item label="认证页描述" name="platform.hero_description">
              <Input maxLength={200} showCount placeholder="一句话描述平台" />
            </Form.Item>
          </div>

          {/* Logo 上传区域 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <LogoUploader
              label="网站 Logo"
              tip="顶部网站显示的 Logo，建议 240×240，支持 JPG/PNG/SVG/WebP，不超过 2MB"
              value={logoValue}
              onUrl={(u) => form.setFieldValue('platform.logo', u)}
              onRemove={() => form.setFieldValue('platform.logo', '')}
              uploadPath="/api/v1/configs/upload-logo"
              uploadPrefix="platform"
              accessToken={accessToken}
              message={message}
            />
            <LogoUploader
              label="登录 Logo"
              tip="登录页面 Logo，建议 204×52，支持 JPG/PNG/SVG/WebP，不超过 2MB"
              value={loginLogoValue}
              onUrl={(u) => form.setFieldValue('platform.login_logo', u)}
              onRemove={() => form.setFieldValue('platform.login_logo', '')}
              uploadPath="/api/v1/configs/upload-logo"
              uploadPrefix="login_logo"
              accessToken={accessToken}
              message={message}
            />
            <LogoUploader
              label="登录背景图"
              tip="登录页全屏背景图，建议 1920×1080，支持 JPG/PNG/WebP，不超过 2MB"
              value={loginBgValue}
              onUrl={(u) => form.setFieldValue('platform.login_bg', u)}
              onRemove={() => form.setFieldValue('platform.login_bg', '')}
              uploadPath="/api/v1/configs/upload-logo"
              uploadPrefix="login_bg"
              accessToken={accessToken}
              message={message}
            />
          </div>

          {/* 隐藏字段，确保表单提交时包含这些值 */}
          <Form.Item name="platform.logo" hidden><Input /></Form.Item>
          <Form.Item name="platform.login_logo" hidden><Input /></Form.Item>
          <Form.Item name="platform.login_bg" hidden><Input /></Form.Item>
        </div>
      </div>

      {/* ---- 平台配置（铺满） ---- */}
      <div style={cardStyle}>
        <SectionHead title="平台配置" />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          <Form.Item label="当前站点 URL" name="platform.site_url">
            <Input placeholder="请输入当前站点 URL，例如：https://sso.example.com" />
          </Form.Item>
          <Form.Item
            label="Demo 应用"
            name="platform.demo_apps_seeded"
            extra="清除标记后，下次启动后端会自动重新导入 8 个内置 Demo 应用"
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <Tag color={isDemoSeeded ? 'green' : 'default'} style={{ height: 24, lineHeight: '22px', fontSize: 13, padding: '0 10px', margin: 0 }}>
                {isDemoSeeded ? '已导入' : '未导入'}
              </Tag>
              <Popconfirm
                title="清除 Demo 应用标记"
                description="清除后下次启动后端会重新导入 Demo 应用，确定吗？"
                onConfirm={() => form.setFieldValue('platform.demo_apps_seeded', '')}
                okText="确定"
                cancelText="取消"
              >
                <Button size="small" disabled={!isDemoSeeded}>
                  清除标记
                </Button>
              </Popconfirm>
            </div>
          </Form.Item>
        </div>
      </div>

      {/* 兜底：自动渲染未识别的 platform.* 字段 */}
      {items
        .filter((c) =>
          !['name', 'logo', 'theme_color', 'hero_title', 'hero_subtitle', 'hero_description', 'site_url', 'login_bg', 'login_logo', 'login_style', 'notice_text', 'demo_apps_seeded'].includes(c.key),
        )
        .map((c) => (
          <Form.Item
            key={c.id}
            label={c.description || c.key}
            name={`${c.category}.${c.key}`}
            extra={
              <span style={{ color: '#94a3b8', fontSize: 12 }}>
                <code>{c.key}</code>
              </span>
            }
          >
            <Input />
          </Form.Item>
        ))}
    </div>
  );
}
