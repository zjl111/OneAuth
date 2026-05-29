import React from 'react';

export const cardStyle: React.CSSProperties = {
  border: '1px solid #eef0f5',
  borderRadius: 12,
  padding: '24px 28px',
  background: '#fff',
};

export function SectionHead({ title, sub }: { title: string; sub?: string }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontSize: 16,
          fontWeight: 600,
          color: '#1d2c5b',
        }}
      >
        <span style={{ width: 3, height: 16, background: '#1677ff', borderRadius: 2 }} />
        {title}
      </div>
      {sub && <div style={{ color: '#94a3b8', marginTop: 6, fontSize: 13, paddingLeft: 11 }}>{sub}</div>}
    </div>
  );
}
