/**
 * 登录入口现在是首页 /，登录框由首页根据 ?return_to 自动弹出。
 */
export function loginPath(returnTo?: string): string {
  if (!returnTo) return '/';
  return `/?return_to=${encodeURIComponent(returnTo)}`;
}

export function redirectToLogin(returnTo?: string): void {
  if (typeof window === 'undefined') return;
  window.location.href = loginPath(returnTo);
}
