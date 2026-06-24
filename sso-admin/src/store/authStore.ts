import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { authApi, type UserInfo } from '@/api/auth';

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

interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  user: UserInfo | null;
  permissions: string[];
  /** 派生值：accessToken 与 user 同时存在才算已登录。不持久化。 */
  isAuthenticated: boolean;

  login: (username: string, password: string, remember?: boolean, captchaTicket?: string) => Promise<UserInfo>;
  logout: () => Promise<void>;
  refresh: () => Promise<string | null>;
  loadProfile: () => Promise<void>;
  hasPermission: (perm: string) => boolean;
  clear: () => void;
}

const authed = (s: Pick<AuthState, 'accessToken' | 'user'>) => !!(s.accessToken && s.user);

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      accessToken: null,
      refreshToken: null,
      user: null,
      permissions: [],
      isAuthenticated: false,

      login: async (username, password, remember, captchaTicket) => {
        const data = await authApi.login({ username, password, remember, captcha_ticket: captchaTicket });
        set({
          accessToken: data.access_token,
          refreshToken: data.refresh_token,
          user: data.user,
          permissions: data.permissions || [],
          isAuthenticated: true,
        });
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
      // isAuthenticated 不持久化 —— rehydrate 后从 accessToken+user 派生，
      // 避免 storage 里残留的 true 误导首页 useEffect。
      partialize: (s) => ({
        accessToken: s.accessToken,
        refreshToken: s.refreshToken,
        user: s.user,
        permissions: s.permissions,
      }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.isAuthenticated = authed(state);
        }
      },
    }
  )
);
