import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { useLayout } from '../state/layout';
import { fitToolWindow, useStudioLayout, type ToolWindow } from '../state/studioLayout';
import { useNavigation } from '../state/navigation';
import { PanelContent } from './Dock';
import { Icon } from './Icon';

/** A single properties/layers window in the canvas region; its placement never changes the document. */
export function CanvasTools() {
  const locked = useLayout((s) => s.locked);
  const saved = useStudioLayout((s) => s.tools);
  const share = useStudioLayout((s) => s.propertiesShare);
  const panel = useNavigation((s) => s.canvasPanel);
  const showProperties = useStudioLayout((s) => s.showProperties);
  const showLayers = useStudioLayout((s) => s.showLayers);
  const ref = useRef<HTMLElement>(null);
  const [area, setArea] = useState({ w: 600, h: 700 });
  const [draft, setDraft] = useState<ToolWindow>();
  const gesture = useRef<{ kind: 'move' | 'resize'; x: number; y: number; box: ToolWindow; next: ToolWindow }>();
  useEffect(() => {
    const parent = ref.current?.parentElement;
    if (!parent) return;
    const observe = () => setArea({ w: parent.clientWidth, h: parent.clientHeight });
    const observer = new ResizeObserver(observe); observer.observe(parent); observe();
    return () => observer.disconnect();
  }, []);
  useEffect(() => { if (panel) ref.current?.querySelector<HTMLElement>(`[data-canvas-tool="${panel}"]`)?.focus({ preventScroll: true }); }, [panel]);
  const box = fitToolWindow(draft ?? saved, area.w, area.h);
  const move = (e: PointerEvent) => {
    const g = gesture.current; if (!g || locked) return;
    const dx = e.clientX - g.x, dy = e.clientY - g.y;
    const next = g.kind === 'move' ? { ...g.box, x: g.box.x + dx, y: g.box.y + dy }
      : { ...g.box, width: Math.max(220, Math.min(380, g.box.width + dx)), height: Math.max(280, g.box.height + dy) };
    g.next = fitToolWindow(next, area.w, area.h); setDraft(g.next);
  };
  const start = (kind: 'move' | 'resize', e: PointerEvent<HTMLElement>) => {
    if (locked || e.button !== 0) return;
    e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId);
    gesture.current = { kind, x: e.clientX, y: e.clientY, box, next: box };
  };
  const finish = () => { if (gesture.current) useStudioLayout.getState().update({ tools: gesture.current.next }); gesture.current = undefined; setDraft(undefined); };
  return <aside ref={ref} className={`canvas-tools${locked ? '' : ' layout-editable'}`} aria-label="画布属性与图层" hidden={!showProperties && !showLayers} style={{ left: box.x, top: box.y, width: box.width, height: box.height }}>
    <div className="canvas-tools-grip" tabIndex={locked ? -1 : 0} role="button" aria-label="移动画布工具面板" aria-disabled={locked}
      title={locked ? '解锁布局后可拖动' : '拖动移动；方向键微移'} onPointerDown={(e) => start('move', e)} onPointerMove={move} onPointerUp={finish} onPointerCancel={() => { gesture.current = undefined; setDraft(undefined); }}
      onKeyDown={(e) => { if (locked || !['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)) return; e.preventDefault(); e.stopPropagation(); useStudioLayout.getState().update({ tools: fitToolWindow({ ...box, x: box.x + (e.key === 'ArrowRight' ? 10 : e.key === 'ArrowLeft' ? -10 : 0), y: box.y + (e.key === 'ArrowDown' ? 10 : e.key === 'ArrowUp' ? -10 : 0) }, area.w, area.h) }); }}><span /><Icon name={locked ? 'lock' : 'move'} size={11} /></div>
    {showProperties && <section className="canvas-tool-section canvas-properties" style={{ flex: `${showLayers ? share : 100} 1 0` }}><h3 data-canvas-tool="properties" tabIndex={-1}>属性</h3><div className="canvas-tool-body"><PanelContent id="properties" /></div></section>}
    {showProperties && showLayers && <div className="canvas-tool-divider" role="separator" aria-label="调整属性与图层比例" aria-orientation="horizontal" aria-valuenow={share} tabIndex={locked ? -1 : 0}
      onKeyDown={(e) => { if (!locked && ['ArrowUp','ArrowDown'].includes(e.key)) { e.preventDefault(); e.stopPropagation(); useStudioLayout.getState().update({ propertiesShare: share + (e.key === 'ArrowUp' ? -5 : 5) }); } }}
      onPointerDown={(e) => { if (!locked) { e.currentTarget.setPointerCapture(e.pointerId); e.preventDefault(); } }}
      onPointerMove={(e) => { if (!locked && e.currentTarget.hasPointerCapture(e.pointerId)) { const r = ref.current!.getBoundingClientRect(); useStudioLayout.getState().update({ propertiesShare: (e.clientY - r.top) / r.height * 100 }); } }} />}
    {showLayers && <section className="canvas-tool-section canvas-layers" style={{ flex: `${showProperties ? 100 - share : 100} 1 0` }}><h3 data-canvas-tool="layers" tabIndex={-1}>图层</h3><div className="canvas-tool-body"><PanelContent id="layers" /></div></section>}
    {!locked && <div className="canvas-tools-resize" role="separator" tabIndex={0} aria-label="调整画布工具面板大小"
      onPointerDown={(e) => start('resize', e)} onPointerMove={move} onPointerUp={finish} onPointerCancel={() => { gesture.current = undefined; setDraft(undefined); }}
      onKeyDown={(e) => { if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)) return; e.preventDefault(); e.stopPropagation(); useStudioLayout.getState().update({ tools: fitToolWindow({ ...box, width: box.width + (e.key === 'ArrowLeft' ? -10 : e.key === 'ArrowRight' ? 10 : 0), height: box.height + (e.key === 'ArrowUp' ? -10 : e.key === 'ArrowDown' ? 10 : 0) }, area.w, area.h) }); }} />}
  </aside>;
}
