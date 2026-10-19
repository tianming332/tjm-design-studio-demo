import { useContextMenu } from './ContextMenu';
import { canvasMenu } from './contextMenus';
import { useAssets } from '../state/assets';
import { hasAccess, useWb } from '../state/workbench';
import { ASSET_DRAG_TYPE } from './AssetsPanel';
import { useEffect, useMemo, useRef, useState } from 'react';
import { EmptyCanvas } from './EmptyCanvas';
import { useAppearance } from '../state/appearance';
import { useStore, flatten, PAINT_TOOLS, STROKE_TOOLS, SAMPLED_TOOLS, SELECT_TOOLS, PATH_TOOLS } from '../state/store';
import { toolCursor } from './toolCursors';
import { renderFull, renderDamage, registerCanvas } from '../engine/render';
import { boxCenter, boxHandles, constrainBox, cropRatio, dragBox, fitRatio, isTinyDrag, modeFrom, pointInMask, resizeBox, rotateAbout, screenToDoc, stripBox, sweepAngle, type Pt } from '../engine/selection';
import { addPoint, isGradientTooShort, type Pt2 } from '../engine/brush';
import { drawTfPreview, drawTfUI, tfCursor, tfDrag, tfHit, type TfHit, type TfPreviewSrc } from './TransformOverlay';
import type { TransformSession } from '../state/store';
import { TypeEditor } from './TypeEditor';
import {
  cornerKnot, deleteKnot, hitKnot, moveHandle, moveKnots, nearestSegment, smoothKnot, splitSegment, togglePoint, translatePath,
  type Hit, type Knot, type PathData,
} from '../engine/pathgeom';
import {
  drawBand, drawStrokePreview, drawGradientGuide, clearOverlay,
  overlayCtx, drawPath, drawPenPreview, drawBoxHandles, drawBrushCursor, drawLineBand, antsPath, drawAntsScreen, type Band,
} from './ants';
import { rulerTicks, type Unit } from '../engine/units';
import type { SelectMode } from '../engine/protocol';
import type { ShapeInfo } from '../engine/session';
import { SelectionActions } from './SelectionActions';
import { useTouch } from '../state/touch';

const RULER = 18;

/** Draws one ruler strip. `offset` = screen position of document 0 along the axis. */
function drawRuler(c: HTMLCanvasElement, horizontal: boolean, length: number, offset: number, scale: number, unit: Unit, ppi: number) {
  const w = horizontal ? length : RULER;
  const h = horizontal ? RULER : length;
  if (c.width !== w) c.width = w;
  if (c.height !== h) c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) return;
  const tokens = getComputedStyle(document.documentElement);
  ctx.fillStyle = tokens.getPropertyValue('--ui-panel').trim();
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = tokens.getPropertyValue('--ui-control-border').trim();
  ctx.fillStyle = tokens.getPropertyValue('--ui-text-secondary').trim();
  ctx.font = '9px sans-serif';
  ctx.beginPath();
  for (const t of rulerTicks(offset, length, scale, unit, ppi)) {
    const p = Math.round(t.screen) + 0.5;
    if (horizontal) { ctx.moveTo(p, RULER); ctx.lineTo(p, RULER - 8); ctx.fillText(t.label, p + 2, 9); }
    else {
      ctx.moveTo(RULER, p); ctx.lineTo(RULER - 8, p);
      ctx.save(); ctx.translate(9, p + 2); ctx.rotate(-Math.PI / 2); ctx.fillText(t.label, -ctx.measureText(t.label).width - 2, 0); ctx.restore();
    }
  }
  ctx.stroke();
}

type DragKind =
  | 'pan' | 'move' | 'marquee' | 'lasso' | 'paint' | 'gradient' | 'transform'
  | 'moveSel' | 'shapeDraw' | 'shapeHandle' | 'pathMove' | 'direct' | 'penDrag'
  | 'cropDraw' | 'cropHandle' | 'cropMove' | 'cropRotate' | 'typeDraw' | 'boxSelect';

type Drag = {
  kind: DragKind;
  mode: SelectMode;
  ellipse: boolean;
  startDoc: Pt;
  startX: number;
  startY: number;
  tx0: number;
  ty0: number;
  acc: { dx: number; dy: number };
  points: Pt2[];
  handle?: number;
  /** shapeHandle: bounds at drag start; move: the layer's bounds (preview box). */
  box?: [number, number, number, number];
  /** shapeHandle on a line: which endpoint (0 = from, 1 = to). */
  lineEnd?: 0 | 1;
  /** directSelect: what was grabbed, the anchors moving with it, and the path before the drag. */
  hit?: Hit;
  sel?: { sub: number; knot: number }[];
  basePath?: PathData;
  /** Latest preview path (directSelect) / box (shapeHandle) / end point. */
  work?: PathData;
  now?: Pt;
  /** Free transform: what was grabbed and the session at drag start. */
  tfHit?: TfHit;
  tf0?: TransformSession;
  tfStart?: [number, number];
  /** Box select target: layers (move tool), shape layers (black arrow), anchors (white arrow). */
  boxOf?: 'layers' | 'shapes' | 'anchors';
  /** Crop: rotation at drag start. */
  angle0?: number;
  /** Async layer pick started on pointer-down (auto-select / path selection). */
  pending?: Promise<unknown>;
} | null;

/** Box the shape handles act on: the live rect when the engine keeps one, else the bounds. */
function shapeBox(info: ShapeInfo): [number, number, number, number] {
  const r = info.live?.rect;
  return r ? [r[0], r[1], r[2], r[3]] : info.bounds;
}
const isLine = (info?: ShapeInfo) => info?.live?.kind === 'line' && !!info.live.from && !!info.live.to;

/** Same-type tools that may grab a selection to move it (PS: drag inside a selection). */
const MOVE_SEL_TOOLS = ['marqueeRect', 'marqueeEllipse', 'lasso', 'polyLasso'];

