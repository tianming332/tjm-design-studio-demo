import { useEffect } from 'react';
import { useStore, flatten, PAINT_TOOLS, STROKE_TOOLS, SELECT_TOOLS, type ShapeKind, type PathOp } from '../state/store';
import { AlignBar } from './AlignBar';
import { beginGesture, liveShapeEdit, liveTextStyle } from '../state/live';
import type { SelectMode } from '../engine/protocol';
import { decompose, isAffine } from '../engine/transform';
import { useState } from 'react';
import { Icon } from './Icon';
import { TOOLS } from './Toolbar';
import { ColorControl } from './ColorPicker';
import { BooleanIcon } from './BooleanIcon';
import { ValueSlider } from './ValueSlider';

const row: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, height: '100%', padding: '0 10px', whiteSpace: 'nowrap' };
const grp: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6 };
const lbl: React.CSSProperties = { color: 'var(--text-dim)', fontSize: 12 };
const num: React.CSSProperties = { width: 52 };

function Slider(props: { label: string; min: number; max: number; step?: number; value: number; onChange: (v: number) => void }) {
  return <ValueSlider {...props} className="options-value" unit={props.label === '大小' ? 'px' : ''} />;
}

function Num(props: { label: string; value: number; min?: number; max?: number; onChange: (v: number) => void }) {
  if (props.min !== undefined && props.max !== undefined) return <ValueSlider label={props.label} value={props.value} min={props.min} max={props.max} onChange={props.onChange} className="options-value" />;
  return (
    <label style={grp}>
      <span style={lbl}>{props.label}</span>
      <input
        type="number" value={props.value} min={props.min} max={props.max} aria-label={props.label} style={num}
        onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) props.onChange(v); }}
      />
    </label>
  );
}

const MODES: [SelectMode, string, string][] = [
  ['replace', '新', '新选区'], ['add', '加', '添加到选区（Shift）'], ['subtract', '减', '从选区减去（Alt）'], ['intersect', '交', '与选区交叉（Shift+Alt）'],
];

/** Selection tools: boolean mode, feather, anti-alias, marquee style (fixed ratio / size). */
function SelectOptions() {
  const tool = useStore((s) => s.activeTool);
  const o = useStore((s) => s.selectOpts);
  const set = useStore((s) => s.setSelectOpts);
  const wandTolerance = useStore((s) => s.wandTolerance);
  const setWandTolerance = useStore((s) => s.setWandTolerance);
  const wandContiguous = useStore((s) => s.wandContiguous);
  const wandSampleAll = useStore((s) => s.wandSampleAll);
  const setWandOptions = useStore((s) => s.setWandOptions);
  const boxTool = tool === 'marqueeRect' || tool === 'marqueeEllipse';
  return (
    <div style={row}>
      <div className="seg" role="group" aria-label="选区模式">
        {MODES.map(([m, t, title]) => (
          <button key={m} className={o.mode === m ? 'on' : ''} title={title} aria-pressed={o.mode === m} onClick={() => set({ mode: m })}>{t}</button>
        ))}
      </div>
      {tool !== 'wand' && <Num label="羽化" value={o.feather} min={0} max={250} onChange={(v) => set({ feather: Math.max(0, v) })} />}
      {tool !== 'marqueeRect' && tool !== 'marqueeRow' && tool !== 'marqueeCol' && (
        <label style={lbl}><input type="checkbox" checked={o.antiAlias} aria-label="消除锯齿" onChange={(e) => set({ antiAlias: e.target.checked })} />消除锯齿</label>
      )}
      {boxTool && (
        <>
          <label style={grp}>
            <span style={lbl}>样式</span>
            <select
              aria-label="选框样式" value={o.style.kind}
              onChange={(e) => {
                const k = e.target.value;
                set({ style: k === 'normal' ? { kind: 'normal' } : { kind: k as 'ratio' | 'size', w: k === 'ratio' ? 1 : 64, h: k === 'ratio' ? 1 : 64 } });
              }}
            >
              <option value="normal">正常</option>
              <option value="ratio">固定比例</option>
              <option value="size">固定大小</option>
            </select>
          </label>
          {o.style.kind !== 'normal' && (
            <>
              <Num label="宽" value={o.style.w} min={1} onChange={(v) => set({ style: { ...o.style, w: Math.max(1, v) } as never })} />
              <Num label="高" value={o.style.h} min={1} onChange={(v) => set({ style: { ...o.style, h: Math.max(1, v) } as never })} />
            </>
          )}
          <span style={lbl}>拖拽中 Shift 正方/正圆，Alt 从中心；在选区内拖拽移动选区</span>
        </>
      )}
      {tool === 'polyLasso' && <span style={lbl}>单击加点 · 单击起点/双击/Enter 闭合 · Backspace 退点 · Esc 取消</span>}
      {tool === 'wand' && (
        <>
          <Slider label="容差" min={0} max={255} value={wandTolerance} onChange={setWandTolerance} />
          <label style={lbl}><input type="checkbox" checked={wandContiguous} aria-label="连续" onChange={(e) => setWandOptions({ contiguous: e.target.checked })} />连续</label>
          <label style={lbl}><input type="checkbox" checked={wandSampleAll} aria-label="对所有图层取样" onChange={(e) => setWandOptions({ sampleAll: e.target.checked })} />对所有图层取样</label>
        </>
      )}
    </div>
  );
}

