import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { App as AntdApp } from 'antd';
import 'antd/dist/reset.css';
import './styles/global.css';
import { router } from './router';
import ThemeProvider from './components/ThemeProvider';
import AuthMonitor from './components/AuthMonitor';
import { useAuthStore } from './store/authStore';

function SessionBootstrap({ children }: { children: React.ReactNode }) {
  const loadProfile = useAuthStore((s) => s.loadProfile);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    loadProfile().finally(() => setReady(true));
  }, [loadProfile]);

  if (!ready) return null;
  return <>{children}</>;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <AntdApp>
        <SessionBootstrap>
          <AuthMonitor />
          <RouterProvider router={router} />
        </SessionBootstrap>
      </AntdApp>
    </ThemeProvider>
  </React.StrictMode>
);
