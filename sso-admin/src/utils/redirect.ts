export function loginPath(returnTo?: string): string {
  if (!returnTo) return '/oauth/login';
  return `/oauth/login?return_to=${encodeURIComponent(returnTo)}`;
}

export function redirectToLogin(returnTo?: string): void {
  if (typeof window === 'undefined') return;
  window.location.href = loginPath(returnTo);
}
