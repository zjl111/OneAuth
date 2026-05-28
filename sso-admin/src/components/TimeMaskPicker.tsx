import { useEffect, useRef, useState } from 'react';
import { Button, Space } from 'antd';
import './TimeMaskPicker.css';

interface Props {
  value?: string;
  onChange?: (v: string) => void;
}

const DAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

/**
 * 7 天 × 24 小时的时段选择热区。
 * value: 168 字符的 '0'/'1' 字符串；空 = 全选状态
 * 鼠标按下拖动可选择，再次拖动相同区域可取消选择。
 */
export default function TimeMaskPicker({ value = '', onChange }: Props) {
  const [mask, setMask] = useState<string>(() =>
    value.length === 168 ? value : '0'.repeat(168)
  );
  const draggingRef = useRef<{ mode: '1' | '0'; cells: Set<number> } | null>(null);

  useEffect(() => {
    if (value.length === 168 && value !== mask) {
      setMask(value);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const emit = (next: string) => {
    setMask(next);
    onChange?.(next);
  };

  const setCell = (idx: number, on: '1' | '0') => {
    const next = mask.slice(0, idx) + on + mask.slice(idx + 1);
    setMask(next);
  };

  const handleDown = (idx: number) => {
    const mode: '1' | '0' = mask[idx] === '1' ? '0' : '1';
    draggingRef.current = { mode, cells: new Set([idx]) };
    setCell(idx, mode);
  };

  const handleEnter = (idx: number) => {
    if (!draggingRef.current) return;
    if (draggingRef.current.cells.has(idx)) return;
    draggingRef.current.cells.add(idx);
    setCell(idx, draggingRef.current.mode);
  };

  const handleUp = () => {
    if (draggingRef.current) {
      draggingRef.current = null;
      emit(mask);
    }
  };

  return (
    <div className="tmp-wrap" onMouseUp={handleUp} onMouseLeave={handleUp}>
      <table className="tmp-table">
        <thead>
          <tr>
            <th rowSpan={2} className="tmp-corner">
              星期/时间
            </th>
            <th colSpan={12}>00:00 - 12:00</th>
            <th colSpan={12}>12:00 - 24:00</th>
          </tr>
          <tr>
            {Array.from({ length: 24 }).map((_, h) => (
              <th key={h} className="tmp-hour">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {DAYS.map((d, di) => (
            <tr key={d}>
              <td className="tmp-day">{d}</td>
              {Array.from({ length: 24 }).map((_, h) => {
                const idx = di * 24 + h;
                const on = mask[idx] === '1';
                return (
                  <td
                    key={h}
                    className={`tmp-cell ${on ? 'tmp-on' : ''}`}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      handleDown(idx);
                    }}
                    onMouseEnter={() => handleEnter(idx)}
                  />
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="tmp-footer">
        <span className="tmp-hint">可拖动鼠标选择时间段；未选择等同全选</span>
        <Space size={4}>
          <Button size="small" type="link" onClick={() => emit('1'.repeat(168))}>
            全选
          </Button>
          <Button size="small" type="link" onClick={() => emit('0'.repeat(168))}>
            清空选择
          </Button>
        </Space>
      </div>
    </div>
  );
}
