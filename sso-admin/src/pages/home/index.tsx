import { useEffect, useState } from 'react';
import { Button } from 'antd';
import { ArrowRightOutlined } from '@ant-design/icons';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import { useSite } from '@/hooks/useSite';
import SiteLogo from '@/components/SiteLogo';
import LoginModal from '@/components/LoginModal';
import './home.css';

/**
 * 首页落地页：
 * - 未登录显示"立即登录"按钮 → 打开 LoginModal
 * - 已登录显示"进入应用门户"按钮
 * - 兼容 OAuth 流程：?return_to=/oauth/authorize?... 时自动弹出登录框，登录后回跳
 */
export default function HomePage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const returnTo = params.get('return_to') || '';
  const site = useSite();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const [loginOpen, setLoginOpen] = useState(false);

  // 携带 return_to 落地时：已登录直接回跳；未登录自动弹出登录框
  useEffect(() => {
    if (!returnTo) return;
    if (isAuthenticated) {
      if (returnTo.startsWith('/oauth/authorize')) {
        window.location.replace(returnTo);
      } else {
        navigate(returnTo, { replace: true });
      }
    } else {
      setLoginOpen(true);
    }
  }, [returnTo, isAuthenticated, navigate]);

  // 主标题如果未自定义，回落到 site.name
  const title = site.hero_title || site.name || 'OneAuth';
  const subtitle = site.hero_subtitle || '一键登录所有应用';
  const description =
    site.hero_description ||
    `${title} 是一个简单、安全、开源的 SSO 单点登录项目，让登录更简单，让管理更高效。`;

  // 把标题前后 1/2 分两段着色（设计图风格）
  const mid = Math.ceil(title.length / 2);
  const headPart = title.slice(0, mid);
  const tailPart = title.slice(mid);

  return (
    <div className="home-page">
      {/* 顶部品牌区 */}
      <header className="home-header">
        <div className="home-brand">
          <SiteLogo size={44} />
          <span>{site.name}</span>
        </div>
      </header>

      {/* 主体：左文案 右插画（插画直接由背景图承载） */}
      <section className="home-hero">
        <div className="home-hero-text">
          <h1 className="home-hero-title">
            {headPart}
            <span className="accent">{tailPart}</span>
          </h1>
          <h2 className="home-hero-subtitle">{subtitle}</h2>
          <p className="home-hero-desc">{description}</p>
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
            <Button
              size="large"
              className="home-cta-secondary"
              icon={<ArrowRightOutlined />}
              iconPosition="end"
              href="#"
            >
              了解更多
            </Button>
          </div>
        </div>
      </section>

      <LoginModal open={loginOpen} onClose={() => setLoginOpen(false)} returnTo={returnTo} />
    </div>
  );
}