const SHAPES: [ShapeKind, string][] = [
  ['rect', '矩形'], ['roundedRect', '圆角矩形'], ['ellipse', '椭圆'], ['polygon', '多边形'], ['star', '星形'], ['line', '直线'],
];

const PATH_OPS: [PathOp, string, string][] = [
  ['new', '新建', '新建形状图层'], ['combine', '合并', '合并形状（加到选中的形状层）'], ['subtract', '减去', '减去顶层形状'],
  ['intersect', '交叉', '与形状区域相交'], ['exclude', '排除', '排除重叠形状'],
];

/** Path operation for the next shape / pen path (Photoshop's path operations menu). */
function PathOpSeg() {
  const op = useStore((s) => s.shapeOpts.pathOp);
  const set = useStore((s) => s.setShapeOpts);
  const isShape = useStore((s) => /shape/i.test(flatten(s.layers).find((l) => l.id === s.selectedId)?.kind ?? ''));
  return (
    <div className="seg" role="group" aria-label="路径操作" title={isShape ? '' : '合并/减去/交叉/排除需要先选中一个形状图层'}>
      {PATH_OPS.map(([k, l, t]) => (
        <button key={k} className={op === k ? 'on' : ''} aria-pressed={op === k} aria-label={l} title={t} disabled={k !== 'new' && !isShape} onClick={() => set({ pathOp: k })}><BooleanIcon operation={k} /></button>
      ))}
    </div>
  );
}

/** Two or more shape layers selected: combine them with a path operation (live boolean). */
export function CombineShapes() {
  const n = useStore((s) => flatten(s.layers).filter((l) => s.selectedIds.includes(l.id) && /shape/i.test(l.kind)).length);
  const one = useStore((s) => /shape/i.test(flatten(s.layers).find((l) => l.id === s.selectedId)?.kind ?? ''));
  const busy = useStore((s) => s.busy);
  const combine = useStore((s) => s.combineShapes);
  const merge = useStore((s) => s.mergeShapeComponents);
  if (n < 2 && !one) return null;
  return (
    <div style={grp} role="group" aria-label="形状运算">
      {n >= 2 && (
        <>
          <span style={lbl}>{n} 个形状：</span>
          <button className="boolean-button" aria-label="联合" disabled={busy} onClick={() => void combine('combine')} title="联合：合并为一个形状层"><BooleanIcon operation="combine" /></button>
          <button className="boolean-button" aria-label="减去" disabled={busy} onClick={() => void combine('subtract')} title="减去顶层形状"><BooleanIcon operation="subtract" /></button>
          <button className="boolean-button" aria-label="交叉" disabled={busy} onClick={() => void combine('intersect')} title="只保留重叠部分"><BooleanIcon operation="intersect" /></button>
          <button className="boolean-button" aria-label="排除" disabled={busy} onClick={() => void combine('exclude')} title="去掉重叠部分"><BooleanIcon operation="exclude" /></button>
        </>
      )}
      {n < 2 && one && <button className="boolean-button" aria-label="合并形状组件" disabled={busy} onClick={() => void merge()} title="把形状内的路径运算烘焙成普通轮廓"><BooleanIcon operation="merge" /></button>}
    </div>
  );
}

