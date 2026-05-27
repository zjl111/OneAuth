import { createBrowserRouter, Navigate } from 'react-router-dom';
import AuthGuard from '@/components/AuthGuard';
import HomePage from '@/pages/home';
import ForgotPasswordPage from '@/pages/forgot-password';
import ResetPasswordPage from '@/pages/reset-password';
import ConsentPage from '@/pages/consent';
import PortalPage from '@/pages/portal';
import StatusPage from '@/pages/status';
import AdminLayout from '@/layouts/AdminLayout';
import DashboardPage from '@/pages/admin/dashboard';
import UserListPage from '@/pages/admin/users';
import OrgPage from '@/pages/admin/orgs';
import RolePage from '@/pages/admin/roles';
import AppListPage from '@/pages/admin/apps';
import AccessPage from '@/pages/admin/access';
import SettingsPage from '@/pages/admin/settings';
import LogsPage from '@/pages/admin/logs';
import MonitorPage from '@/pages/admin/monitor';
import ProfilePage from '@/pages/profile';
import NotFoundPage from '@/pages/NotFound';

export const router = createBrowserRouter([
  { path: '/', element: <HomePage /> },
  // /oauth/login 兼容老链接和后端重定向，等同于首页（携带 return_to 自动弹登录框）
  { path: '/oauth/login', element: <HomePage /> },
  { path: '/oauth/forgot-password', element: <ForgotPasswordPage /> },
  { path: '/oauth/reset-password', element: <ResetPasswordPage /> },
  {
    path: '/oauth/consent',
    element: (
      <AuthGuard>
        <ConsentPage />
      </AuthGuard>
    ),
  },
  {
    path: '/portal',
    element: (
      <AuthGuard>
        <PortalPage />
      </AuthGuard>
    ),
  },
  {
    path: '/portal/profile',
    element: (
      <AuthGuard>
        <div style={{ padding: 24, background: '#f5f7fb', minHeight: '100vh' }}>
          <ProfilePage />
        </div>
      </AuthGuard>
    ),
  },
  { path: '/status', element: <StatusPage /> },
  {
    path: '/admin',
    element: (
      <AuthGuard requireStaff>
        <AdminLayout />
      </AuthGuard>
    ),
    children: [
      { index: true, element: <Navigate to="/admin/dashboard" replace /> },
      { path: 'dashboard', element: <DashboardPage /> },
      { path: 'users', element: <UserListPage /> },
      { path: 'orgs', element: <OrgPage /> },
      { path: 'roles', element: <RolePage /> },
      { path: 'apps', element: <AppListPage /> },
      { path: 'access', element: <AccessPage /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: 'monitor', element: <MonitorPage /> },
      { path: 'logs', element: <LogsPage /> },
      { path: 'profile', element: <ProfilePage /> },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
]);
