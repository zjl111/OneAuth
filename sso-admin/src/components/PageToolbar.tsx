import { Space } from 'antd';

interface Props {
  children?: React.ReactNode;
}

/**
 * 页面工具栏：用于替换 Card.title/extra 的右上角操作区。
 * AdminLayout 的面包屑已经展示页名，无需再重复。
 */
export default function PageToolbar({ children }: Props) {
  if (!children) return null;
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
      <Space>{children}</Space>
    </div>
  );
}
