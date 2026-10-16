import { useState } from 'react';
import { useStore } from '../state/store';

const h4: React.CSSProperties = { margin: '0 0 6px', fontSize: 12, color: 'var(--text-dim)', fontWeight: 400 };
const grid: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, marginBottom: 8 };

const PRESETS: [string, string][] = [
  ['rotate90Ccw', '↺ 90°'], ['rotate90Cw', '↻ 90°'], ['rotate180', '180°'],
  ['flipHorizontal', '水平翻转'], ['flipVertical', '垂直翻转'],
];

export function TransformPanel() {
  const hasDoc = useStore((s) => !!s.session);
  const busy = useStore((s) => s.busy);
  const inTransform = useStore((s) => !!s.transformSession);
  const transformSel = useStore((s) => s.transformSel);
  const setTransformSel = useStore((s) => s.setTransformSel);
  const enterTransform = useStore((s) => s.enterTransform);
  const commitTransform = useStore((s) => s.commitTransform);
  const cancelTransform = useStore((s) => s.cancelTransform);
  const transformNumeric = useStore((s) => s.transformNumeric);
  const transformPreset = useStore((s) => s.transformPreset);

  const [deg, setDeg] = useState(0);
  const [scale, setScale] = useState(100);
  const off = !hasDoc || busy;
  const activeTool = useStore((s) => s.activeTool);

  // Contextual panel: only present for the Transform tool / an active session, to keep the
  // right rail from crowding the layers list.
  if (activeTool !== 'transform' && !inTransform) return null;

  return (
    <div className="selection">
      <h4 style={h4}>变换{inTransform ? '（拖动画布手柄，或下方数值）' : ''}</h4>

      <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, fontSize: 12 }}>
        <input type="checkbox" checked={transformSel} onChange={(e) => setTransformSel(e.target.checked)} />
        变换选区（而非图层）
      </label>

      <div style={grid}>
        <label style={{ fontSize: 12, color: 'var(--text-dim)' }}>旋转°
          <input type="number" value={deg} onChange={(e) => setDeg(Number(e.target.value))} disabled={off} style={{ width: '100%' }} />
        </label>
        <label style={{ fontSize: 12, color: 'var(--text-dim)' }}>缩放%
          <input type="number" value={scale} min={1} onChange={(e) => setScale(Number(e.target.value))} disabled={off} style={{ width: '100%' }} />
        </label>
      </div>
      <button onClick={() => void transformNumeric(deg, scale)} disabled={off} style={{ width: '100%', marginBottom: 8 }}>应用数值</button>

      <h4 style={h4}>快捷</h4>
      <div style={grid}>
        {PRESETS.map(([k, label]) => (
          <button key={k} onClick={() => void transformPreset(k as never)} disabled={off}>{label}</button>
        ))}
      </div>

      {!inTransform ? (
        <button onClick={() => enterTransform()} disabled={off} style={{ width: '100%' }}>进入手柄变换</button>
      ) : (
        <div style={grid}>
          <button onClick={() => void commitTransform()} disabled={busy}>应用 (Enter)</button>
          <button onClick={() => cancelTransform()}>取消 (Esc)</button>
        </div>
      )}
    </div>
  );
}