export function CanvasView() {
  const theme = useAppearance((s) => s.resolvedTheme);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const antsRef = useRef<HTMLCanvasElement>(null);
  /** Screen-space marching ants (crisp at any zoom, animated). */
  const antsScreenRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const guidesRef = useRef<HTMLCanvasElement>(null);
  const rulerHRef = useRef<HTMLCanvasElement>(null);
  const rulerVRef = useRef<HTMLCanvasElement>(null);
  const [wrapSize, setWrapSize] = useState({ w: 0, h: 0 });
  const wrapRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag>(null);
  const [space, setSpace] = useState(false);
  /** Free-transform right-click menu (screen position inside the canvas area). */
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);
  /** Pixel sources for the live transform preview (fetched once per transform session). */
  const tfSrcRef = useRef<{ key: string; src?: TfPreviewSrc } | null>(null);
  /** Polygonal lasso in progress (vertices) and the selection mode it started with. */
  const polyRef = useRef<{ points: [number, number][]; mode: SelectMode } | null>(null);
  // Touch gestures: two fingers pinch-zoom / pan, a quick two-finger tap undoes, three redoes.
  // After a gesture the remaining fingers are ignored until all are lifted (no stray strokes).
  const touchesRef = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef<{ d0: number; mid0: { x: number; y: number }; s0: number; tx0: number; ty0: number; moved: boolean; at: number; count: number } | null>(null);
  const gestureHoldRef = useRef(false);
  /** Pen subpath in progress. */
  const penRef = useRef<Knot[] | null>(null);
  /** Pointer position in document pixels (brush cursor, rubber bands). */
  const cursorRef = useRef<[number, number] | undefined>(undefined);
  /** Anchors picked with the direct selection tool (kept between drags). */
  const directSelRef = useRef<{ sub: number; knot: number }[]>([]);

  const session = useStore((s) => s.session);
  const doc = useStore((s) => s.doc);
  const view = useStore((s) => s.view);
  const render = useStore((s) => s.render);
  const selection = useStore((s) => s.selection);
  const activeTool = useStore((s) => s.activeTool);
  const selectedId = useStore((s) => s.selectedId);
  const layers = useStore((s) => s.layers);
  const setView = useStore((s) => s.setView);
  const setBackend = useStore((s) => s.setBackend);
  const moveLayer = useStore((s) => s.moveLayer);
  const marquee = useStore((s) => s.marquee);
  const lasso = useStore((s) => s.lasso);
  const magicWand = useStore((s) => s.magicWand);
  const paintStroke = useStore((s) => s.paintStroke);
  const paintBucket = useStore((s) => s.paintBucket);
  const sampleColor = useStore((s) => s.sampleColor);
  const paintGradient = useStore((s) => s.paintGradient);
  const retouchStroke = useStore((s) => s.retouchStroke);
  const setCloneSource = useStore((s) => s.setCloneSource);
  const brushSize = useStore((s) => s.brush.size);
  const foreground = useStore((s) => s.foreground);
  const background = useStore((s) => s.background);
  const maskEditing = useStore((s) => s.maskEditing);
  const compare = useStore((s) => s.compare);
  const baseline = useStore((s) => s.baselineSnapshot);
  const captureBaselineIfNeeded = useStore((s) => s.captureBaselineIfNeeded);
  const paintedNonce = useStore((s) => s.paintedNonce);
  const markPainted = useStore((s) => s.markPainted);
  const transformSession = useStore((s) => s.transformSession);
  const guides = useStore((s) => s.guides);
  const showRulers = useStore((s) => s.showRulers);
  const rulerUnit = useStore((s) => s.rulerUnit);
  const commitTransform = useStore((s) => s.commitTransform);
  const cancelTransform = useStore((s) => s.cancelTransform);
  const shapeInfo = useStore((s) => s.shapeInfo);
  const activePath = useStore((s) => s.activePath);
  const cropSession = useStore((s) => s.cropSession);
  const seenDocuments = useRef(new WeakSet<object>());
  // Fit only the first time a document enters this canvas. Panel/window changes and
  // returning to an already-open tab must preserve its existing zoom and content anchor.
  useEffect(() => {
    if (!session || !doc || seenDocuments.current.has(session)) return;
    seenDocuments.current.add(session);
    // Automation hook: pixel-coordinate smoke flows keep the 1:1 origin view.
    if ((window as unknown as { __tjmNoAutoFit?: boolean }).__tjmNoAutoFit) return;
    useStore.getState().fitView();
  }, [session, doc]);
  // Document repaint.
  useEffect(() => {
    const canvas = canvasRef.current;
    registerCanvas(canvas);
    if (!canvas || !session) return;
    let cancelled = false;
    void (async () => {
      if (render.damage && render.damage.length) await renderDamage(session, canvas, render.damage);
      else {
        const b = await renderFull(session, canvas);
        if (!cancelled) { setBackend(b); captureBaselineIfNeeded(); }
      }
      if (!cancelled) markPainted(render.nonce);
    })().catch((e) => {
      if (!cancelled) useStore.setState({ error: `文档显示失败：${e instanceof Error ? e.message : String(e)}` });
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [render.nonce, session]);

  // Marching ants follow the committed selection; the transform frame takes over in transform mode.
  useEffect(() => {
    const ants = antsRef.current;
    if (!ants || !doc) return;
    // The doc-space canvas only carries rubber bands / previews now; ants are drawn in screen space.
    clearOverlay(ants, doc.width, doc.height);
  }, [selection, transformSession, doc?.width, doc?.height]);

  const antsPathMemo = useMemo(() => antsPath(selection), [selection]);
  useEffect(() => {
    const c = antsScreenRef.current;
    if (!c) return;
    let offset = 0;
    const draw = () => drawAntsScreen(c, wrapSize.w, wrapSize.h, transformSession ? undefined : antsPathMemo, view, offset);
    draw();
    if (!antsPathMemo || transformSession || useAppearance.getState().preferences.reducedMotion) return;
    const t = setInterval(() => { offset = (offset + 1) % 8; draw(); }, 120);
    return () => clearInterval(t);
  }, [antsPathMemo, view, wrapSize.w, wrapSize.h, transformSession]);

  // Live transform preview: fetch the layer alone + what lies beneath once per session, then
  // redraw on every frame change.
  useEffect(() => {
    const c = previewRef.current;
    const t = transformSession;
    if (!c || !doc) return;
    if (!t || !t.preview || t.layer == null || !session) {
      tfSrcRef.current = null;
      if (c.width) { c.width = 0; c.height = 0; }
      return;
    }
    const key = `${t.layer}|${t.rect.join(',')}`;
    const draw = () => {
      const src = tfSrcRef.current?.src;
      const cur = useStore.getState().transformSession;
      if (!src || !cur) return;
      if (c.width !== doc.width || c.height !== doc.height) { c.width = doc.width; c.height = doc.height; }
      const ctx = c.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, c.width, c.height);
      drawTfPreview(ctx, cur, src);
    };
    if (tfSrcRef.current?.key === key) { draw(); return; }
    tfSrcRef.current = { key };
    const x = Math.max(0, Math.floor(t.rect[0])), y = Math.max(0, Math.floor(t.rect[1]));
    const w = Math.min(doc.width, Math.ceil(t.rect[2])) - x, h = Math.min(doc.height, Math.ceil(t.rect[3])) - y;
    if (w <= 0 || h <= 0) return;
    void (async () => {
      const toCanvas = (r: { ok: boolean; data?: { width: number; height: number; pixels: ArrayBuffer } }) => {
        const cv = document.createElement('canvas');
        if (!r.ok || !r.data || !r.data.width) return cv;
        cv.width = r.data.width; cv.height = r.data.height;
        cv.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(r.data.pixels), r.data.width, r.data.height), 0, 0);
        return cv;
      };
      const [layer, under] = await Promise.all([session.renderLayerSplit(t.layer!, true, x, y, w, h), session.renderLayerSplit(t.layer!, false, x, y, w, h)]);
      if (tfSrcRef.current?.key !== key) return;
      tfSrcRef.current = { key, src: { layer: toCanvas(layer as never), under: toCanvas(under as never), area: [x, y, w, h] } };
      draw();
    })();
  }, [transformSession, doc, session]);

  // Shape handles / active path follow the selected layer and every edit (undo included).
  useEffect(() => {
    const st = useStore.getState();
    if (activeTool === 'shape' || activeTool === 'move' || activeTool === 'pathSelect') void st.refreshShapeInfo();
    if (PATH_TOOLS.includes(activeTool)) void st.refreshActivePath();
  }, [layers, selectedId, activeTool]);

  // A new canvas size (open / crop / resize) resets the crop frame to the whole canvas.
  useEffect(() => {
    if (activeTool === 'crop') useStore.getState().startCrop();
  }, [doc?.width, doc?.height, activeTool]);

  // Leaving a tool drops its in-progress gesture.
  useEffect(() => {
    if (activeTool !== 'polyLasso') polyRef.current = null;
    if (activeTool !== 'pen') penRef.current = null;
    if (activeTool !== 'directSelect') directSelRef.current = [];
  }, [activeTool]);

  /** Repaints the vector overlay: shape handles, active path, pen preview, move box, brush cursor. */
  const paintOverlay = () => {
    const c = overlayRef.current;
    if (!c || !doc) return;
    const ctx = overlayCtx(c, doc.width, doc.height);
    if (!ctx) return;
    const st = useStore.getState();
    const tool = st.activeTool;
    const s = st.view.scale;
    const d = dragRef.current;
    if (d?.kind === 'move' && d.box) {
      const b = d.box;
      const dx = d.acc.dx / s, dy = d.acc.dy / s;
      drawBoxHandles(ctx, [b[0] + dx, b[1] + dy, b[2], b[3]], [], s, true);
    }
    const info = st.shapeInfo;
    if (info && (tool === 'shape' || tool === 'move') && !st.transformSession) {
      if (isLine(info)) {
        const from = info.live!.from!, to = info.live!.to!;
        let f: [number, number] = [from[0], from[1]], t: [number, number] = [to[0], to[1]];
        if (d?.kind === 'shapeHandle' && d.now && d.lineEnd != null) {
          const p: [number, number] = [d.now.x, d.now.y];
          if (d.lineEnd === 0) f = p; else t = p;
        }
        drawLineBand(ctx, f, t, s);
        drawBoxHandles(ctx, [f[0], f[1], 0, 0], [f, t], s);
      } else {
        const b = d?.kind === 'shapeHandle' && d.box && d.now && d.handle != null
          ? resizeBox(d.box, d.handle, d.now.x - d.startDoc.x, d.now.y - d.startDoc.y, d.mode === 'add')
          : shapeBox(info);
        drawBoxHandles(ctx, b, boxHandles(b), s);
      }
    }
    if (PATH_TOOLS.includes(tool)) {
      const path = d?.work ?? st.activePath?.path;
      if (path) drawPath(ctx, path, s, { anchors: tool !== 'pathSelect', selected: directSelRef.current });
      if (tool === 'pen' && penRef.current) drawPenPreview(ctx, penRef.current, d ? undefined : cursorRef.current, s);
    }
    if (st.transformSession) drawTfUI(ctx, st.transformSession, s);
    if (tool === 'crop' && st.cropSession) drawCropOverlay(ctx, st.cropSession.box, st.cropSession.angle, s, doc.width, doc.height);
    if (STROKE_TOOLS.includes(tool) && cursorRef.current && !st.transformSession) {
      drawBrushCursor(ctx, cursorRef.current, st.brush.size, s);
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { paintOverlay(); }, [shapeInfo, activePath, cropSession, view.scale, activeTool, layers, selectedId, transformSession, doc?.width, doc?.height]);

  // Rulers (CNV-010): screen-space strips that follow pan/zoom, ticks in the chosen unit.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    let previous: { w: number; h: number } | undefined;
    const sync = () => {
      const w = el.clientWidth, h = el.clientHeight;
      const st = useStore.getState();
      if (previous && st.doc && (previous.w !== w || previous.h !== h)) st.setView({ tx: st.view.tx + (w - previous.w) / 2, ty: st.view.ty + (h - previous.h) / 2 });
      previous = { w, h };
      setWrapSize({ w, h }); st.setViewport(w, h);
    };
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    sync();
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    if (!doc || !showRulers) return;
    const ppi = doc.resolution ?? 72;
    if (rulerHRef.current) drawRuler(rulerHRef.current, true, wrapSize.w, view.tx, view.scale, rulerUnit, ppi);
    if (rulerVRef.current) drawRuler(rulerVRef.current, false, wrapSize.h, view.ty, view.scale, rulerUnit, ppi);
  }, [doc, showRulers, rulerUnit, view.tx, view.ty, view.scale, wrapSize.w, wrapSize.h, theme]);

  // Guides overlay: 1px cyan lines at document coordinates (shares the canvas CSS transform).
  useEffect(() => {
    const c = guidesRef.current;
    if (!c || !doc) return;
    c.width = doc.width; c.height = doc.height;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, doc.width, doc.height);
    ctx.strokeStyle = '#00c8ff';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const g of guides) {
      if (g.orientation === 'horizontal') { ctx.moveTo(0, g.position + 0.5); ctx.lineTo(doc.width, g.position + 0.5); }
      else { ctx.moveTo(g.position + 0.5, 0); ctx.lineTo(g.position + 0.5, doc.height); }
    }
    ctx.stroke();
  }, [guides, doc?.width, doc?.height]);

  const band = (b: Band | null) => {
    const ants = antsRef.current;
    if (ants && doc) drawBand(ants, doc.width, doc.height, b);
  };
  const restoreAnts = () => {
    if (doc && antsRef.current) clearOverlay(antsRef.current, doc.width, doc.height);
  };

  const finishPoly = async () => {
    const p = polyRef.current;
    polyRef.current = null;
    band(null);
    if (p && p.points.length >= 3) await lasso(p.points, p.mode);
    else restoreAnts();
  };
  const cancelPoly = () => { polyRef.current = null; band(null); restoreAnts(); };

  const finishPen = async (closed: boolean) => {
    const knots = penRef.current;
    penRef.current = null;
    paintOverlay();
    if (knots && knots.length >= 2) await useStore.getState().penFinish({ closed, knots });
  };

  const isTyping = (t: EventTarget | null) => {
    const el = t as HTMLElement | null;
    return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
  };

  // Move tool: arrow keys nudge the selected layer 1 px (Shift: 10 px), like Photoshop.
  useEffect(() => {
    if (activeTool !== 'move' || transformSession) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || e.keyCode === 229 || document.querySelector('dialog[open], [data-editor-popover]')) return;
      if (isTyping(e.target)) return;
      const step = e.shiftKey ? 10 : 1;
      const d: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      const v = d[e.key];
      if (!v) return;
      e.preventDefault();
      void useStore.getState().nudgeLayer(v[0], v[1]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeTool, transformSession]);

  // Enter commits the transform, Escape cancels it.
  useEffect(() => {
    if (!transformSession) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || e.keyCode === 229 || document.querySelector('dialog[open], [data-editor-popover]')) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT')) return;
      if (e.key === 'Enter') { e.preventDefault(); void commitTransform(); return; }
      if (e.key === 'Escape') { e.preventDefault(); cancelTransform(); setMenu(null); return; }
      const step = e.shiftKey ? 10 : 1;
      const dir: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      const v = dir[e.key];
      const ts = useStore.getState().transformSession;
      if (!v || !ts) return;
      e.preventDefault();
      useStore.setState({ transformSession: tfDrag(ts, { kind: 'inside' }, [0, 0], v, { shift: false, alt: false, mod: false }) });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [transformSession, commitTransform, cancelTransform]);

  // Gesture keys: polygon lasso / pen (Enter, Esc, Backspace) and Delete (anchors, pixels, layer).
  useEffect(() => {
    if (transformSession) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || e.keyCode === 229 || document.querySelector('dialog[open], [data-editor-popover]')) return;
      if (isTyping(e.target) || e.metaKey || e.ctrlKey) return;
      const k = e.key;
      if (useStore.getState().activeTool === 'crop') {
        if (k === 'Enter') { e.preventDefault(); void useStore.getState().commitCrop(); }
        else if (k === 'Escape') { e.preventDefault(); useStore.getState().cancelCrop(); }
        return;
      }
      if (polyRef.current) {
        if (k === 'Enter') { e.preventDefault(); void finishPoly(); }
        else if (k === 'Escape') { e.preventDefault(); cancelPoly(); }
        else if (k === 'Backspace' || k === 'Delete') {
          e.preventDefault();
          polyRef.current.points.pop();
          if (!polyRef.current.points.length) cancelPoly();
          else band({ kind: 'poly', points: polyRef.current.points, cursor: cursorRef.current });
        }
        return;
      }
      if (penRef.current) {
        if (k === 'Enter' || k === 'Escape') { e.preventDefault(); void finishPen(false); }
        else if (k === 'Backspace' || k === 'Delete') {
          e.preventDefault();
          penRef.current.pop();
          if (!penRef.current.length) penRef.current = null;
          paintOverlay();
        }
        return;
      }
      if (k !== 'Delete' && k !== 'Backspace') return;
      e.preventDefault();
      const st = useStore.getState();
      if (st.activeTool === 'directSelect' && st.activePath && directSelRef.current.length) {
        let p = st.activePath.path;
        const sel = [...directSelRef.current].sort((a, b) => b.sub - a.sub || b.knot - a.knot);
        for (const q of sel) p = deleteKnot(p, q.sub, q.knot);
        directSelRef.current = [];
        void st.commitPath(p);
        return;
      }
      void st.deleteKey();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transformSession, doc?.width, doc?.height]);

  useEffect(() => {
    const dn = (e: KeyboardEvent) => { if (e.code === 'Space' && !e.isComposing && !document.querySelector('dialog[open], [data-editor-popover]') && !isTyping(e.target)) setSpace(true); };
    const up = (e: KeyboardEvent) => { if (e.code === 'Space') setSpace(false); };
    window.addEventListener('keydown', dn);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', dn); window.removeEventListener('keyup', up); };
  }, []);

  const toDoc = (e: { clientX: number; clientY: number }): Pt => {
    const r = wrapRef.current?.getBoundingClientRect();
    return screenToDoc(e.clientX, e.clientY, { left: r?.left ?? 0, top: r?.top ?? 0 }, view);
  };

  /** Unrounded document coordinates (smooth transform handles). */
  const toDocF = (e: { clientX: number; clientY: number }): [number, number] => {
    const r = wrapRef.current?.getBoundingClientRect();
    return [(e.clientX - (r?.left ?? 0) - view.tx) / view.scale, (e.clientY - (r?.top ?? 0) - view.ty) / view.scale];
  };

  const onWheel = (e: React.WheelEvent) => {
    if (!doc) return;
    setView({ scale: Math.min(16, Math.max(0.05, view.scale * (e.deltaY < 0 ? 1.1 : 1 / 1.1))) });
  };

  const newDrag = (kind: DragKind, e: React.PointerEvent, startDoc: Pt, mode: SelectMode, extra: Partial<NonNullable<Drag>> = {}): Drag => ({
    kind, mode, ellipse: activeTool === 'marqueeEllipse', startDoc,
    startX: e.clientX, startY: e.clientY, tx0: view.tx, ty0: view.ty, acc: { dx: 0, dy: 0 },
    points: [[startDoc.x, startDoc.y]], ...extra,
  });

  /** Path selection / direct selection: pick the shape layer under the pointer, refresh its path. */
  const pickPathOwner = async (p: Pt) => {
    const st = useStore.getState();
    await st.pickLayerAt(p.x, p.y);
    await useStore.getState().refreshActivePath();
  };

  const pinchFrame = () => {
    const pts = [...touchesRef.current.values()];
    const [a, b] = pts;
    return { d: Math.hypot(b.x - a.x, b.y - a.y) || 1, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
  };
  /** True when the touch event belongs to a multi-finger gesture (the tool must not see it). */
  const touchDown = (e: React.PointerEvent): boolean => {
    if (e.pointerType !== 'touch') return false;
    touchesRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touchesRef.current.size >= 2) {
      if (dragRef.current) { dragRef.current = null; band(null); paintOverlay(); }
      const f = pinchFrame();
      const prev = pinchRef.current;
      pinchRef.current = { d0: f.d, mid0: f.mid, s0: view.scale, tx0: view.tx, ty0: view.ty, moved: prev?.moved ?? false, at: prev?.at ?? Date.now(), count: Math.max(prev?.count ?? 0, touchesRef.current.size) };
      return true;
    }
    return gestureHoldRef.current;
  };
  const touchMove = (e: React.PointerEvent): boolean => {
    if (e.pointerType !== 'touch' || !touchesRef.current.has(e.pointerId)) return false;
    touchesRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const p = pinchRef.current;
    if (p && touchesRef.current.size >= 2) {
      const f = pinchFrame();
      const r = wrapRef.current?.getBoundingClientRect();
      const left = r?.left ?? 0, top = r?.top ?? 0;
      const scale = Math.min(16, Math.max(0.05, p.s0 * f.d / p.d0));
      const docX = (p.mid0.x - left - p.tx0) / p.s0, docY = (p.mid0.y - top - p.ty0) / p.s0;
      if (Math.abs(f.d - p.d0) > 8 || Math.hypot(f.mid.x - p.mid0.x, f.mid.y - p.mid0.y) > 8) p.moved = true;
      setView({ scale, tx: f.mid.x - left - docX * scale, ty: f.mid.y - top - docY * scale });
      return true;
    }
    return gestureHoldRef.current;
  };
  const touchUp = (e: React.PointerEvent): boolean => {
    if (e.pointerType !== 'touch' || !touchesRef.current.has(e.pointerId)) return false;
    touchesRef.current.delete(e.pointerId);
    const p = pinchRef.current;
    if (p) {
      if (touchesRef.current.size === 0) {
        pinchRef.current = null;
        if (!p.moved && Date.now() - p.at < 350) void (p.count >= 3 ? useStore.getState().redo() : useStore.getState().undo());
      } else if (touchesRef.current.size === 1) { pinchRef.current = { ...p }; }
      gestureHoldRef.current = touchesRef.current.size > 0;
      return true;
    }
    if (gestureHoldRef.current) { gestureHoldRef.current = touchesRef.current.size > 0; return true; }
    return false;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!doc) return;
    (e.target as Element).setPointerCapture(e.pointerId);
    if (touchDown(e)) return;
    // With a stylus in use, a single finger moves the view and the pen does the drawing.
    const touchPrefs = useTouch.getState();
    if (e.pointerType === 'touch' && touchPrefs.penDraws && touchPrefs.penSeen && !useStore.getState().transformSession) {
      dragRef.current = newDrag('pan', e, toDoc(e), useStore.getState().selectOpts.mode);
      return;
    }
    const panning = space || e.button === 1 || activeTool === 'hand';
    const startDoc = toDoc(e);
    const st = useStore.getState();
    // Modifier keys win; otherwise the options-bar mode applies.
    const mode = e.shiftKey || e.altKey ? modeFrom(e.shiftKey, e.altKey) : st.selectOpts.mode;
    const tol = 6 / view.scale;
    const pt: [number, number] = [startDoc.x, startDoc.y];

    if (panning) { dragRef.current = newDrag('pan', e, startDoc, mode); return; }

    // Free transform: handles, reference point, inside (move), outside ring (rotate), warp points.
    if (transformSession) {
      if (e.button === 2) return; // right button opens the transform menu
      const f = toDocF(e);
      const hit = tfHit(transformSession, f, tol);
      if (hit) dragRef.current = newDrag('transform', e, startDoc, mode, { tfHit: hit, tf0: transformSession, tfStart: f });
      return;
    }

    // Crop tool: handles / inside (move) / just outside (rotate) / elsewhere (new frame).
    if (activeTool === 'crop' && st.cropSession) {
      const { box, angle } = st.cropSession;
      const local = rotateAbout(pt, boxCenter(box), -angle);
      const idx = boxHandles(box).findIndex((q) => Math.abs(q[0] - local[0]) <= tol && Math.abs(q[1] - local[1]) <= tol);
      const extra = { box, angle0: angle };
      const inside = local[0] >= box[0] && local[0] <= box[0] + box[2] && local[1] >= box[1] && local[1] <= box[1] + box[3];
      const ring = 36 / view.scale;
      const near = local[0] >= box[0] - ring && local[0] <= box[0] + box[2] + ring && local[1] >= box[1] - ring && local[1] <= box[1] + box[3] + ring;
      if (idx >= 0) dragRef.current = newDrag('cropHandle', e, startDoc, mode, { ...extra, handle: idx });
      else if (inside) dragRef.current = newDrag('cropMove', e, startDoc, mode, extra);
      else if (near) dragRef.current = newDrag('cropRotate', e, startDoc, mode, extra);
      else dragRef.current = newDrag('cropDraw', e, startDoc, mode, extra);
      return;
    }

    // Shape handles (shape tool, and the move tool's transform controls).
    const info = st.shapeInfo;
    if (info && (activeTool === 'shape' || activeTool === 'move')) {
      if (isLine(info)) {
        const ends = [info.live!.from!, info.live!.to!];
        const end = ends.findIndex((q) => Math.hypot(q[0] - pt[0], q[1] - pt[1]) <= tol);
        if (end >= 0) { dragRef.current = newDrag('shapeHandle', e, startDoc, mode, { lineEnd: end as 0 | 1 }); return; }
      } else {
        const b = shapeBox(info);
        const idx = boxHandles(b).findIndex((q) => Math.abs(q[0] - pt[0]) <= tol && Math.abs(q[1] - pt[1]) <= tol);
        if (idx >= 0) { dragRef.current = newDrag('shapeHandle', e, startDoc, e.shiftKey ? 'add' : 'replace', { handle: idx, box: b }); return; }
      }
    }

    // Type tool: a click outside the open editor commits it; otherwise click = point text,
    // drag = paragraph box, click on a type layer = edit it in place.
    if (activeTool === 'type') {
      if (st.typeEditing) { void st.commitType(); return; }
      dragRef.current = newDrag('typeDraw', e, startDoc, mode);
      return;
    }

    switch (activeTool) {
      case 'wand': void magicWand(startDoc.x, startDoc.y, mode); return;
      case 'bucket': void paintBucket(startDoc.x, startDoc.y); return;
      case 'eyedropper': void sampleColor(startDoc.x, startDoc.y); return;
      case 'marqueeRow':
      case 'marqueeCol':
        void marquee(stripBox(startDoc, activeTool === 'marqueeRow' ? 'row' : 'col', doc.width, doc.height), mode, false);
        return;
      case 'polyLasso': {
        const poly = polyRef.current;
        if (!poly) {
          if (mode === 'replace' && pointInMask(startDoc, st.selection)) { dragRef.current = newDrag('moveSel', e, startDoc, mode); return; }
          polyRef.current = { points: [pt], mode };
        } else {
          const first = poly.points[0];
          if (poly.points.length >= 3 && Math.hypot(first[0] - pt[0], first[1] - pt[1]) <= tol) { void finishPoly(); return; }
          poly.points.push(pt);
        }
        band({ kind: 'poly', points: polyRef.current!.points, cursor: pt });
        return;
      }
      case 'pen': {
        const knots = penRef.current;
        if (knots) {
          if (knots.length >= 2 && Math.hypot(knots[0].anchor[0] - pt[0], knots[0].anchor[1] - pt[1]) <= tol) { void finishPen(true); return; }
          knots.push(cornerKnot(pt));
          dragRef.current = newDrag('penDrag', e, startDoc, mode);
          return;
        }
        // No subpath in progress: edit the active path (delete / add / convert anchor) or start one.
        const ap = st.activePath;
        if (ap) {
          const hit = hitKnot(ap.path, pt, tol);
          if (hit?.kind === 'anchor') {
            void st.commitPath(e.altKey ? togglePoint(ap.path, hit.sub, hit.knot) : deleteKnot(ap.path, hit.sub, hit.knot));
            return;
          }
          const near = nearestSegment(ap.path, pt);
          if (near && near.d <= tol) { void st.commitPath(splitSegment(ap.path, near.sub, near.seg, near.t)); return; }
        }
        penRef.current = [cornerKnot(pt)];
        dragRef.current = newDrag('penDrag', e, startDoc, mode);
        return;
      }
      case 'pathSelect': {
        const ap = st.activePath;
        const onPath = ap && (hitKnot(ap.path, pt, tol) || (nearestSegment(ap.path, pt)?.d ?? Infinity) <= tol);
        if (!onPath && !layerUnder(st.layers, pt, true)) { dragRef.current = newDrag('boxSelect', e, startDoc, mode, { boxOf: 'shapes' }); return; }
        const pending = onPath ? undefined : pickPathOwner(startDoc);
        dragRef.current = newDrag('pathMove', e, startDoc, mode, { pending });
        return;
      }
      case 'directSelect': {
        const ap = st.activePath;
        const hit = ap ? hitKnot(ap.path, pt, tol) : undefined;
        if (!ap || !hit) {
          if (!e.shiftKey) directSelRef.current = [];
          const nearPath = ap && (nearestSegment(ap.path, pt)?.d ?? Infinity) <= tol;
          if (ap && !nearPath && !layerUnder(st.layers, pt, true)) { dragRef.current = newDrag('boxSelect', e, startDoc, mode, { boxOf: 'anchors' }); paintOverlay(); return; }
          if (!ap || !nearPath) void pickPathOwner(startDoc);
          paintOverlay();
          return;
        }
        const key = { sub: hit.sub, knot: hit.knot };
        const has = directSelRef.current.some((q) => q.sub === key.sub && q.knot === key.knot);
        if (hit.kind === 'anchor') {
          if (e.shiftKey) directSelRef.current = has ? directSelRef.current.filter((q) => q.sub !== key.sub || q.knot !== key.knot) : [...directSelRef.current, key];
          else if (!has) directSelRef.current = [key];
        }
        dragRef.current = newDrag('direct', e, startDoc, mode, { hit, sel: hit.kind === 'anchor' ? directSelRef.current : [key], basePath: ap.path });
        paintOverlay();
        return;
      }
      case 'shape': dragRef.current = newDrag('shapeDraw', e, startDoc, mode); return;
      case 'move': {
        // Auto-select on and nothing (but the Background) under the pointer: box-select layers.
        if ((st.autoSelect || e.metaKey || e.ctrlKey) && !layerUnder(st.layers, pt)) {
          dragRef.current = newDrag('boxSelect', e, startDoc, mode, { boxOf: 'layers' });
          return;
        }
        const pending = st.autoSelect || e.metaKey || e.ctrlKey ? st.pickLayerAt(startDoc.x, startDoc.y) : undefined;
        const cur = flatten(st.layers).find((l) => l.id === st.selectedId)?.bounds;
        dragRef.current = newDrag('move', e, startDoc, mode, { pending, box: cur });
        if (pending) {
          void pending.then(() => {
            const d = dragRef.current;
            const s2 = useStore.getState();
            if (d?.kind === 'move') d.box = flatten(s2.layers).find((l) => l.id === s2.selectedId)?.bounds;
          });
        }
        return;
      }
      case 'gradient': dragRef.current = newDrag('gradient', e, startDoc, mode); return;
      default: break;
    }
    // Alt-click sets the clone/heal sample source instead of starting a stroke.
    if (SAMPLED_TOOLS.includes(activeTool) && e.altKey) { setCloneSource(pt); return; }
    if (STROKE_TOOLS.includes(activeTool)) {
      const p0: Pt2 = e.pointerType === 'pen' ? [startDoc.x, startDoc.y, e.pressure] : [startDoc.x, startDoc.y];
      dragRef.current = newDrag('paint', e, startDoc, mode, { points: [p0] });
      return;
    }
    if (SELECT_TOOLS.includes(activeTool)) {
      if (MOVE_SEL_TOOLS.includes(activeTool) && mode === 'replace' && !e.shiftKey && !e.altKey && pointInMask(startDoc, st.selection)) {
        dragRef.current = newDrag('moveSel', e, startDoc, mode);
        return;
      }
      dragRef.current = newDrag(activeTool === 'lasso' ? 'lasso' : 'marquee', e, startDoc, mode);
    }
  };

  /** Eraser preview: the background colour on a Background layer (that is what it paints), else a
   *  light veil standing in for transparency — never the foreground colour. */
  const strokeColor = () => {
    if (maskEditing) return '#888';
    if (activeTool !== 'eraser') return foreground;
    const l = flatten(layers).find((x) => x.id === selectedId);
    return l?.locks?.transparency ? background : 'rgba(255,255,255,0.9)';
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (touchMove(e)) return;
    const now = toDoc(e);
    cursorRef.current = [now.x, now.y];
    const d = dragRef.current;
    if (!d) {
      const ts = useStore.getState().transformSession;
      if (ts && wrapRef.current && !space) wrapRef.current.style.cursor = tfCursor(tfHit(ts, toDocF(e), 6 / view.scale));
      if (polyRef.current) band({ kind: 'poly', points: polyRef.current.points, cursor: [now.x, now.y] });
      if (penRef.current || STROKE_TOOLS.includes(activeTool)) paintOverlay();
      return;
    }
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    const ddx = now.x - d.startDoc.x;
    const ddy = now.y - d.startDoc.y;
    d.now = now;
    switch (d.kind) {
      case 'pan': setView({ tx: d.tx0 + dx, ty: d.ty0 + dy }); return;
      case 'move': d.acc = { dx, dy }; paintOverlay(); return;
      case 'transform': {
        if (!d.tf0 || !d.tfHit) return;
        const a = d.tfStart ?? [d.startDoc.x, d.startDoc.y];
        const next = tfDrag(d.tf0, d.tfHit, a, toDocF(e), { shift: e.shiftKey, alt: e.altKey, mod: e.metaKey || e.ctrlKey });
        useStore.setState({ transformSession: next });
        return;
      }
      case 'moveSel': {
        const sel = useStore.getState().selection;
        if (sel) band({ kind: 'rect', box: { x: sel.x + ddx, y: sel.y + ddy, width: sel.width, height: sel.height } });
        return;
      }
      case 'marquee': {
        const st = useStore.getState();
        const box = constrainBox(d.startDoc, now, {
          style: st.selectOpts.style,
          square: e.shiftKey && d.mode !== 'add' && d.mode !== 'intersect',
          center: e.altKey && d.mode !== 'subtract' && d.mode !== 'intersect',
        });
        band({ kind: d.ellipse ? 'ellipse' : 'rect', box });
        return;
      }
      case 'shapeDraw': {
        const kind = useStore.getState().shapeOpts.kind;
        if (kind === 'line') {
          const to = e.shiftKey ? snap45(d.startDoc, now) : now;
          const c = overlayRef.current;
          const ctx = c && doc ? overlayCtx(c, doc.width, doc.height) : null;
          if (ctx) drawLineBand(ctx, [d.startDoc.x, d.startDoc.y], [to.x, to.y], view.scale);
          return;
        }
        band({ kind: kind === 'ellipse' ? 'ellipse' : 'rect', box: constrainBox(d.startDoc, now, { square: e.shiftKey, center: e.altKey }) });
        return;
      }
      case 'shapeHandle': d.mode = e.shiftKey ? 'add' : 'replace'; paintOverlay(); return;
      case 'typeDraw': band({ kind: 'rect', box: dragBox(d.startDoc, now) }); return;
      case 'boxSelect': band({ kind: 'rect', box: dragBox(d.startDoc, now) }); return;
      case 'cropDraw': case 'cropHandle': case 'cropMove': case 'cropRotate': {
        const c = cropFromDrag(d, now, e.shiftKey);
        if (c) useStore.getState().setCrop(c);
        return;
      }
      case 'pathMove': {
        const ap = useStore.getState().activePath;
        if (ap) d.work = translatePath(ap.path, ddx, ddy);
        paintOverlay();
        return;
      }
      case 'direct': {
        if (!d.basePath || !d.hit) return;
        d.work = d.hit.kind === 'anchor'
          ? moveKnots(d.basePath, d.sel ?? [], ddx, ddy)
          : moveHandle(d.basePath, d.hit.sub, d.hit.knot, d.hit.kind, [now.x, now.y], e.altKey);
        paintOverlay();
        return;
      }
      case 'penDrag': {
        const knots = penRef.current;
        if (knots?.length) {
          const last = knots[knots.length - 1];
          knots[knots.length - 1] = smoothKnot(last.anchor, [now.x, now.y]);
        }
        paintOverlay();
        return;
      }
      case 'gradient':
        if (antsRef.current && doc) drawGradientGuide(antsRef.current, doc.width, doc.height, [d.startDoc.x, d.startDoc.y], [now.x, now.y]);
        return;
      case 'paint':
        addPoint(d.points, e.pointerType === 'pen' ? [now.x, now.y, e.pressure] : [now.x, now.y], brushSize);
        if (antsRef.current && doc) drawStrokePreview(antsRef.current, doc.width, doc.height, d.points.map((p) => [p[0], p[1]]), brushSize, strokeColor());
        paintOverlay();
        return;
      case 'lasso': {
        // Sample points so the polygon stays light.
        const last = d.points[d.points.length - 1];
        if (!last || Math.abs(now.x - last[0]) >= 2 || Math.abs(now.y - last[1]) >= 2) d.points.push([now.x, now.y]);
        band({ kind: 'lasso', points: d.points.map((p) => [p[0], p[1]]) });
        return;
      }
    }
  };

  const onPointerUp = async (e: React.PointerEvent) => {
    if (touchUp(e)) return;
    const d = dragRef.current;
    dragRef.current = null;
    if (!d) return;
    const end = toDoc(e);
    const ddx = end.x - d.startDoc.x;
    const ddy = end.y - d.startDoc.y;
    const st = useStore.getState();
    switch (d.kind) {
      case 'move': {
        await d.pending;
        paintOverlay();
        const id = useStore.getState().selectedId;
        if (id != null && (d.acc.dx || d.acc.dy)) await moveLayer(id, Math.round(d.acc.dx / view.scale), Math.round(d.acc.dy / view.scale));
        return;
      }
      case 'moveSel':
        band(null);
        if (ddx || ddy) await st.moveSelection(ddx, ddy);
        else { restoreAnts(); if (activeTool !== 'polyLasso') await st.selectMenu('deselect'); }
        return;
      case 'marquee': {
        band(null);
        const fixed = st.selectOpts.style.kind === 'size';
        const box = constrainBox(d.startDoc, end, {
          style: st.selectOpts.style,
          square: e.shiftKey && d.mode !== 'add' && d.mode !== 'intersect',
          center: e.altKey && d.mode !== 'subtract' && d.mode !== 'intersect',
        });
        if (fixed || !isTinyDrag(d.startDoc, end)) await marquee(box, d.mode, d.ellipse);
        else if (d.mode === 'replace' && st.selection) await st.selectMenu('deselect');
        else restoreAnts();
        return;
      }
      case 'lasso':
        band(null);
        if (d.points.length >= 3) await lasso(d.points.map((p) => [p[0], p[1]]), d.mode);
        else restoreAnts();
        return;
      case 'shapeDraw': {
        band(null);
        paintOverlay();
        const kind = st.shapeOpts.kind;
        if (kind === 'line') {
          const to = e.shiftKey ? snap45(d.startDoc, end) : end;
          if (Math.hypot(to.x - d.startDoc.x, to.y - d.startDoc.y) < 2) return;
          await st.drawShape(dragBox(d.startDoc, to), { from: [d.startDoc.x, d.startDoc.y], to: [to.x, to.y] });
          return;
        }
        if (isTinyDrag(d.startDoc, end)) return;
        await st.drawShape(constrainBox(d.startDoc, end, { square: e.shiftKey, center: e.altKey }));
        return;
      }
      case 'shapeHandle': {
        const info = st.shapeInfo;
        if (!info || (!ddx && !ddy)) { paintOverlay(); return; }
        if (d.lineEnd != null && info.live?.from && info.live.to) {
          const from = d.lineEnd === 0 ? [end.x, end.y] : info.live.from;
          const to = d.lineEnd === 1 ? [end.x, end.y] : info.live.to;
          await st.editShape({ from, to });
          return;
        }
        if (!d.box || d.handle == null) return;
        const nb = resizeBox(d.box, d.handle, ddx, ddy, e.shiftKey);
        if (info.live?.rect) await st.editShape({ rect: nb });
        else {
          // Path shapes have no live rect: map the old box onto the new one.
          const [ox, oy, ow, oh] = d.box;
          const sx = nb[2] / (ow || 1), sy = nb[3] / (oh || 1);
          await st.editShape({ transform: [sx, 0, 0, sy, nb[0] - ox * sx, nb[1] - oy * sy] });
        }
        return;
      }
      case 'pathMove':
        await d.pending;
        d.work = undefined;
        if (ddx || ddy) await useStore.getState().movePath(ddx, ddy);
        paintOverlay();
        return;
      case 'direct':
        if (d.work && (ddx || ddy)) await st.commitPath(d.work);
        else paintOverlay();
        return;
      case 'penDrag': paintOverlay(); return;
      case 'boxSelect': {
        band(null);
        restoreAnts();
        const b = dragBox(d.startDoc, end);
        if (isTinyDrag(d.startDoc, end, 3)) {
          // A click on empty canvas deselects (move tool), like Photoshop.
          if (d.boxOf === 'anchors') { directSelRef.current = []; paintOverlay(); }
          return;
        }
        const box: [number, number, number, number] = [b.x, b.y, b.width, b.height];
        if (d.boxOf === 'anchors') {
          const ap = st.activePath;
          if (!ap) return;
          const inBox = ap.path.subpaths.flatMap((sp, sub) => sp.knots.map((k, knot) => ({ sub, knot, a: k.anchor })))
            .filter((q) => q.a[0] >= b.x && q.a[0] <= b.x + b.width && q.a[1] >= b.y && q.a[1] <= b.y + b.height)
            .map(({ sub, knot }) => ({ sub, knot }));
          directSelRef.current = e.shiftKey ? [...directSelRef.current, ...inBox] : inBox;
          paintOverlay();
          return;
        }
        if (d.boxOf === 'shapes') {
          const before = st.selectedIds;
          st.selectLayersInBox(box, e.shiftKey);
          const shapesOnly = useStore.getState().selectedIds.filter((id) => /shape/i.test(flatten(st.layers).find((l) => l.id === id)?.kind ?? ''));
          if (shapesOnly.length) { useStore.setState({ selectedIds: shapesOnly, selectedId: shapesOnly[shapesOnly.length - 1] }); await useStore.getState().refreshActivePath(); }
          else useStore.setState({ selectedIds: before });
          return;
        }
        st.selectLayersInBox(box, e.shiftKey);
        return;
      }
      case 'typeDraw': {
        band(null);
        restoreAnts();
        if (isTinyDrag(d.startDoc, end, 4)) await st.beginType(d.startDoc.x, d.startDoc.y);
        else { const b = dragBox(d.startDoc, end); await st.beginType(b.x, b.y, [b.x, b.y, b.width, b.height]); }
        return;
      }
      case 'cropDraw': case 'cropHandle': case 'cropMove': case 'cropRotate': {
        const c = cropFromDrag(d, end, e.shiftKey);
        if (c && !(d.kind === 'cropDraw' && isTinyDrag(d.startDoc, end))) st.setCrop(c);
        else if (d.kind === 'cropDraw' && d.box) st.setCrop({ box: d.box, angle: d.angle0 ?? 0 });
        return;
      }
      case 'paint':
        if (doc && antsRef.current) clearOverlay(antsRef.current, doc.width, doc.height);
        if (PAINT_TOOLS.includes(activeTool)) await paintStroke(d.points);
        else await retouchStroke(d.points.map((p) => [p[0], p[1]]));
        restoreAnts();
        return;
      case 'gradient':
        if (doc && antsRef.current) clearOverlay(antsRef.current, doc.width, doc.height);
        if (!isGradientTooShort([d.startDoc.x, d.startDoc.y], [end.x, end.y])) await paintGradient([d.startDoc.x, d.startDoc.y], [end.x, end.y]);
        restoreAnts();
        return;
      default: return;
    }
  };

  const onDoubleClick = async () => {
    if (useStore.getState().transformSession) { await commitTransform(); return; }
    if (activeTool === 'crop') { await useStore.getState().commitCrop(); return; }
    if (polyRef.current) { await finishPoly(); return; }
    if (activeTool === 'pen' && penRef.current) { await finishPen(false); return; }
    // Double-click a type layer (any tool): switch to the Type tool and edit it in place.
    const at = cursorRef.current;
    if (!at) return;
    const st = useStore.getState();
    const hit = st.session ? await st.session.typeHit(at[0], at[1]) : undefined;
    if (hit == null) return;
    st.setTool('type');
    await useStore.getState().beginType(at[0], at[1]);
  };

  /** Drop on the canvas: images are placed into the open document as layers (PS: Place);
   *  documents (PSD/PSB/.pcraft) open in a new tab. With nothing open, the first file opens. */
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    // A card dragged from the 素材 panel: place that library asset.
    const assetId = e.dataTransfer.getData(ASSET_DRAG_TYPE);
    if (assetId) { void useAssets.getState().place(assetId); return; }
    const files = Array.from(e.dataTransfer.files ?? []);
    void (async () => {
      for (const f of files) {
        const st = useStore.getState();
        const isDoc = /\.(psd|psb|pcraft)$/i.test(f.name);
        if (st.session && !isDoc) await st.placeImage(f);
        else await st.openFile(f);
      }
    })();
    // Dropped images also go to the library, so the design agent can find the user's own material.
    const images = files.filter((f) => /^image\/(png|jpeg|webp)$/.test(f.type));
    if (images.length && hasAccess(useWb.getState())) void useAssets.getState().uploadFiles(images);
  };

  const cursor = space ? 'grab' : toolCursor(activeTool, STROKE_TOOLS.includes(activeTool));
  const transform = `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`;

  return (
    <div
      ref={wrapRef}
      className="canvas-wrap"
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => void onPointerUp(e)}
      onPointerCancel={(e) => { touchUp(e); if (dragRef.current) { dragRef.current = null; band(null); paintOverlay(); } }}
      onPointerLeave={() => { cursorRef.current = undefined; if (!dragRef.current) paintOverlay(); }}
      onDoubleClick={() => void onDoubleClick()}
      onContextMenu={(e) => {
        // The canvas never shows the browser menu; in Free Transform it offers the PS transform menu.
        e.preventDefault();
        const r = wrapRef.current?.getBoundingClientRect();
        const st = useStore.getState();
        if (st.transformSession && r) setMenu({ x: e.clientX - r.left, y: e.clientY - r.top });
        // Otherwise: selection / layer commands (Photoshop-style context menu).
        else if (st.session && !st.typeEditing && !st.cropSession) useContextMenu.getState().open(e.clientX, e.clientY, canvasMenu(), '画布操作');
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
      style={{ cursor }}
      data-painted={paintedNonce === render.nonce ? '1' : '0'}
    >
      {!doc && <EmptyCanvas />}
      {doc && <canvas ref={canvasRef} className="doc" style={{ transform }} />}
      {doc && compare && baseline && (
        <img className="doc" src={baseline} alt="初始状态" draggable={false} style={{ transform, pointerEvents: 'none' }} />
      )}
      {doc && <canvas ref={antsScreenRef} className="ants ants-screen" data-ants="screen" style={{ transform: 'none', left: 0, top: 0 }} />}
      {doc && <canvas ref={previewRef} className="tf-preview" data-preview="transform" style={{ transform }} />}
      {doc && <canvas ref={antsRef} className="ants" style={{ transform }} />}
      {doc && <canvas ref={guidesRef} className="guides" style={{ transform }} />}
      {doc && <canvas ref={overlayRef} className="cursor" data-overlay="vector" style={{ transform }} />}
      <TypeEditor />
      <SampleRing />
      {doc && <SelectionActions view={view} />}
      {menu && transformSession && <TransformMenu at={menu} onClose={() => setMenu(null)} />}
      {doc && showRulers && <canvas ref={rulerHRef} className="ruler ruler-h" aria-label="水平标尺" />}
      {doc && showRulers && <canvas ref={rulerVRef} className="ruler ruler-v" aria-label="垂直标尺" />}
    </div>
  );
}