function ShapeOptions() {
  const o = useStore((s) => s.shapeOpts);
  const setOpts = useStore((s) => s.setShapeOpts);
  // Changing fill / stroke / radius / sides also updates the selected shape layer live.
  const set = (p: Parameters<typeof setOpts>[0]) => { setOpts(p); liveShapeEdit(p); };
  return (
    <div style={row} onPointerDownCapture={() => beginGesture()} onFocusCapture={() => beginGesture()}>
      <PathOpSeg />
      <select aria-label="形状类型" value={o.kind} onChange={(e) => set({ kind: e.target.value as ShapeKind })}>
        {SHAPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </select>
      <label style={grp}><span style={lbl}>填充</span><ColorControl label="形状填充" value={o.fill} onChange={(fill) => set({ fill })} /></label>
      {o.kind !== 'line' && <label style={lbl}><input type="checkbox" checked={o.noFill} aria-label="无填充" onChange={(e) => set({ noFill: e.target.checked })} />无填充</label>}
      <label style={grp}><span style={lbl}>描边</span><ColorControl label="形状描边色" value={o.strokeColor} onChange={(strokeColor) => set({ strokeColor })} /></label>
      <Num label={o.kind === 'line' ? '粗细' : '描边宽'} value={o.strokeWidth} min={0} max={200} onChange={(v) => set({ strokeWidth: Math.max(0, v) })} />
      {o.kind === 'roundedRect' && <Num label="圆角" value={o.radius} min={0} onChange={(v) => set({ radius: Math.max(0, v) })} />}
      {(o.kind === 'polygon' || o.kind === 'star') && <Num label="边数" value={o.sides} min={3} max={100} onChange={(v) => set({ sides: Math.min(100, Math.max(3, Math.round(v))) })} />}
      {o.kind === 'star' && <Num label="缩进%" value={Math.round(o.starRatio * 100)} min={1} max={99} onChange={(v) => set({ starRatio: Math.min(0.99, Math.max(0.01, v / 100)) })} />}
      <span style={lbl}>拖拽绘制（Shift 等比，Alt 从中心）；选中形状层后拖手柄调整</span>
    </div>
  );
}

/** Built-in engine presets with a Chinese label; the rest keep their engine name. */
const PRESET_ZH: Record<string, string> = {
  'Hard Round': '硬边圆', 'Soft Round': '柔边圆', 'Hard Round Fine': '硬边圆（细）', 'Soft Round Large': '柔边圆（大）',
  'Hard Round Pressure Size': '硬边圆·压感大小', 'Soft Round Pressure Size': '柔边圆·压感大小',
  'Hard Round Pressure Opacity': '硬边圆·压感不透明', 'Soft Round Pressure Opacity': '柔边圆·压感不透明',
  'Airbrush Soft': '喷枪·柔边', 'Airbrush Pressure Flow': '喷枪·压感流量', 'Calligraphy Flat': '书法扁头',
  'Hard Pencil': '硬铅笔', 'Soft Pencil': '软铅笔', Chalk: '粉笔', Charcoal: '炭笔', Pastel: '色粉', 'Wax Crayon': '蜡笔',
  'Dry Bristle': '干毛刷', Rake: '耙刷', 'Watercolor Wet Edges': '水彩·湿边', 'Watercolor Wash': '水彩·晕染', 'Ink Pen': '针管笔',
  'Oil Bristle': '油画刷', 'Gouache Flat': '水粉扁刷', 'Ink Wash Sponge': '水墨海绵', Spatter: '喷溅', Stipple: '点刻',
  Confetti: '彩纸屑', Foliage: '树叶', Grass: '草地', Sparkle: '星光', 'Sponge Texture': '海绵纹理', 'Canvas Texture': '画布纹理',
  'Halftone Dots': '半调网点',
};

function BrushPresetPicker() {
  const presets = useStore((s) => s.brushPresets);
  const current = useStore((s) => s.brushPreset);
  const load = useStore((s) => s.loadBrushPresets);
  const pick = useStore((s) => s.setBrushPreset);
  const hasDoc = useStore((s) => !!s.session);
  useEffect(() => { if (hasDoc) void load(); }, [hasDoc, load]);
  return (
    <label style={grp}>
      <span style={lbl}>笔刷</span>
      <select aria-label="笔刷预设" value={current ?? ''} onChange={(e) => pick(e.target.value || undefined)} style={{ maxWidth: 150 }}>
        <option value="">默认圆头</option>
        {presets.map((p) => <option key={p.name} value={p.name}>{PRESET_ZH[p.name] ?? p.name}</option>)}
      </select>
    </label>
  );
}

/** Type tool options: font, size, colour, alignment, orientation; live on the open editor. */
function TypeOptions() {
  const o = useStore((s) => s.typeOpts);
  const setOpts = useStore((s) => s.setTypeOpts);
  const selType = useStore((s) => { const l = flatten(s.layers).find((x) => x.id === s.selectedId); return l && /type/i.test(l.kind) ? l.id : undefined; });
  // Not editing but a type layer is selected: options apply to it live (Photoshop behaviour).
  const set = (p: Parameters<typeof setOpts>[0]) => {
    setOpts(p);
    if (!useStore.getState().typeEditing && selType != null) {
      const style: Record<string, unknown> = { ...(p.font ? { font: p.font } : {}), ...(p.size ? { size: p.size } : {}), ...(p.align ? { align: p.align } : {}) };
      if (Object.keys(style).length) liveTextStyle(selType, style);
      if (p.orientation) void useStore.getState().setTextOrientation(p.orientation);
    }
  };
  const editing = useStore((s) => s.typeEditing);
  const fonts = useStore((s) => s.fontFamilies);
  const library = useStore((s) => s.fontLibrary);
  const loadFonts = useStore((s) => s.loadFonts);
  const fg = useStore((s) => s.foreground);
  const setFg = useStore((s) => s.setForeground);
  const commit = useStore((s) => s.commitType);
  const cancel = useStore((s) => s.cancelType);
  const hasDoc = useStore((s) => !!s.session);
  useEffect(() => { if (hasDoc) void loadFonts(); }, [hasDoc, loadFonts]);
  const font = editing?.font ?? o.font;
  const list = fonts.includes(font) ? fonts : [font, ...fonts];
  const size = editing?.size ?? o.size;
  const align = editing?.align ?? o.align;
  const orient = editing?.orientation ?? o.orientation;
  const color = editing?.color ?? fg;
  const keep = (e: React.PointerEvent | React.MouseEvent) => e.preventDefault(); // keep focus in the editor
  return (
    <div style={row} onPointerDownCapture={() => beginGesture()} onFocusCapture={() => beginGesture()}>
      <select aria-label="字体" value={font} onChange={(e) => set({ font: e.target.value })} style={{ maxWidth: 160 }}>
        {list.map((f) => { const lib = library.find((x) => x.family === f); return <option key={f} value={f}>{lib ? `${lib.label} · ${lib.family}` : f}</option>; })}
      </select>
      <Num label="字号(pt)" value={size} min={1} max={1296} onChange={(v) => set({ size: Math.max(1, Math.min(1296, v)) })} />
      <label style={grp}>
        <span style={lbl}>颜色</span>
        <ColorControl
          label="文字颜色" value={color}
          onChange={(value) => {
            setFg(value);
            const t = useStore.getState().typeEditing;
            if (t) useStore.setState({ typeEditing: { ...t, color: value } });
            else if (selType != null) liveTextStyle(selType, { color: value });
          }}
        />
      </label>
      <div className="seg" role="group" aria-label="对齐">
        {(['left', 'center', 'right'] as const).map((a) => (
          <button key={a} className={align === a ? 'on' : ''} aria-pressed={align === a} onPointerDown={keep} onClick={() => set({ align: a })}>
            {a === 'left' ? '左' : a === 'center' ? '中' : '右'}
          </button>
        ))}
      </div>
      <div className="seg" role="group" aria-label="方向">
        <button className={orient === 'horizontal' ? 'on' : ''} onPointerDown={keep} onClick={() => set({ orientation: 'horizontal' })}>横排</button>
        <button className={orient === 'vertical' ? 'on' : ''} onPointerDown={keep} onClick={() => set({ orientation: 'vertical' })}>直排</button>
      </div>
      {editing && (
        <>
          <button onPointerDown={keep} onClick={() => cancel()} aria-label="取消文字" title="取消（Esc）">✕</button>
          <button onPointerDown={keep} onClick={() => void commit()} aria-label="提交文字" title="提交（Ctrl/⌘+Enter）">✓</button>
        </>
      )}
      <span style={lbl}>{editing ? '输入文字 · Ctrl/⌘+Enter 或点击别处提交 · Esc 取消' : '单击输入点文字 · 拖框输入段落文字 · 单击已有文字就地编辑'}</span>
    </div>
  );
}

const MODE_ZH: Record<string, string> = { free: '自由变换', scale: '缩放', rotate: '旋转', skew: '斜切', distort: '扭曲', perspective: '透视', warp: '变形' };
const WARP_STYLES: [string, string][] = [
  ['arc', '扇形'], ['arcLower', '下弧'], ['arcUpper', '上弧'], ['arch', '拱形'], ['bulge', '凸起'], ['shellLower', '贝壳（下）'],
  ['shellUpper', '贝壳（上）'], ['flag', '旗帜'], ['wave', '波浪'], ['fish', '鱼形'], ['rise', '增加'], ['fisheye', '鱼眼'],
  ['inflate', '膨胀'], ['squeeze', '挤压'], ['twist', '扭转'],
];

/** Free Transform options: reference point, X/Y/W/H/angle/skew (affine frames), warp presets. */
function TransformOptions() {
  const t = useStore((s) => s.transformSession);
  const setRef = useStore((s) => s.setTransformRef);
  const setNum = useStore((s) => s.setTransformNumeric);
  const commit = useStore((s) => s.commitTransform);
  const cancel = useStore((s) => s.cancelTransform);
  const presetCommit = useStore((s) => s.warpPresetCommit);
  const busy = useStore((s) => s.busy);
  const [style, setStyle] = useState('arc');
  const [bend, setBend] = useState(50);
  if (!t) return <div style={row}><span style={lbl}>Ctrl/⌘+T 进入自由变换</span></div>;
  const affine = t.mode !== 'warp' && isAffine(t.quad);
  const p = decompose(t.rect, t.quad, t.ref);
  const r1 = (v: number) => Math.round(v * 10) / 10;
  return (
    <div style={row}>
      <span style={lbl}>{MODE_ZH[t.mode]}</span>
      {t.mode !== 'warp' && (
        <div role="group" aria-label="参考点" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 9px)', gap: 1 }}>
          {[0, 0.5, 1].flatMap((v) => [0, 0.5, 1].map((u) => {
            const on = Math.abs(t.ref[0] - u) < 1e-6 && Math.abs(t.ref[1] - v) < 1e-6;
            return (
              <button
                key={`${u}-${v}`} aria-label={`参考点 ${u},${v}`} aria-pressed={on} onClick={() => setRef([u, v])}
                style={{ width: 9, height: 9, padding: 0, borderRadius: 1, background: on ? 'var(--accent-hi)' : 'var(--panel-2)', border: '1px solid var(--border)' }}
              />
            );
          }))}
        </div>
      )}
      {t.mode !== 'warp' && (
        <>
          <Num label="X" value={r1(p.x)} onChange={(v) => setNum({ x: v })} />
          <Num label="Y" value={r1(p.y)} onChange={(v) => setNum({ y: v })} />
          {affine ? (
            <>
              <Num label="W%" value={r1(p.sx)} onChange={(v) => setNum({ sx: v })} />
              <Num label="H%" value={r1(p.sy)} onChange={(v) => setNum({ sy: v })} />
              <Num label="角度" value={r1(p.rot)} min={-180} max={180} onChange={(v) => setNum({ rot: v })} />
              <Num label="斜切" value={r1(p.skew)} min={-89} max={89} onChange={(v) => setNum({ skew: Math.max(-89, Math.min(89, v)) })} />
            </>
          ) : <span style={lbl}>（扭曲/透视后不显示数值）</span>}
        </>
      )}
      {t.mode === 'warp' && (
        <>
          <span style={lbl}>拖动网格点自定变形，或用预设：</span>
          <select aria-label="变形样式" value={style} onChange={(e) => setStyle(e.target.value)}>
            {WARP_STYLES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <Num label="弯曲%" value={bend} min={-100} max={100} onChange={(v) => setBend(Math.max(-100, Math.min(100, v)))} />
          <button onClick={() => void presetCommit(style, bend)} disabled={busy}>应用预设</button>
        </>
      )}
      <button onClick={() => cancel()} disabled={busy} title="取消变换（Esc）" aria-label="取消变换">✕</button>
      <button onClick={() => void commit()} disabled={busy} title="提交变换（Enter）" aria-label="提交变换">✓</button>
      <span style={lbl}>右键：变换菜单 · 框内拖动移动 · 框外拖动旋转 · 拖角等比（Shift 自由）· Alt 以参考点 · Ctrl/⌘ 扭曲</span>
    </div>
  );
}

function CropOptions() {
  const o = useStore((s) => s.cropOpts);
  const set = useStore((s) => s.setCropOpts);
  const c = useStore((s) => s.cropSession);
  const setCrop = useStore((s) => s.setCrop);
  const commit = useStore((s) => s.commitCrop);
  const cancel = useStore((s) => s.cancelCrop);
  const reveal = useStore((s) => s.revealAll);
  const busy = useStore((s) => s.busy);
  return (
    <div style={row}>
      <label style={grp}>
        <span style={lbl}>比例</span>
        <select aria-label="裁剪比例" value={o.ratio} onChange={(e) => set({ ratio: e.target.value as never })}>
          <option value="free">不受约束</option>
          <option value="1:1">1:1（方形）</option>
          <option value="4:3">4:3</option>
          <option value="16:9">16:9</option>
          <option value="custom">自定</option>
        </select>
      </label>
      {o.ratio === 'custom' && (
        <>
          <Num label="比宽" value={o.w} min={1} onChange={(v) => set({ w: Math.max(1, v) })} />
          <Num label="比高" value={o.h} min={1} onChange={(v) => set({ h: Math.max(1, v) })} />
        </>
      )}
      {c && (
        <>
          <span style={lbl}>{Math.round(c.box[2])}×{Math.round(c.box[3])} @ {Math.round(c.box[0])},{Math.round(c.box[1])}</span>
          <Num label="角度" value={c.angle} min={-180} max={180} onChange={(v) => setCrop({ ...c, angle: Math.max(-180, Math.min(180, v)) })} />
        </>
      )}
      <label style={lbl}><input type="checkbox" checked={o.deletePixels} aria-label="删除裁剪的像素" onChange={(e) => set({ deletePixels: e.target.checked })} />删除裁剪的像素</label>
      <button onClick={() => void reveal()} disabled={busy} title="显示全部：恢复未删除的裁切像素（图像 › 显示全部）">显示全部</button>
      <button onClick={() => cancel()} disabled={busy} title="取消裁剪（Esc）" aria-label="取消裁剪">✕</button>
      <button onClick={() => void commit()} disabled={busy || !c} title="提交裁剪（Enter / 双击）" aria-label="提交裁剪">✓</button>
      <span style={lbl}>框内拖动移动 · 手柄缩放（Shift 等比）· 框外附近拖动旋转（Shift 15°）· 远处拖出新框</span>
    </div>
  );
}

/** Top options bar; its controls change with the active tool. */
function ToolOptions() {
  const tool = useStore((s) => s.activeTool);
  const brush = useStore((s) => s.brush);
  const setBrush = useStore((s) => s.setBrush);
  const autoSelect = useStore((s) => s.autoSelect);
  const autoSelectTarget = useStore((s) => s.autoSelectTarget);
  const setAutoSelect = useStore((s) => s.setAutoSelect);
  const penMode = useStore((s) => s.penMode);
  const setPenMode = useStore((s) => s.setPenMode);

  if (SELECT_TOOLS.includes(tool)) return <div className="optionsbar"><SelectOptions /></div>;
  if (tool === 'shape') return <div className="optionsbar"><ShapeOptions /></div>;
  if (tool === 'move') {
    return (
      <div className="optionsbar">
        <div style={row}>
          <label style={lbl}><input type="checkbox" checked={autoSelect} aria-label="自动选择" onChange={(e) => setAutoSelect(e.target.checked)} />自动选择</label>
          <select aria-label="自动选择目标" value={autoSelectTarget} onChange={(e) => setAutoSelect(autoSelect, e.target.value as 'layer' | 'group')}>
            <option value="layer">图层</option>
            <option value="group">组</option>
          </select>
          <AlignBar compact />
          <CombineShapes />
          <span style={lbl}>空白处拖拽框选图层 · Cmd/Ctrl 临时自动选择 · 方向键微移</span>
        </div>
      </div>
    );
  }
  if (tool === 'pen') {
    return (
      <div className="optionsbar">
        <div style={row}>
          <div className="seg" role="group" aria-label="钢笔模式">
            <button className={penMode === 'path' ? 'on' : ''} aria-pressed={penMode === 'path'} onClick={() => setPenMode('path')}>路径</button>
            <button className={penMode === 'shape' ? 'on' : ''} aria-pressed={penMode === 'shape'} onClick={() => setPenMode('shape')}>形状</button>
          </div>
          {penMode === 'shape' && <PathOpSeg />}
          <span style={lbl}>单击角点 · 拖拽平滑点 · 单击起点闭合 · Enter/Esc 结束 · 点锚点删除 · 点线段加点 · Alt 点锚点转换</span>
        </div>
      </div>
    );
  }
  if (tool === 'type') return <div className="optionsbar"><TypeOptions /></div>;
  if (tool === 'transform') return <div className="optionsbar"><TransformOptions /></div>;
  if (tool === 'crop') return <div className="optionsbar"><CropOptions /></div>;
  if (tool === 'pathSelect') return <div className="optionsbar"><div style={row}><span style={lbl}>点选形状层或工作路径，拖拽整体移动</span></div></div>;
  if (tool === 'directSelect') return <div className="optionsbar"><div style={row}><span style={lbl}>拖锚点移动 · 拖方向线调曲线（Alt 断开平滑）· Shift 多选锚点</span></div></div>;

  const isStroke = STROKE_TOOLS.includes(tool);
  const isPaint = PAINT_TOOLS.includes(tool);
  if (!isStroke && tool !== 'bucket' && tool !== 'gradient') return <div className="optionsbar" />;

  return (
    <div className="optionsbar">
      <div style={row}>
        {isPaint && <BrushPresetPicker />}
        {isStroke && (
          <>
            <Slider label="大小" min={1} max={500} value={brush.size} onChange={(v) => setBrush({ size: v })} />
            {tool !== 'pencil' && tool !== 'spotHeal' && (
              <Slider label="硬度" min={0} max={100} value={Math.round(brush.hardness * 100)} onChange={(v) => setBrush({ hardness: v / 100 })} />
            )}
            {isPaint && (
              <Slider label="不透明度" min={1} max={100} value={Math.round(brush.opacity * 100)} onChange={(v) => setBrush({ opacity: v / 100 })} />
            )}
            {isPaint && tool !== 'pencil' && (
              <Slider label="流量" min={1} max={100} value={Math.round(brush.flow * 100)} onChange={(v) => setBrush({ flow: v / 100 })} />
            )}
          </>
        )}
        {tool === 'eraser' && <span style={lbl}>普通图层擦成透明；背景图层擦出背景色</span>}
        {tool === 'bucket' && (
          <Slider label="容差" min={0} max={255} value={brush.tolerance} onChange={(v) => setBrush({ tolerance: v })} />
        )}
        {tool === 'gradient' && <span style={lbl}>拖拽定义渐变方向（前景 → 背景）</span>}
        {(tool === 'clone' || tool === 'healBrush') && <span style={lbl}>Alt 点击取样，再涂抹</span>}
      </div>
    </div>
  );
}

export function OptionsBar() {
  const tool = useStore((s) => s.activeTool);
  const name = TOOLS.find((t) => t.id === tool)?.name ?? '工具';
  return <div className="options-shell"><div className="current-tool" title={name}><Icon name={tool} size={15} /><span>{name.replace(/（.*$/, '')}</span></div><ToolOptions /></div>;
}
