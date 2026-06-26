import { useEffect } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import { loginPath } from '@/utils/redirect';
import { isTokenExpired } from '@/utils/token';

interface Props {
  children: JSX.Element;
  requireStaff?: boolean;
}

export default function AuthGuard({ children, requireStaff = false }: Props) {
  const { isAuthenticated, user, accessToken } = useAuthStore();
  const location = useLocation();

  useEffect(() => {
    if (accessToken && !user) {
      useAuthStore.getState().loadProfile();
    }
  }, [accessToken, user]);

  // token 过期 → 清除登录态并跳转
  useEffect(() => {
    if (accessToken && isTokenExpired(accessToken)) {
      useAuthStore.getState().clear();
      window.location.href = loginPath(location.pathname + location.search);
    }
  }, [accessToken, location]);

  if (!isAuthenticated || !accessToken) {
    return <Navigate to={loginPath(location.pathname + location.search)} replace />;
  }

  if (requireStaff && !user?.is_staff) {
    return <Navigate to="/portal" replace />;
  }

  return children;
}