/** Shift with the line tool: snap the end point to 45° increments. */
function snap45(a: Pt, b: Pt): Pt {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
  return { x: Math.round(a.x + Math.cos(ang) * len), y: Math.round(a.y + Math.sin(ang) * len) };
}

/** Crop frame for the current drag (draw / handle / move / rotate), honouring the ratio option. */
function cropFromDrag(d: NonNullable<Drag>, now: Pt, shift: boolean): { box: [number, number, number, number]; angle: number } | undefined {
  const st = useStore.getState();
  const r = cropRatio(st.cropOpts);
  const box = d.box;
  const angle = d.angle0 ?? 0;
  if (!box) return undefined;
  switch (d.kind) {
    case 'cropDraw': {
      const style = r > 0 ? { kind: 'ratio' as const, w: r, h: 1 } : { kind: 'normal' as const };
      const b = constrainBox(d.startDoc, now, { style, square: shift && r === 0 });
      return { box: [b.x, b.y, Math.max(1, b.width), Math.max(1, b.height)], angle: 0 };
    }
    case 'cropMove':
      return { box: [box[0] + now.x - d.startDoc.x, box[1] + now.y - d.startDoc.y, box[2], box[3]], angle };
    case 'cropHandle': {
      // Drag in the frame's own (unrotated) axes.
      const c = boxCenter(box);
      const a = rotateAbout([d.startDoc.x, d.startDoc.y], c, -angle);
      const b = rotateAbout([now.x, now.y], c, -angle);
      let nb = resizeBox(box, d.handle ?? 2, b[0] - a[0], b[1] - a[1], shift && r === 0);
      if (r > 0) nb = fitRatio(nb, r, d.handle ?? 2);
      return { box: nb, angle };
    }
    case 'cropRotate': {
      let deg = angle + sweepAngle(boxCenter(box), [d.startDoc.x, d.startDoc.y], [now.x, now.y]);
      if (shift) deg = Math.round(deg / 15) * 15;
      return { box, angle: Math.round(deg * 10) / 10 };
    }
    default: return undefined;
  }
}

