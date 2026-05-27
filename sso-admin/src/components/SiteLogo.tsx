import { useSite } from '@/hooks/useSite';

interface Props {
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * 显示站点 Logo：
 * - 优先用后台配置的 logo（platform.logo，由配置管理页上传）
 * - 否则回落到 /logo.png（前端 public 中的默认 logo）
 */
export default function SiteLogo({ size = 32, className, style }: Props) {
  const site = useSite();
  const src = site.logo || '/logo.png';
  return (
    <img
      src={src}
      alt={site.name || 'logo'}
      width={size}
      height={size}
      className={className}
      style={{ objectFit: 'contain', background: 'transparent', ...style }}
    />
  );
}
