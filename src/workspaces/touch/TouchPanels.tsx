// 触摸端绘图 / 触摸端编辑: large-target scene tools for iPad and phones. They only call existing
// store actions, so everything stays undoable and identical to the desktop tools.
import { useStore, type Tool } from '../../state/store';
import { useTouch, effectiveDevice, fullscreenSupported, isFullscreen, setFullscreen } from '../../state/touch';
import { ValueSlider } from '../../components/ValueSlider';
import { ColorControl } from '../../components/ColorPicker';
import { Icon } from '../../components/Icon';

const QUICK_COLORS = ['#000000', '#ffffff', '#e5484d', '#f5a524', '#ffd60a', '#30a46c', '#0091ff', '#8e4ec6', '#7d5d3f', '#8b8d98'];

function ToolGrid({ tools }: { tools: [Tool | 'transform', string][] }) {
  const active = useStore((s) => s.activeTool);
  const setTool = useStore((s) => s.setTool);
  const enterTransform = useStore((s) => s.enterTransform);
  const hasDoc = useStore((s) => !!s.session);
  return <div className="touch-grid" role="group" aria-label="工具">
    {tools.map(([id, label]) => <button key={id} className={`touch-tile${active === id ? ' active' : ''}`} aria-pressed={active === id} disabled={!hasDoc && id === 'transform'}
      onClick={() => (id === 'transform' ? enterTransform() : setTool(id))}><Icon name={id} size={20} /><span>{label}</span></button>)}
  </div>;
}

function HistoryRow() {
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const fitView = useStore((s) => s.fitView);
  const depth = useStore((s) => s.historyDepth);
  return <div className="touch-row">
    <button className="touch-tile" disabled={!depth.canUndo} onClick={() => void undo()}><Icon name="undo" size={20} /><span>撤销</span></button>
    <button className="touch-tile" disabled={!depth.canRedo} onClick={() => void redo()}><Icon name="redo" size={20} /><span>重做</span></button>
    <button className="touch-tile" onClick={() => fitView()}><Icon name="focus" size={20} /><span>适配</span></button>
  </div>;
}

function TouchPrefs() {
  const t = useTouch();
  const device = effectiveDevice(t);
  return <details className="scene-section touch-prefs">
    <summary>触控设置 · {device === 'phone' ? '手机' : device === 'tablet' ? '平板' : '桌面'}{t.penSeen ? ' · 已检测到触控笔' : ''}</summary>
    <label className="toggle-row"><span><strong>笔绘画、手指移动画布</strong><small>检测到触控笔后，单指拖动只平移画布，避免手掌误触</small></span><input type="checkbox" checked={t.penDraws} onChange={(e) => t.setPrefs({ penDraws: e.target.checked })} /></label>
    <label className="toggle-row"><span><strong>进入后自动全屏</strong><small>第一次触摸时全屏，减少手势滑出页面；iPhone 请用「添加到主屏幕」</small></span><input type="checkbox" checked={t.autoFullscreen} onChange={(e) => t.setPrefs({ autoFullscreen: e.target.checked })} /></label>
    {fullscreenSupported() && <button className="touch-wide" onClick={() => void setFullscreen(!isFullscreen())}>{isFullscreen() ? '退出全屏' : '进入全屏'}</button>}
    <p className="muted">手势：双指捏合缩放、双指拖动平移；双指轻点撤销，三指轻点重做。</p>
  </details>;
}

export function TouchDrawPanel() {
  const brush = useStore((s) => s.brush);
  const setBrush = useStore((s) => s.setBrush);
  const fg = useStore((s) => s.foreground);
  const setForeground = useStore((s) => s.setForeground);
  const newLayer = useStore((s) => s.newLayer);
  const hasDoc = useStore((s) => !!s.session);
  const busy = useStore((s) => s.busy);
  return <div className="touch-panel">
    <ToolGrid tools={[['brush', '画笔'], ['pencil', '铅笔'], ['eraser', '橡皮'], ['eyedropper', '吸色'], ['bucket', '填充'], ['hand', '抓手']]} />
    <section className="scene-section">
      <ValueSlider label="大小" value={brush.size} min={1} max={500} unit="px" onChange={(size) => setBrush({ size })} />
      <ValueSlider label="不透明度" value={Math.round(brush.opacity * 100)} min={1} max={100} unit="%" onChange={(v) => setBrush({ opacity: v / 100 })} />
      <ValueSlider label="硬度" value={Math.round(brush.hardness * 100)} min={0} max={100} unit="%" onChange={(v) => setBrush({ hardness: v / 100 })} />
    </section>
    <section className="scene-section">
      <div className="touch-colors" role="group" aria-label="快捷颜色">
        <ColorControl label="前景色" value={fg} onChange={setForeground} />
        {QUICK_COLORS.map((c) => <button key={c} className={`touch-swatch${fg.toLowerCase() === c ? ' active' : ''}`} style={{ background: c }} aria-label={`颜色 ${c}`} onClick={() => setForeground(c)} />)}
      </div>
    </section>
    <HistoryRow />
    <button className="touch-wide" disabled={!hasDoc || busy} onClick={() => void newLayer()}><Icon name="plus" size={16} />新建绘画图层</button>
    <TouchPrefs />
  </div>;
}

export function TouchEditPanel() {
  const st = useStore();
  const hasDoc = !!st.session;
  const off = !hasDoc || st.busy;
  const act = (label: string, icon: string, run: () => unknown, disabled = off) =>
    <button className="touch-tile" disabled={disabled} onClick={() => void run()}><Icon name={icon} size={20} /><span>{label}</span></button>;
  return <div className="touch-panel">
    <ToolGrid tools={[['move', '移动'], ['transform', '变换'], ['marqueeRect', '框选'], ['lasso', '套索'], ['crop', '裁剪'], ['type', '文字']]} />
    <section className="scene-section">
      <h4>选区</h4>
      <div className="touch-grid">
        {act('选主体', 'sparkles', () => st.smartSelect('subject'))}
        {act('反选', 'swap', () => st.selectMenu('inverse'))}
        {act('取消选择', 'close', () => st.selectMenu('deselect'))}
      </div>
    </section>
    <section className="scene-section">
      <h4>图层</h4>
      <div className="touch-grid">
        {act('新建', 'plus', () => st.newLayer())}
        {act('复制', 'copy', () => st.duplicateLayer())}
        {act('删除', 'trash', () => st.deleteLayer())}
      </div>
    </section>
    <HistoryRow />
    <TouchPrefs />
  </div>;
}
