import { useEffect, useState } from 'react';
import { Button } from 'antd';
import { ArrowRightOutlined } from '@ant-design/icons';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import { useSite } from '@/hooks/useSite';
import SiteLogo from '@/components/SiteLogo';
import LoginModal from '@/components/LoginModal';
import InlineLoginForm from '@/components/InlineLoginForm';
import './home.css';

/**
 * 首页落地页：
 * - 已登录自动跳转应用门户（/portal），不展示落地页
 * - login_style === 'inline' 时，标题下方直接显示登录表单
 * - 否则（默认 modal），点击"立即登录"按钮弹出 LoginModal
 * - 兼容 OAuth 流程：?return_to=/oauth/authorize?... 时自动登录/回跳
 */
export default function HomePage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const returnTo = params.get('return_to') || '';
  const site = useSite();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const [loginOpen, setLoginOpen] = useState(false);

  const isInline = site.login_style === 'inline' && !isAuthenticated;

  // 已登录且没有 return_to → 直接进门户
  useEffect(() => {
    if (isAuthenticated && !returnTo) {
      navigate('/portal', { replace: true });
    }
  }, [isAuthenticated, returnTo, navigate]);

  // 携带 return_to 落地时：已登录直接回跳；未登录自动弹出登录框
  useEffect(() => {
    if (!returnTo) return;
    if (isAuthenticated) {
      const isProtoRoute =
        returnTo.startsWith('/oauth/authorize') ||
        returnTo.startsWith('/cas/') ||
        returnTo.startsWith('/saml/');
      if (isProtoRoute) {
        const key = '__protoRedirect:' + returnTo;
        const last = Number(sessionStorage.getItem(key) || 0);
        if (last && Date.now() - last < 5000) {
          sessionStorage.removeItem(key);
          useAuthStore.getState().clear();
          setLoginOpen(true);
          return;
        }
        sessionStorage.setItem(key, String(Date.now()));
        window.location.replace(returnTo);
      } else {
        navigate(returnTo, { replace: true });
      }
    } else {
      // inline 模式不需要自动弹框
      if (!isInline) {
        setLoginOpen(true);
      }
    }
  }, [returnTo, isAuthenticated, navigate, isInline]);

  // 标题如果未自定义，回落到默认文案
  const title = site.hero_title || '一键登录所有应用';
  const description =
    site.hero_description ||
    `${site.name || 'OneAuth'} 是一个简单、安全、开源的 SSO 单点登录项目，让登录更简单，让管理更高效。`;

  return (
    <div className="home-page">
      {/* 顶部品牌区 */}
      <header className="home-header">
        <div className="home-brand">
          <SiteLogo size={44} />
          <span>{site.name}</span>
        </div>
      </header>

      {/* 主体 */}
      <section className={`home-hero ${isInline ? 'home-hero-inline' : ''}`}>
        <div className="home-hero-text">
          <h2 className="home-hero-subtitle">{title}</h2>
          <p className="home-hero-desc">{description}</p>
          {!isInline && (
            <div className="home-hero-cta">
              {isAuthenticated ? (
                <Button
                  type="primary"
                  size="large"
                  icon={<ArrowRightOutlined />}
                  iconPosition="end"
                  className="home-cta-primary"
                  onClick={() => navigate('/portal')}
                >
                  进入应用门户
                </Button>
              ) : (
                <Button
                  type="primary"
                  size="large"
                  icon={<ArrowRightOutlined />}
                  iconPosition="end"
                  className="home-cta-primary"
                  onClick={() => setLoginOpen(true)}
                >
                  立即登录
                </Button>
              )}
            </div>
          )}

          {/* 嵌入式登录表单 */}
          {isInline && (
            <div className="home-hero-inline-form">
              <InlineLoginForm returnTo={returnTo} />
            </div>
          )}
        </div>
      </section>

      {/* 弹框登录（modal 模式） */}
      {!isInline && (
        <LoginModal open={loginOpen} onClose={() => setLoginOpen(false)} returnTo={returnTo} />
      )}
    </div>
  );
}
