import { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import { isTokenExpired } from '@/utils/token';

interface Props {
  children: JSX.Element;
  requireStaff?: boolean;
}

export default function AuthGuard({ children, requireStaff = false }: Props) {
  const { isAuthenticated, user, accessToken, loadProfile } = useAuthStore();
  const location = useLocation();
  const [bootstrapped, setBootstrapped] = useState(false);

  useEffect(() => {
    if (accessToken && !user) {
      loadProfile().finally(() => setBootstrapped(true));
      return;
    }
    if (!isAuthenticated) {
      loadProfile().finally(() => setBootstrapped(true));
      return;
    }
    setBootstrapped(true);
  }, [accessToken, user, isAuthenticated, loadProfile]);

  // token 过期 → 清除登录态并跳转
  useEffect(() => {
    if (accessToken && isTokenExpired(accessToken)) {
      useAuthStore.getState().clear();
      window.location.href = '/';
    }
  }, [accessToken, location]);

  if (!bootstrapped) {
    return null;
  }

  if (!isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  if (requireStaff && !user?.is_staff) {
    return <Navigate to="/portal" replace />;
  }

  return children;
}
