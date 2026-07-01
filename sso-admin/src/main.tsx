import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { App as AntdApp } from 'antd';
import 'antd/dist/reset.css';
import './styles/global.css';
import { router } from './router';
import ThemeProvider from './components/ThemeProvider';
import AuthMonitor from './components/AuthMonitor';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <AntdApp>
        <AuthMonitor />
        <RouterProvider router={router} />
      </AntdApp>
    </ThemeProvider>
  </React.StrictMode>
);
