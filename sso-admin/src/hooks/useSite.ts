import { useEffect, useState } from 'react';
import { siteApi, type SiteInfo } from '@/api/site';

const DEFAULT_SITE: SiteInfo = { name: 'OneAuth', logo: '', theme_color: '#1677ff' };

// 进程级缓存：避免每个组件 mount 都打一次 /site
let cached: SiteInfo | null = null;
let inflight: Promise<SiteInfo> | null = null;

export function useSite() {
  const [site, setSite] = useState<SiteInfo>(cached || DEFAULT_SITE);

  useEffect(() => {
    if (cached) return;
    if (!inflight) {
      inflight = siteApi.info().catch(() => DEFAULT_SITE);
    }
    inflight.then((info) => {
      cached = info;
      setSite(info);
      document.title = `${info.name} · 企业单点登录`;
      // 同步切换 tab favicon：优先用站点配置的 logo，否则回落到 /logo.png
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
    });
  }, []);

  return site;
}

// 配置页保存后调用，下次 mount 重新拉
export function invalidateSiteCache() {
  cached = null;
  inflight = null;
}
