import { useState } from 'react';
import { useStore } from '../state/store';
import { UNITS, formatLength, type Unit } from '../engine/units';

const h4: React.CSSProperties = { margin: '0 0 6px', fontSize: 12, color: 'var(--text-dim)', fontWeight: 400 };
const lbl: React.CSSProperties = { color: 'var(--text-dim)', fontSize: 12 };
const grid: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, marginBottom: 6 };

const WARP_STYLES = ['arc', 'arcUpper', 'arcLower', 'arch', 'bulge', 'flag', 'wave', 'fish', 'rise', 'inflate', 'squeeze', 'twist'];

export function ExtrasPanel() {
  const hasDoc = useStore((s) => !!s.session);
  const busy = useStore((s) => s.busy);
  const channels = useStore((s) => s.channels);
  const guides = useStore((s) => s.guides);
  const newChannel = useStore((s) => s.newChannel);
  const duplicateChannel = useStore((s) => s.duplicateChannel);
  const deleteChannel = useStore((s) => s.deleteChannel);
  const addGuide = useStore((s) => s.addGuide);
  const clearGuides = useStore((s) => s.clearGuides);
  const warp = useStore((s) => s.warp);
  const doc = useStore((s) => s.doc);
  const rulerUnit = useStore((s) => s.rulerUnit);
  const showRulers = useStore((s) => s.showRulers);
  const setRulerUnit = useStore((s) => s.setRulerUnit);
  const setShowRulers = useStore((s) => s.setShowRulers);

  const [chan, setChan] = useState(0);
  const [orient, setOrient] = useState<'horizontal' | 'vertical'>('horizontal');
  const [pos, setPos] = useState(100);
  const [style, setStyle] = useState('arc');
  const [bend, setBend] = useState(40);

  const off = !hasDoc || busy;
  const target = channels.find((c) => c.index === chan) ?? channels[0];

  return (
    <div className="selection">
      <h4 style={h4}>标尺与单位</h4>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4, ...lbl }}>
        <label><input type="checkbox" checked={showRulers} onChange={(e) => setShowRulers(e.target.checked)} />显示标尺</label>
        <select value={rulerUnit} onChange={(e) => setRulerUnit(e.target.value as Unit)} aria-label="标尺单位" style={{ flex: 1 }}>
          {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
        </select>
      </div>
      {doc && (
        <div className="doc-size" style={{ ...lbl, marginBottom: 8 }}>
          {formatLength(doc.width, rulerUnit, doc.resolution ?? 72)} × {formatLength(doc.height, rulerUnit, doc.resolution ?? 72)} {rulerUnit}
          {' '}@ {Math.round(doc.resolution ?? 72)} ppi
        </div>
      )}

      <h4 style={h4}>Alpha 通道（{channels.length}）</h4>
      {channels.length > 0 && (
        <select value={target?.index ?? 0} onChange={(e) => setChan(Number(e.target.value))} style={{ width: '100%', marginBottom: 4 }}>
          {channels.map((c) => <option key={c.index} value={c.index}>{c.name}</option>)}
        </select>
      )}
      <div style={grid}>
        <button onClick={() => void newChannel()} disabled={off}>新建</button>
        <button onClick={() => target && void duplicateChannel(target.index)} disabled={off || !target}>复制</button>
        <button onClick={() => target && void deleteChannel(target.index)} disabled={off || !target}>删除</button>
      </div>

      <h4 style={h4}>参考线（{guides.length}）</h4>
      <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
        <select value={orient} onChange={(e) => setOrient(e.target.value as 'horizontal' | 'vertical')} style={{ flex: 1 }}>
          <option value="horizontal">水平</option>
          <option value="vertical">垂直</option>
        </select>
        <input type="number" value={pos} onChange={(e) => setPos(Number(e.target.value))} style={{ width: 70 }} aria-label="参考线位置" />
      </div>
      <div style={grid}>
        <button onClick={() => void addGuide(orient, pos)} disabled={off}>添加参考线</button>
        <button onClick={() => void clearGuides()} disabled={off || !guides.length}>清除</button>
      </div>

      <h4 style={h4}>变形（预设）</h4>
      <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
        <select value={style} onChange={(e) => setStyle(e.target.value)} style={{ flex: 1 }}>
          {WARP_STYLES.map((w) => <option key={w} value={w}>{w}</option>)}
        </select>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6, ...lbl }}>
        <span>弯曲 {bend}</span>
        <input type="range" min={-100} max={100} value={bend} onChange={(e) => setBend(Number(e.target.value))} style={{ flex: 1 }} aria-label="弯曲" />
      </div>
      <button onClick={() => void warp(style, bend)} disabled={off} style={{ width: '100%' }}>应用变形</button>
    </div>
  );
}
