import { Avatar } from 'antd';
import { useMemo } from 'react';

interface Props {
  src?: string | null;
  name?: string;
  size?: number | 'small' | 'default' | 'large';
}

const PALETTE = ['#1677ff', '#10b981', '#8b5cf6', '#ef4444', '#f59e0b', '#06b6d4', '#ec4899', '#6366f1'];

function colorOf(seed: string): string {
  const s = typeof seed === 'string' ? seed : '';
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

/**
 * 头像组件：有 src 显示图片；没有则用首字符 + 哈希着色块。
 */
export default function UserAvatar({ src, name = '', size = 32 }: Props) {
  const safeName = typeof name === 'string' ? name : String(name ?? '');
  const initial = (safeName || 'U').charAt(0).toUpperCase();
  const bg = useMemo(() => colorOf(safeName || initial), [safeName, initial]);
  if (src) {
    return <Avatar size={size} src={src} alt={safeName} />;
  }
  return (
    <Avatar size={size} style={{ background: bg, fontWeight: 500 }}>
      {initial}
    </Avatar>
  );
}
