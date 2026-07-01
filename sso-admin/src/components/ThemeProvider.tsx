import { useEffect, useMemo } from 'react';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { useSite } from '@/hooks/useSite';

const DEFAULT_PRIMARY = '#1677ff';

/**
 * 全局主题提供者：
 * - 从 useSite() 读取后台配置的 theme_color
 * - 注入 Ant Design ConfigProvider（colorPrimary）
 * - 同步设置 CSS 自定义属性 --primary-color，供 CSS 文件使用
 */
export default function ThemeProvider({ children }: { children: React.ReactNode }) {
  const site = useSite();
  const primary = site.theme_color || DEFAULT_PRIMARY;

  // 同步 CSS 自定义属性到 :root
  useEffect(() => {
    document.documentElement.style.setProperty('--primary-color', primary);
    // 生成一个 10% 透明度的版本用于 hover 背景
    document.documentElement.style.setProperty('--primary-color-hover', primary);
  }, [primary]);

  const theme = useMemo(() => ({
    token: {
      colorPrimary: primary,
      borderRadius: 6,
      fontSize: 13,
      fontFamily: 'system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif',
      controlHeight: 36,
      controlHeightLG: 44,
    },
  }), [primary]);

  return (
    <ConfigProvider locale={zhCN} theme={theme}>
      {children}
    </ConfigProvider>
  );
}
