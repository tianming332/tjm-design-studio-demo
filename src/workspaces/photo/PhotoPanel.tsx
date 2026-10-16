import { useEffect, useState } from 'react';
import { useStore } from '../../state/store';
import { ADJUSTMENTS } from './adjustments';
import { PhotoColorPanel } from './PhotoColorPanel';
import { RATIOS, centeredRatioCrop, intersectCanvas } from './crop';
import type { Anchor, Resample } from '../../engine/session';

const RESAMPLES: [Resample, string][] = [
  ['bicubic', '两次立方'], ['bilinear', '两次线性'], ['nearest', '邻近（硬边缘）'],
  ['lanczos', 'Lanczos'], ['preserveDetails', '保留细节'], ['none', '不重采样（仅改分辨率）'],
];
const ANCHORS: Anchor[] = ['topLeft', 'top', 'topRight', 'left', 'center', 'right', 'bottomLeft', 'bottom', 'bottomRight'];
const EXTENSIONS: [string, string][] = [['background', '背景色'], ['foreground', '前景色'], ['white', '白'], ['black', '黑'], ['transparent', '透明']];

const h4: React.CSSProperties = { margin: '0 0 6px', fontSize: 12, color: 'var(--text-dim)', fontWeight: 400 };
const grid: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, marginBottom: 8 };
const num: React.CSSProperties = { width: '100%' };

