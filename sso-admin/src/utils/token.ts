/**
 * 解码 JWT payload（不验签，仅读取 exp 等声明）
 */
function decodeJwt(token: string): { exp?: number; [key: string]: unknown } | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = parts[1];
    // JWT 使用 base64url 编码
    const decoded = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

/**
 * 判断 access_token 是否已过期（含 30 秒缓冲，避免临界状态请求失败）
 */
export function isTokenExpired(token: string | null | undefined, bufferSeconds = 30): boolean {
  if (!token) return true;
  const payload = decodeJwt(token);
  if (!payload || !payload.exp) return true;
  const now = Math.floor(Date.now() / 1000);
  return payload.exp - now <= bufferSeconds;
}
