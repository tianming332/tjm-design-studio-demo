import { ColorControl } from '../../components/ColorPicker';
import { useState } from 'react';
import { useStore } from '../../state/store';
import { PRESETS } from './presets';

const ALIGNS: [string, string][] = [
  ['leftEdges', '左'], ['horizontalCenters', '水平居中'], ['rightEdges', '右'],
  ['topEdges', '上'], ['verticalCenters', '垂直居中'], ['bottomEdges', '下'],
];
const ARRANGES: [string, string][] = [
  ['bringForward', '上移'], ['sendBackward', '下移'], ['bringToFront', '置顶'], ['sendToBack', '置底'],
];

export function PosterPanel() {
  const newDocument = useStore((s) => s.newDocument);
  const addText = useStore((s) => s.addText);
  const addShape = useStore((s) => s.addShape);
  const align = useStore((s) => s.align);
  const distribute = useStore((s) => s.distribute);
  const arrange = useStore((s) => s.arrange);
  const setCompare = useStore((s) => s.setCompare);
  const hasDoc = useStore((s) => !!s.session);
  const busy = useStore((s) => s.busy);
  const selectedIds = useStore((s) => s.selectedIds);
  const baseline = useStore((s) => s.baselineSnapshot);

  const [presetId, setPresetId] = useState(PRESETS[1].id);
  const [cw, setCw] = useState(1080);
  const [ch, setCh] = useState(1080);
  const [text, setText] = useState('标题文字');
  const [kind, setKind] = useState<'rect' | 'ellipse'>('rect');
  const [fill, setFill] = useState('#3070c0');

  const custom = presetId === 'custom';
  const create = () => {
    if (custom) return void newDocument(Math.max(1, cw), Math.max(1, ch));
    const p = PRESETS.find((x) => x.id === presetId)!;
    void newDocument(p.width, p.height);
  };

  const canAlign = hasDoc && selectedIds.length >= 1 && !busy;
  const canDistribute = hasDoc && selectedIds.length >= 3 && !busy;

  return (
    <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <details className="scene-section" open={!hasDoc}>
        <summary>{hasDoc ? '另建画布 · 尺寸预设' : '新建海报画布'}</summary>
        <select aria-label="海报尺寸预设" value={presetId} onChange={(e) => setPresetId(e.target.value)} style={{ width: '100%' }}>
          {PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          <option value="custom">自定义…</option>
        </select>
        {custom && (
          <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
            <input type="number" value={cw} min={1} onChange={(e) => setCw(Number(e.target.value))} style={{ width: '46%' }} />
            <span>×</span>
            <input type="number" value={ch} min={1} onChange={(e) => setCh(Number(e.target.value))} style={{ width: '46%' }} />
          </div>
        )}
        <button onClick={create} disabled={busy} style={{ marginTop: 6, width: '100%' }}>新建海报画布</button>
      </details>

      <section>
        <h4 style={h4}>文字</h4>
        <input aria-label="海报文字内容" value={text} onChange={(e) => setText(e.target.value)} style={{ width: '100%' }} />
        <button onClick={() => void addText(text)} disabled={!hasDoc || busy || !text} style={{ marginTop: 6, width: '100%' }}>
          添加文字层
        </button>
      </section>

      <section>
        <h4 style={h4}>形状</h4>
        <div style={{ display: 'flex', gap: 4 }}>
          <select aria-label="海报形状" value={kind} onChange={(e) => setKind(e.target.value as 'rect' | 'ellipse')} style={{ flex: 1 }}>
            <option value="rect">矩形</option>
            <option value="ellipse">椭圆</option>
          </select>
          <ColorControl label="海报形状颜色" value={fill} onChange={setFill} />
        </div>
        <button onClick={() => void addShape(kind, fill)} disabled={!hasDoc || busy} style={{ marginTop: 6, width: '100%' }}>
          添加形状层
        </button>
      </section>

      <details className="scene-section"><summary>对齐、分布与层级</summary>
        <h4 style={h4}>对齐（已选 {selectedIds.length}）</h4>
        <div style={grid}>
          {ALIGNS.map(([k, label]) => (
            <button key={k} onClick={() => void align(k)} disabled={!canAlign}>{label}</button>
          ))}
        </div>
        <h4 style={h4}>分布（需 ≥3）</h4>
        <div style={grid}>
          <button onClick={() => void distribute('horizontally')} disabled={!canDistribute}>水平</button>
          <button onClick={() => void distribute('vertically')} disabled={!canDistribute}>垂直</button>
        </div>
        <h4 style={h4}>层级</h4>
        <div style={grid}>
          {ARRANGES.map(([k, label]) => (
            <button key={k} onClick={() => void arrange(k as never)} disabled={!hasDoc || busy}>{label}</button>
          ))}
        </div>
      </details>

      <section>
        <h4 style={h4}>前后对比</h4>
        <button
          onPointerDown={() => setCompare(true)}
          onPointerUp={() => setCompare(false)}
          onPointerLeave={() => setCompare(false)}
          disabled={!baseline}
          style={{ width: '100%' }}
        >
          按住查看初始状态
        </button>
      </section>
    </div>
  );
}

const h4: React.CSSProperties = { margin: '0 0 6px', fontSize: 12, color: 'var(--text-dim)', fontWeight: 400 };
const grid: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, marginBottom: 8 };
