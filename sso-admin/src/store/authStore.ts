import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { authApi, type UserInfo } from '@/api/auth';
import { isTokenExpired } from '@/utils/token';
import { redirectToLogin } from '@/utils/redirect';

// 持久化策略：固定用 sessionStorage —— 关浏览器/标签页即清。
// 不再支持"记住我"长会话，避免登录态被无限续命。
// 关闭浏览器掉线是用户明确的诉求。
//
// 一次性迁移：旧版本曾把 token 存 localStorage，加载时清掉避免残留续命。
(function migrateLegacyAuth() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem('oneauth-auth');
  localStorage.removeItem('oneauth-remember');
})();

const sessionOnlyStorage = createJSONStorage(() => sessionStorage);

// ---------- 主动刷新 access_token ----------
// 在 access_token 过期前 5 分钟自动 refresh，避免 token 过期后才走 401 → refresh 的被动流程。
// 这也能防止浏览器标签被系统挂起后恢复时 token 已过期的竞态问题。
const REFRESH_BUFFER_SEC = 5 * 60; // 提前 5 分钟刷新
let refreshTimer: ReturnType<typeof setTimeout> | null = null;

function clearRefreshTimer() {
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
}

/** 根据 access_token 的 exp 安排一次主动刷新 */
function scheduleProactiveRefresh(accessToken: string | null) {
  clearRefreshTimer();
  if (!accessToken) return;
  const payload = decodeJwtPayload(accessToken);
  if (!payload?.exp) return;
  const now = Math.floor(Date.now() / 1000);
  const delaySec = payload.exp - now - REFRESH_BUFFER_SEC;
  if (delaySec <= 0) {
    // 已经快到需要刷新了，立即刷
    doProactiveRefresh();
    return;
  }
  refreshTimer = setTimeout(doProactiveRefresh, delaySec * 1000);
}

async function doProactiveRefresh() {
  const { refreshToken, refresh: doRefresh } = useAuthStore.getState();
  if (!refreshToken) return;
  try {
    const newAT = await doRefresh();
    if (newAT) {
      // refresh 成功后 state 已更新，继续安排下一次
      scheduleProactiveRefresh(newAT);
    }
  } catch {
    // 刷新失败：不处理，等 401 拦截器兜底
  }
}

function decodeJwtPayload(token: string): { exp?: number; [key: string]: unknown } | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    return JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
  } catch {
    return null;
  }
}

interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  user: UserInfo | null;
  permissions: string[];
/** 派生值：只要能拿到用户信息就算已登录，不持久化。 */
  isAuthenticated: boolean;

  login: (username: string, password: string, remember?: boolean, captchaTicket?: string) => Promise<UserInfo>;
  logout: () => Promise<void>;
  refresh: () => Promise<string | null>;
  loadProfile: () => Promise<void>;
  hasPermission: (perm: string) => boolean;
  clear: () => void;
}

const authed = (s: Pick<AuthState, 'user'>) => !!s.user;

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      accessToken: null,
      refreshToken: null,
      user: null,
      permissions: [],
      isAuthenticated: false,

      login: async (username, password, remember, captchaTicket) => {
        const data = await authApi.login({
          username: username.trim(),
          password: password.trim(),
          remember,
          captcha_ticket: captchaTicket,
        });
        // 重新登录后重置 401 跳转闸门，允许下次过期时再次跳转
        (window as any).__authBouncing = false;
        set({
          accessToken: data.access_token,
          refreshToken: data.refresh_token,
          user: data.user,
          permissions: data.permissions || [],
          isAuthenticated: true,
        });
        scheduleProactiveRefresh(data.access_token);
        // 兜底同步一次 SSO session cookie，避免浏览器偶发没有接住登录响应里的 Set-Cookie。
        await authApi.syncSsoSession().catch(() => null);
        return data.user;
      },

      logout: async () => {
        try {
          await authApi.logout();
        } catch (e) {
          // ignore
        }
        get().clear();
      },

      refresh: async () => {
        const rt = get().refreshToken;
        if (!rt) return null;
        try {
          const r = await authApi.refresh(rt);
          set({ accessToken: r.access_token, refreshToken: r.refresh_token });
          scheduleProactiveRefresh(r.access_token);
          return r.access_token;
        } catch (e) {
          return null;
        }
      },

      loadProfile: async () => {
        try {
          const r = await authApi.profile();
          set({ user: r.user, permissions: r.permissions || [], isAuthenticated: true });
        } catch (e) {
          get().clear();
        }
      },

      hasPermission: (perm: string) => {
        const p = get().permissions || [];
        return p.includes('*') || p.includes(perm);
      },

      clear: () => {
        clearRefreshTimer();
        set({
          accessToken: null,
          refreshToken: null,
          user: null,
          permissions: [],
          isAuthenticated: false,
        });
      },
    }),
    {
      name: 'oneauth-auth',
      // 固定 sessionStorage：关浏览器/标签页即清登录态
      storage: sessionOnlyStorage,
          // isAuthenticated 不持久化 —— rehydrate 后从 user 派生，
          // 避免 storage 里残留的 true 误导首页 useEffect。
      partialize: (s) => ({
        accessToken: s.accessToken,
        refreshToken: s.refreshToken,
        user: s.user,
        permissions: s.permissions,
      }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          // 有 accessToken 且已过期 → 尝试用 refresh_token 续命，失败才清除
          if (state.accessToken && isTokenExpired(state.accessToken)) {
            if (state.refreshToken) {
              // 异步尝试刷新，不阻塞 rehydrate
              const rt = state.refreshToken;
              authApi
                .refresh(rt)
                .then((r) => {
                  useAuthStore.setState({
                    accessToken: r.access_token,
                    refreshToken: r.refresh_token,
                    isAuthenticated: true,
                  });
                  scheduleProactiveRefresh(r.access_token);
                })
                .catch(() => {
                  // 刷新失败：清除登录态
                  useAuthStore.getState().clear();
                  const onPublicPage =
                    location.pathname === '/' ||
                    location.pathname.startsWith('/oauth/login') ||
                    location.pathname.startsWith('/oauth/forgot-password') ||
                    location.pathname.startsWith('/oauth/reset-password') ||
                    location.pathname.startsWith('/status');
                  if (!onPublicPage) {
                    redirectToLogin(location.pathname + location.search);
                  }
                });
              // 先保留当前 state，等异步刷新结果回来再更新
              state.isAuthenticated = authed(state);
              return;
            }
            // 没有 refresh_token：直接清除
            state.accessToken = null;
            state.refreshToken = null;
            state.user = null;
            state.permissions = [];
            state.isAuthenticated = false;
            const onPublicPage =
              location.pathname === '/' ||
              location.pathname.startsWith('/oauth/login') ||
              location.pathname.startsWith('/oauth/forgot-password') ||
              location.pathname.startsWith('/oauth/reset-password') ||
              location.pathname.startsWith('/status');
            if (!onPublicPage) {
              redirectToLogin(location.pathname + location.search);
            }
            return;
          }
          state.isAuthenticated = authed(state);
          // 页面加载时如果有有效 token，安排主动刷新
          if (state.accessToken) {
            scheduleProactiveRefresh(state.accessToken);
          }
        }
      },
    }
  )
);
