import { BooleanIcon } from './BooleanIcon';
import { ValueSlider } from './ValueSlider';
import { ColorControl } from './ColorPicker';
import { useState } from 'react';
import { useStore } from '../state/store';

const h4: React.CSSProperties = { margin: '0 0 6px', fontSize: 12, color: 'var(--text-dim)', fontWeight: 400 };
const lbl: React.CSSProperties = { color: 'var(--text-dim)', fontSize: 12 };
const grid: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, marginBottom: 6 };

const SHAPE_KINDS: [string, string][] = [
  ['rect', '矩形'], ['roundedRect', '圆角矩形'], ['ellipse', '椭圆'], ['polygon', '多边形'], ['line', '直线'],
];
const BOOL_OPS: [string, string][] = [
  ['combine', '并集'], ['subtract', '差集'], ['intersect', '交集'], ['exclude', '排除'],
];

export function PathPanel() {
  const hasDoc = useStore((s) => !!s.session);
  const busy = useStore((s) => s.busy);
  const hasSel = useStore((s) => !!s.selection);
  const addShapeStyled = useStore((s) => s.addShapeStyled);
  const selToWorkPath = useStore((s) => s.selToWorkPath);
  const workPathToSelection = useStore((s) => s.workPathToSelection);
  const fillWorkPath = useStore((s) => s.fillWorkPath);
  const strokeWorkPath = useStore((s) => s.strokeWorkPath);
  const pathBooleanFromSelection = useStore((s) => s.pathBooleanFromSelection);

  const [kind, setKind] = useState('rect');
  const [fill, setFill] = useState('#3366cc');
  const [strokeColor, setStrokeColor] = useState('#ff0000');
  const [strokeWidth, setStrokeWidth] = useState(3);
  const [dashed, setDashed] = useState(false);

  const off = !hasDoc || busy;
  const addShape = () => {
    const stroke = {
      width: strokeWidth, color: strokeColor, align: 'center', cap: 'round', join: 'round',
      ...(dashed ? { dashes: [strokeWidth * 2, strokeWidth * 2] } : {}),
    };
    void addShapeStyled(kind, fill, stroke);
  };

  return (
    <div className="selection compact-path">
      <h4 style={h4}>形状（填充 + 描边）</h4>
      <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
        <select value={kind} onChange={(e) => setKind(e.target.value)} style={{ flex: 1 }}>
          {SHAPE_KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6, ...lbl }}>
        <span>填充</span><ColorControl label="填充色" value={fill} onChange={setFill} />
        <span>描边</span><ColorControl label="描边色" value={strokeColor} onChange={setStrokeColor} />
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6, ...lbl }}>
        <ValueSlider label="描边宽度" min={0} max={30} value={strokeWidth} unit="px" onChange={setStrokeWidth} />
        <label><input type="checkbox" checked={dashed} onChange={(e) => setDashed(e.target.checked)} />虚线</label>
      </div>
      <button onClick={addShape} disabled={off} style={{ width: '100%', marginBottom: 10 }}>添加形状</button>

      <h4 style={h4}>路径</h4>
      <div style={grid}>
        <button onClick={() => void selToWorkPath()} disabled={off || !hasSel}>选区→工作路径</button>
        <button onClick={() => void workPathToSelection()} disabled={off}>工作路径→选区</button>
        <button onClick={() => void fillWorkPath(fill)} disabled={off}>填充路径</button>
        <button onClick={() => void strokeWorkPath(strokeColor, strokeWidth || 2)} disabled={off}>描边路径</button>
      </div>

      <h4 style={h4} title="以当前选区外接框为子路径">布尔运算</h4>
      <div className="boolean-tools" role="group" aria-label="路径布尔运算">
        {BOOL_OPS.map(([op, label]) => (
          <button key={op} className="boolean-button" title={`${label} · 以当前选区外接框为子路径`} aria-label={label} onClick={() => void pathBooleanFromSelection(op as never)} disabled={off || !hasSel}><BooleanIcon operation={op} /></button>
        ))}
      </div>
    </div>
  );
}
