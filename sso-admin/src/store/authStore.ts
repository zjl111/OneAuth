import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { authApi, type UserInfo } from '@/api/auth';

// 持久化策略：
//   勾"记住我"  → localStorage（关浏览器仍在；7 天 refresh TTL 自动续）
//   未勾        → sessionStorage（关浏览器即清，每次重开都得登）
// 由登录时 setRememberMe() 写入 REMEMBER_FLAG_KEY，persist storage adapter 据此选盘。
const REMEMBER_FLAG_KEY = 'oneauth-remember';

export function setRememberMe(remember: boolean) {
  // 切换前，把当前盘里的内容搬到目标盘，让 persist 接下来读得到
  const fromKey = remember ? sessionStorage : localStorage;
  const toKey = remember ? localStorage : sessionStorage;
  const v = fromKey.getItem('oneauth-auth');
  if (v != null) {
    toKey.setItem('oneauth-auth', v);
    fromKey.removeItem('oneauth-auth');
  }
  if (remember) localStorage.setItem(REMEMBER_FLAG_KEY, '1');
  else localStorage.removeItem(REMEMBER_FLAG_KEY);
}

function isRemember(): boolean {
  return localStorage.getItem(REMEMBER_FLAG_KEY) === '1';
}

// 一次性迁移：升级前的用户 token 全在 localStorage 但没有 remember flag。
// 把这种状态视为"未勾记住我"——直接清掉，让他们下次访问被踢回登录页，
// 明确选择是否勾选"记住我"，从而进入新规则的二选一状态。
// 仅在模块加载时跑一次。
(function migrateLegacyAuth() {
  if (typeof window === 'undefined') return;
  const hasLegacy = localStorage.getItem('oneauth-auth') != null;
  const hasFlag = localStorage.getItem(REMEMBER_FLAG_KEY) != null;
  if (hasLegacy && !hasFlag) {
    // 删掉旧 token 数据；rehydrate 时新 dynamicStorage 走 sessionStorage（空）
    // → AuthGuard 看到 isAuthenticated=false → Navigate 回登录
    localStorage.removeItem('oneauth-auth');
  }
})();

// 自定义 storage：每次读写时按 flag 选盘
const dynamicStorage = {
  getItem: (k: string) => {
    const s = isRemember() ? localStorage : sessionStorage;
    return s.getItem(k);
  },
  setItem: (k: string, v: string) => {
    const s = isRemember() ? localStorage : sessionStorage;
    s.setItem(k, v);
  },
  removeItem: (k: string) => {
    // 清就两边都清
    localStorage.removeItem(k);
    sessionStorage.removeItem(k);
  },
};

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
        // 同时清掉 remember flag，下次默认走 sessionStorage（关浏览器即掉）
        localStorage.removeItem(REMEMBER_FLAG_KEY);
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
      // 默认 sessionStorage（关浏览器即掉），勾"记住我"才升到 localStorage
      storage: createJSONStorage(() => dynamicStorage),
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