/** Crop overlay: darkened surroundings, rotated frame, rule-of-thirds grid, handles. */
function drawCropOverlay(ctx: CanvasRenderingContext2D, box: [number, number, number, number], angle: number, scale: number, w: number, h: number) {
  const c = boxCenter(box);
  const corners = ([[box[0], box[1]], [box[0] + box[2], box[1]], [box[0] + box[2], box[1] + box[3]], [box[0], box[1] + box[3]]] as [number, number][])
    .map((p) => rotateAbout(p, c, angle));
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.beginPath();
  ctx.rect(0, 0, w, h);
  ctx.moveTo(corners[0][0], corners[0][1]);
  for (let i = 3; i >= 1; i--) ctx.lineTo(corners[i][0], corners[i][1]); // opposite winding = hole
  ctx.closePath();
  ctx.fill('evenodd');
  ctx.translate(c[0], c[1]);
  ctx.rotate((angle * Math.PI) / 180);
  ctx.translate(-c[0], -c[1]);
  const px = 1 / scale;
  ctx.lineWidth = px;
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.beginPath();
  for (const t of [1 / 3, 2 / 3]) {
    ctx.moveTo(box[0] + box[2] * t, box[1]); ctx.lineTo(box[0] + box[2] * t, box[1] + box[3]);
    ctx.moveTo(box[0], box[1] + box[3] * t); ctx.lineTo(box[0] + box[2], box[1] + box[3] * t);
  }
  ctx.stroke();
  ctx.restore();
  ctx.save();
  ctx.translate(c[0], c[1]);
  ctx.rotate((angle * Math.PI) / 180);
  ctx.translate(-c[0], -c[1]);
  drawBoxHandles(ctx, box, boxHandles(box), scale);
  ctx.restore();
}

