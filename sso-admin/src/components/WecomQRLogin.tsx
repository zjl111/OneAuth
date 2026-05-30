import { useEffect, useRef } from 'react';
import { App as AntdApp } from 'antd';
import { get } from '@/api/request';

declare global {
  interface Window {
    WwLogin?: (opts: {
      id: string;
      appid: string;
      agentid: string;
      redirect_uri: string;
      state: string;
      href?: string;
      lang?: string;
      login_type?: string;
    }) => void;
  }
}

const JS_SDK = 'https://wwlogin.work.weixin.qq.com/wwlogin/sso/v1/jslogin/wwLogin-1.2.7.js';
const CONTAINER_ID = 'wecom-qr-container';

let sdkLoading: Promise<void> | null = null;
function loadSDK(): Promise<void> {
  if (window.WwLogin) return Promise.resolve();
  if (sdkLoading) return sdkLoading;
  sdkLoading = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = JS_SDK;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('企业微信扫码 SDK 加载失败'));
    document.head.appendChild(s);
  });
  return sdkLoading;
}

/**
 * 企业微信扫码登录二维码（内嵌到登录弹窗里）。
 * 后端 `/api/v1/auth/wecom/qr-config` 返回 {corp_id, agent_id, redirect_uri}，
 * 这里调用官方 jssdk 把二维码画到 div 里；用户用企微 App 扫一下，
 * 企微会把浏览器重定向到 redirect_uri（也就是 /oauth/wecom/callback），
 * 后端建会话后再 302 回 /portal，整个流程不离开当前页。
 */
export default function WecomQRLogin({ returnTo }: { returnTo?: string }) {
  const { message } = AntdApp.useApp();
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let disposed = false;
    (async () => {
      try {
        await loadSDK();
        const cfg = await get<{
          corp_id: string;
          agent_id: string;
          redirect_uri: string;
        }>('/auth/wecom/qr-config', returnTo ? { return_to: returnTo } : undefined);
        if (disposed || !wrapRef.current || !window.WwLogin) return;
        wrapRef.current.innerHTML = '';
        window.WwLogin({
          id: CONTAINER_ID,
          appid: cfg.corp_id,
          agentid: cfg.agent_id,
          redirect_uri: encodeURIComponent(cfg.redirect_uri),
          state: 'wecom-qr-' + Date.now(),
          login_type: 'CorpApp',
          lang: 'zh',
        });
      } catch (e: any) {
        message.error(e?.response?.data?.message || e?.message || '企业微信扫码初始化失败');
      }
    })();
    return () => {
      disposed = true;
    };
  }, [returnTo, message]);

  return (
    <div
      id={CONTAINER_ID}
      ref={wrapRef}
      style={{
        minHeight: 320,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    />
  );
}