export function PhotoPanel() {
  const doc = useStore((s) => s.doc);
  const hasDoc = useStore((s) => !!s.session);
  const busy = useStore((s) => s.busy);
  const crop = useStore((s) => s.crop);
  const resizeImage = useStore((s) => s.resizeImage);
  const resizeCanvas = useStore((s) => s.resizeCanvas);
  const rotate = useStore((s) => s.rotate);
  const auto = useStore((s) => s.auto);
  const addAdjustment = useStore((s) => s.addAdjustment);
  const setCompare = useStore((s) => s.setCompare);
  const baseline = useStore((s) => s.baselineSnapshot);

  const [box, setBox] = useState({ x: 0, y: 0, width: 0, height: 0 });
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [resample, setResample] = useState<Resample>('bicubic');
  const [anchor, setAnchor] = useState<Anchor>('center');
  const [relative, setRelative] = useState(false);
  const [ext, setExt] = useState('background');
  useEffect(() => {
    if (!doc) return;
    setBox({ x: 0, y: 0, width: doc.width, height: doc.height });
    setSize(relative ? { width: 0, height: 0 } : { width: doc.width, height: doc.height });
  }, [doc?.width, doc?.height, relative]);

  const clipped = doc ? intersectCanvas(box, doc.width, doc.height) : null;
  const ratioCrop = (rw: number, rh: number) => {
    if (!doc) return;
    const r = centeredRatioCrop(doc.width, doc.height, rw, rh);
    if (r) void crop(r);
  };

  return (
    <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <PhotoColorPanel />
      <details className="scene-section" open>
        <summary>裁剪{doc ? ` · ${doc.width} × ${doc.height}` : ''}</summary>
        <p className="scene-hint">点击比例会立即裁剪当前画布，可撤销。</p>
        <div style={grid}>
          {RATIOS.map(([label, rw, rh]) => (
            <button key={label} onClick={() => ratioCrop(rw, rh)} disabled={!hasDoc || busy}>{label}</button>
          ))}
        </div>
        <details className="scene-section"><summary>自定义裁剪范围</summary>
        <div style={grid}>
          <label className="ai-field">X<input aria-label="裁剪 X" type="number" value={box.x} style={num} onChange={(e) => setBox({ ...box, x: Number(e.target.value) })} /></label>
          <label className="ai-field">Y<input aria-label="裁剪 Y" type="number" value={box.y} style={num} onChange={(e) => setBox({ ...box, y: Number(e.target.value) })} /></label>
          <label className="ai-field">宽度<input aria-label="裁剪宽度" type="number" value={box.width} style={num} onChange={(e) => setBox({ ...box, width: Number(e.target.value) })} /></label>
          <label className="ai-field">高度<input aria-label="裁剪高度" type="number" value={box.height} style={num} onChange={(e) => setBox({ ...box, height: Number(e.target.value) })} /></label>
        </div>
        <button
          onClick={() => clipped && void crop(clipped)}
          disabled={!hasDoc || busy || !clipped}
          style={{ width: '100%' }}
        >
          {clipped ? `裁剪到 ${clipped.width}×${clipped.height}` : '裁剪区域无效'}
        </button>
        </details>
      </details>

      <details className="scene-section"><summary>尺寸、旋转与翻转</summary>
        <div style={grid}>
          <input type="number" value={size.width} style={num} aria-label="宽度" onChange={(e) => setSize({ ...size, width: Number(e.target.value) })} />
          <input type="number" value={size.height} style={num} aria-label="高度" onChange={(e) => setSize({ ...size, height: Number(e.target.value) })} />
        </div>
        <select value={resample} onChange={(e) => setResample(e.target.value as Resample)} aria-label="重采样" style={{ width: '100%', marginBottom: 4 }}>
          {RESAMPLES.map(([v, l]) => <option key={v} value={v}>重采样：{l}</option>)}
        </select>
        <button onClick={() => void resizeImage(size.width, size.height, resample)} disabled={!hasDoc || busy} style={{ width: '100%', marginBottom: 8 }}>缩放图像</button>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 4 }}>
          <div role="radiogroup" aria-label="画布锚点" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 18px)', gap: 2 }}>
            {ANCHORS.map((a) => (
              <button
                key={a} role="radio" aria-checked={anchor === a} aria-label={`锚点 ${a}`} onClick={() => setAnchor(a)}
                style={{ width: 18, height: 18, padding: 0, background: anchor === a ? 'var(--accent-hi)' : undefined }}
              />
            ))}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--text-dim)' }}>
            <label><input type="checkbox" checked={relative} onChange={(e) => setRelative(e.target.checked)} />相对（增减量）</label>
            <label>扩展色 <select value={ext} onChange={(e) => setExt(e.target.value)} aria-label="画布扩展颜色">
              {EXTENSIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select></label>
          </div>
        </div>
        <button
          onClick={() => void resizeCanvas(size.width, size.height, { anchor, extensionColor: ext, relative })}
          disabled={!hasDoc || busy} style={{ width: '100%' }}
        >
          改画布
        </button>
        <h4 style={h4}>旋转 / 翻转</h4>
        <div style={grid}>
          <button onClick={() => void rotate('90ccw')} disabled={!hasDoc || busy}>↺ 90°</button>
          <button onClick={() => void rotate('90cw')} disabled={!hasDoc || busy}>↻ 90°</button>
          <button onClick={() => void rotate('180')} disabled={!hasDoc || busy}>180°</button>
          <button onClick={() => void rotate('flipCanvasHorizontal')} disabled={!hasDoc || busy}>水平翻转</button>
          <button onClick={() => void rotate('flipCanvasVertical')} disabled={!hasDoc || busy}>垂直翻转</button>
        </div>
      </details>

      <section>
        <h4 style={h4}>一键校正</h4>
        <div style={grid}>
          <button onClick={() => void auto('autoTone')} disabled={!hasDoc || busy}>自动色调</button>
          <button onClick={() => void auto('autoContrast')} disabled={!hasDoc || busy}>自动对比度</button>
          <button onClick={() => void auto('autoColor')} disabled={!hasDoc || busy}>自动颜色</button>
        </div>
      </section>

      <details className="scene-section"><summary>调色 · 添加调整图层</summary>
        <p className="scene-hint">添加独立图层，不直接修改原图。</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {ADJUSTMENTS.map((a) => (
            <button key={a.kind} onClick={() => void addAdjustment(a.cmd)} disabled={!hasDoc || busy}>{a.label}</button>
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
