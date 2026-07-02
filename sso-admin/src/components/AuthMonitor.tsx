import { useEffect, useRef } from 'react';
import { useAuthStore } from '@/store/authStore';
import { isTokenExpired } from '@/utils/token';

/**
 * 全局 Token 过期监控 —— 挂载在应用根部，每 30 秒检测一次。
 * 解决用户长时间停留页面后 token 过期但不自动跳转登录的问题。
 * 同时作为 401 拦截器之外的兜底机制。
 */
export default function AuthMonitor() {
  const { accessToken } = useAuthStore();
  const bouncedRef = useRef(false);

  useEffect(() => {
    // 没有 token 时不需要监控
    if (!accessToken) {
      bouncedRef.current = false;
      return;
    }

    const check = () => {
      const token = useAuthStore.getState().accessToken;
      if (!token) return;
      if (isTokenExpired(token)) {
        // 防止重复跳转
        if (bouncedRef.current) return;
        bouncedRef.current = true;
        useAuthStore.getState().clear();
        // 公共页不跳转，避免循环
        const onPublicPage =
          location.pathname === '/' ||
          location.pathname.startsWith('/oauth/login') ||
          location.pathname.startsWith('/oauth/forgot-password') ||
          location.pathname.startsWith('/oauth/reset-password') ||
          location.pathname.startsWith('/status');
        if (!onPublicPage) {
          window.location.href = '/';
        }
      }
    };

    // 立即检测一次，然后每 30 秒检测
    check();
    const id = setInterval(check, 30_000);
    return () => clearInterval(id);
  }, [accessToken]);

  return null;
}
