import { useEffect, useRef } from 'react';
import { App as AntdApp } from 'antd';
import { get } from '@/api/request';
import * as ww from '@wecom/jssdk';

/**
 * 企业微信扫码登录二维码（内嵌到登录弹窗里）。
 *
 * 后端 `/api/v1/auth/wecom/qr-config` 返回 {corp_id, agent_id, redirect_uri, state}，
 * 这里用官方 npm 包 `@wecom/jssdk` 把二维码 iframe 渲染到容器里；用户用企微 App 扫一下，
 * 企微会把浏览器整页重定向到 redirect_uri（也就是 /oauth/wecom/callback，redirect_type=top），
 * 后端建会话后再 302 回前端，整个流程不离开当前站。
 *
 * 旧实现的坑：早期版本是运行时动态 <script> 加载企微官方远程 JSSDK
 * （https://wwlogin.work.weixin.qq.com/wwlogin/sso/v1/jslogin/wwLogin-1.2.7.js），
 * 一旦该域名被公司网络/防火墙拦截（DNS/代理 502），<script>.onerror 触发，
 * 前端就弹出「企业微信扫码 SDK 加载失败」。改用 npm 包后 SDK 随前端产物打包，
 * 不再依赖运行时拉取远程脚本，天然免疫该域名不可达的问题。
 */
export default function WecomQRLogin({ returnTo, mode }: { returnTo?: string; mode?: 'login' | 'bind' }) {
  const { message } = AntdApp.useApp();
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let disposed = false;
    let panel: ww.WWLoginInstance | null = null;
    (async () => {
      try {
        const cfg = await get<{
          corp_id: string;
          agent_id: string;
          redirect_uri: string;
          state: string;
        }>('/auth/wecom/qr-config', { ...(returnTo ? { return_to: returnTo } : {}), ...(mode ? { mode } : {}) });
        if (disposed || !wrapRef.current) return;
        wrapRef.current.innerHTML = '';
        // redirect_type 默认即 top（整页跳转到 redirect_uri），与后端 /oauth/wecom/callback 回调架构保持一致
        panel = ww.createWWLoginPanel({
          el: wrapRef.current,
          params: {
            login_type: ww.WWLoginType.corpApp,
            appid: cfg.corp_id,
            agentid: cfg.agent_id,
            redirect_uri: cfg.redirect_uri, // 官方 SDK 无需 URLEncode
            // state 由后端签发并登记（一次性、10 分钟有效），企微回调时原样带回，
            // 后端据此校验并消费，防止 CSRF 与回调重放。
            state: cfg.state || 'wecom-qr-' + Date.now(),
            redirect_type: ww.WWLoginRedirectType.top,
            panel_size: ww.WWLoginPanelSizeType.small,
            lang: ww.WWLoginLangType.zh,
          },
          onLoginFail(err) {
            if (!disposed) message.error(`企业微信登录失败：${err?.errMsg || '请重试'}`);
          },
        });
      } catch (e: any) {
        if (!disposed) message.error(e?.response?.data?.message || e?.message || '企业微信扫码初始化失败');
      }
    })();
    return () => {
      disposed = true;
      panel?.unmount?.();
      panel = null;
    };
  }, [returnTo, mode, message]);

  return (
    <div
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