const TF_MODES: [import('../state/store').TfMode, string][] = [
  ['free', '自由变换'], ['scale', '缩放'], ['rotate', '旋转'], ['skew', '斜切'], ['distort', '扭曲'], ['perspective', '透视'], ['warp', '变形'],
];
const TF_OPS: ['rotate180' | 'rotate90Cw' | 'rotate90Ccw' | 'flipH' | 'flipV', string][] = [
  ['rotate180', '旋转 180 度'], ['rotate90Cw', '顺时针旋转 90 度'], ['rotate90Ccw', '逆时针旋转 90 度'], ['flipH', '水平翻转'], ['flipV', '垂直翻转'],
];

/** Free Transform context menu (right click), Photoshop order. */
function TransformMenu({ at, onClose }: { at: { x: number; y: number }; onClose: () => void }) {
  const t = useStore((s) => s.transformSession);
  const setMode = useStore((s) => s.setTransformMode);
  const op = useStore((s) => s.transformSessionOp);
  useEffect(() => {
    const close = () => onClose();
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [onClose]);
  const item = (label: string, on: boolean, run: () => void, disabled = false) => (
    <button
      key={label} role="menuitemradio" aria-checked={on} disabled={disabled}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={() => { run(); onClose(); }}
    >
      {on ? '✓ ' : ''}{label}
    </button>
  );
  return (
    <div className="tf-menu" role="menu" aria-label="变换菜单" style={{ left: at.x, top: at.y }} onPointerDown={(e) => e.stopPropagation()}>
      {TF_MODES.map(([m, l]) => item(l, t?.mode === m, () => void setMode(m)))}
      <hr />
      {TF_OPS.map(([o, l]) => item(l, false, () => op(o), t?.mode === 'warp'))}
    </div>
  );
}

/** Topmost visible layer (not the Background) whose bounds contain `p`; `shapesOnly` for the
 *  path tools. Bounds-based, so it is synchronous (used to decide drag-vs-box-select). */
function layerUnder(layers: import('../engine/protocol').LayerNode[], p: [number, number], shapesOnly = false) {
  return flatten(layers).find((l) => {
    if (l.visible === false || !l.bounds || l.bounds[2] <= 0) return false;
    if (/^pixel$/i.test(l.kind) && /^(背景|background)$/i.test(l.name) && l.locks?.position) return false;
    if (/group/i.test(l.kind)) return false;
    if (shapesOnly && !/shape/i.test(l.kind)) return false;
    const [x, y, w, h] = l.bounds;
    return p[0] >= x && p[0] < x + w && p[1] >= y && p[1] < y + h;
  });
}

/** Eyedropper ring (Photoshop's sampling ring): new colour on top, previous colour below. */
function SampleRing() {
  const f = useStore((s) => s.sampleFlash);
  const view = useStore((s) => s.view);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!f) return;
    const t = setTimeout(() => { useStore.setState({ sampleFlash: undefined }); tick((n) => n + 1); }, 900);
    return () => clearTimeout(t);
  }, [f]);
  if (!f) return null;
  const left = view.tx + (f.x + 0.5) * view.scale, top = view.ty + (f.y + 0.5) * view.scale;
  return (
    <div className="sample-ring" aria-hidden="true" style={{ left, top }}>
      <span style={{ background: f.color }} /><span style={{ background: f.prev }} />
    </div>
  );
}
