import { useState, useEffect } from 'react';
import { Input, Button, Tooltip } from 'antd';
import { PlusOutlined, MinusOutlined } from '@ant-design/icons';

interface RedirectUriListProps {
  value?: string[];
  onChange?: (value: string[]) => void;
}

/**
 * Keycloak 风格的回调地址列表组件。
 * 每行一个 URI，支持 "+" 添加、"-" 删除，支持 "*" 通配符匹配所有地址。
 */
export default function RedirectUriList({ value = [], onChange }: RedirectUriListProps) {
  const [items, setItems] = useState<string[]>(Array.isArray(value) && value.length > 0 ? value : ['']);

  // 同步外部 value 变化（编辑回填）
  useEffect(() => {
    if (Array.isArray(value) && value.length > 0) {
      setItems(value);
    } else if (!value || value.length === 0) {
      setItems(['']);
    }
  }, [value]);

  const updateItems = (next: string[]) => {
    setItems(next);
    onChange?.(next);
  };

  const handleChange = (index: number, val: string) => {
    const next = [...items];
    next[index] = val;
    updateItems(next);
  };

  const handleAdd = () => {
    updateItems([...items, '']);
  };

  const handleRemove = (index: number) => {
    if (items.length === 1) {
      // 至少保留一行，清空内容
      updateItems(['']);
      return;
    }
    const next = items.filter((_, i) => i !== index);
    updateItems(next);
  };

  return (
    <div className="redirect-uri-list">
      {items.map((item, index) => (
        <div key={index} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: index < items.length - 1 ? 8 : 0 }}>
          <Input
            value={item}
            onChange={(e) => handleChange(index, e.target.value)}
            placeholder={index === 0 ? 'https://app.example.com/callback  或  *（匹配所有地址）' : 'https://app.example.com/callback'}
            style={{ flex: 1 }}
          />
          {items.length > 1 && (
            <Tooltip title="删除此行">
              <Button
                type="text"
                danger
                size="small"
                icon={<MinusOutlined />}
                onClick={() => handleRemove(index)}
                style={{ flexShrink: 0 }}
              />
            </Tooltip>
          )}
        </div>
      ))}
      <div style={{ marginTop: 4 }}>
        <Button
          type="dashed"
          size="small"
          icon={<PlusOutlined />}
          onClick={handleAdd}
          style={{ width: '100%' }}
        >
          添加回调地址
        </Button>
      </div>
    </div>
  );
}
