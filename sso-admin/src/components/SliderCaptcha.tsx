import { useEffect, useRef, useState, useCallback } from 'react';
import { Modal, Button } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { get, post } from '@/api/request';

// 后端约定的尺寸（必须与 internal/captcha 包里的 bgW/bgH/pieceW 保持一致）
const BG_W = 320;
const BG_H = 180;
const PIECE_W = 50;

interface ChallengeResp {
  challenge_id: string;
  bg: string;
  piece: string;
  piece_y: number;
  // Unsplash 署名（按 API Guidelines 必须显示）；本地兜底图时为空
  photographer_name?: string;
  photographer_url?: string;
  unsplash_url?: string;
}

interface Props {
  open: boolean;
  onCancel: () => void;
  /** 验证成功后回调，参数为 ticket（30s 内必须用掉）*/
  onSuccess: (ticket: string) => void;
}

/**
 * SliderCaptcha：拖动拼图块到缺口位置完成验证。
 *
 * 时序：
 *   1. 打开时 GET /auth/captcha/challenge 拿一张带缺口背景图 + 拼图块
 *   2. 用户按住拼图横向拖动到目标位置
 *   3. 松手 → POST /auth/captcha/verify {challenge_id, x, duration_ms}
 *   4. 后端比对 ±6px + 拖动时长 >= 250ms → 返回 ticket → onSuccess
 */
export default function SliderCaptcha({ open, onCancel, onSuccess }: Props) {
  const [data, setData] = useState<ChallengeResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string>('');
  // 当前拼图 X 位置（受控）
  const [x, setX] = useState(0);

  const draggingRef = useRef(false);
  const startXRef = useRef(0);
  const startTsRef = useRef(0);
  const trackRef = useRef<HTMLDivElement | null>(null);

  const fetchChallenge = useCallback(async () => {
    setLoading(true);
    setError('');
    setX(0);
    try {
      const resp = await get<ChallengeResp>('/auth/captcha/challenge');
      setData(resp);
    } catch (e: any) {
      setError(e?.response?.data?.message || '加载验证图失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) fetchChallenge();
  }, [open, fetchChallenge]);

  const onMouseDown = (e: React.MouseEvent | React.TouchEvent) => {
    if (verifying || !data) return;
    draggingRef.current = true;
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    startXRef.current = clientX - x;
    startTsRef.current = Date.now();
    setError('');
  };

  useEffect(() => {
    const onMove = (e: MouseEvent | TouchEvent) => {
      if (!draggingRef.current) return;
      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
      let nx = clientX - startXRef.current;
      if (nx < 0) nx = 0;
      if (nx > BG_W - PIECE_W) nx = BG_W - PIECE_W;
      setX(nx);
    };
    const onUp = async () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      const duration = Date.now() - startTsRef.current;
      if (!data) return;
      setVerifying(true);
      try {
        const r = await post<{ ticket: string }>('/auth/captcha/verify', {
          challenge_id: data.challenge_id,
          x: Math.round(x),
          duration_ms: duration,
        });
        onSuccess(r.ticket);
      } catch (e: any) {
        setError(e?.response?.data?.message || '验证失败，请重试');
        // 失败后自动换图，避免用户反复试同一个 challenge
        setTimeout(fetchChallenge, 500);
      } finally {
        setVerifying(false);
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('touchmove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchend', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchend', onUp);
    };
  }, [x, data, fetchChallenge, onSuccess]);

  return (
    <Modal
      open={open}
      onCancel={onCancel}
      footer={null}
      destroyOnClose
      centered
      width={BG_W + 56}
      title="安全验证"
      styles={{ body: { padding: 16 } }}
    >
      <div style={{ position: 'relative', width: BG_W, height: BG_H, margin: '0 auto', userSelect: 'none' }}>
        {data && (
          <>
            <img src={data.bg} width={BG_W} height={BG_H} alt="" draggable={false} />
            <img
              src={data.piece}
              alt=""
              draggable={false}
              onMouseDown={onMouseDown}
              onTouchStart={onMouseDown}
              style={{
                position: 'absolute',
                left: x,
                top: data.piece_y,
                cursor: verifying ? 'default' : 'grab',
                transition: draggingRef.current ? 'none' : 'left 0.2s',
              }}
            />
            {data.photographer_name && (
              <div
                style={{
                  position: 'absolute',
                  right: 4,
                  bottom: 4,
                  fontSize: 10,
                  lineHeight: 1.2,
                  padding: '2px 6px',
                  borderRadius: 3,
                  background: 'rgba(0,0,0,0.45)',
                  color: '#fff',
                  pointerEvents: 'auto',
                }}
              >
                Photo by{' '}
                <a
                  href={data.photographer_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: '#fff', textDecoration: 'underline' }}
                >
                  {data.photographer_name}
                </a>
                {' on '}
                <a
                  href={data.unsplash_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: '#fff', textDecoration: 'underline' }}
                >
                  Unsplash
                </a>
              </div>
            )}
          </>
        )}
        {loading && (
          <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', background: '#f1f5f9' }}>
            加载中...
          </div>
        )}
      </div>

      <div ref={trackRef} style={{ marginTop: 12, height: 36, background: '#f1f5f9', borderRadius: 4, position: 'relative', overflow: 'hidden' }}>
        <div
          style={{
            position: 'absolute', inset: 0, display: 'grid', placeItems: 'center',
            color: '#94a3b8', fontSize: 13, pointerEvents: 'none',
          }}
        >
          {error || '按住滑块拖动到缺口位置'}
        </div>
        <div
          onMouseDown={onMouseDown}
          onTouchStart={onMouseDown}
          style={{
            position: 'absolute', left: x, top: 0, width: 36, height: 36,
            background: error ? '#ef4444' : verifying ? '#10b981' : '#1677ff',
            color: '#fff', cursor: verifying ? 'default' : 'grab',
            display: 'grid', placeItems: 'center', borderRadius: 4,
            boxShadow: '0 2px 4px rgba(0,0,0,0.15)',
          }}
        >
          →
        </div>
      </div>

      <div style={{ marginTop: 8, textAlign: 'right' }}>
        <Button type="link" size="small" icon={<ReloadOutlined />} onClick={fetchChallenge} disabled={loading || verifying}>
          换一张
        </Button>
      </div>
    </Modal>
  );
}
