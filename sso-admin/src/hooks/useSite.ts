import { useEffect, useState } from 'react';
import { siteApi, type SiteInfo } from '@/api/site';

const DEFAULT_SITE: SiteInfo = { name: 'OneAuth', logo: '', theme_color: '#1677ff', smtp_enabled: false };

// 进程级缓存 + 订阅者列表：保存设置后调 invalidate，所有 useSite 的组件会立即重拉
let cached: SiteInfo | null = null;
let inflight: Promise<SiteInfo> | null = null;
const subscribers = new Set<(s: SiteInfo) => void>();

function applySideEffects(info: SiteInfo) {
  document.title = `${info.name} · 企业单点登录`;
  const href = info.logo || '/logo.png';
  let link = document.querySelector("link[rel='icon']") as HTMLLinkElement | null;
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);
  }
  if (link.href !== href) {
    link.href = href;
  }
}

function fetchSite(): Promise<SiteInfo> {
  if (!inflight) {
    inflight = siteApi.info().catch(() => DEFAULT_SITE);
  }
  return inflight.then((info) => {
    cached = info;
    applySideEffects(info);
    subscribers.forEach((cb) => cb(info));
    inflight = null;
    return info;
  });
}

export function useSite() {
  const [site, setSite] = useState<SiteInfo>(cached || DEFAULT_SITE);

  useEffect(() => {
    // 注册订阅，invalidate 后重新拉时所有挂载组件会被同步更新
    subscribers.add(setSite);
    if (cached) {
      // 已有缓存，无需再请求；当前组件已用 cached 初始化
    } else {
      fetchSite();
    }
    return () => {
      subscribers.delete(setSite);
    };
  }, []);

  return site;
}

// 配置页保存后调用：清缓存 + 立刻重拉 + 通知所有挂载组件
export function invalidateSiteCache() {
  cached = null;
  inflight = null;
  fetchSite();
}
