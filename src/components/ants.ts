// Marching-ants overlay painting. Kept out of CanvasView so the geometry stays testable
// and the component only deals with gestures.
import { outlinePixels, outlineSegments, outlineStep, downsample, type Box } from '../engine/selection';
import type { SelectionMask } from '../engine/protocol';
import type { PathData, Knot } from '../engine/pathgeom';

function fit(canvas: HTMLCanvasElement, w: number, h: number): CanvasRenderingContext2D | null {
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  const ctx = canvas.getContext('2d');
  if (ctx) ctx.clearRect(0, 0, w, h);
  return ctx;
}

/** Paints the committed selection as a 1px black/white dashed outline (static, no animation). */
export function drawAnts(canvas: HTMLCanvasElement, docW: number, docH: number, sel?: SelectionMask) {
  const ctx = fit(canvas, docW, docH);
  if (!ctx || !sel) return;
  const step = outlineStep(sel.width, sel.height);
  const { cov, w, h } = downsample(sel.coverage, sel.width, sel.height, step);
  const edge = outlinePixels(cov, w, h);
  const img = ctx.createImageData(w, h);
  for (let i = 0; i < edge.length; i++) {
    if (!edge[i]) continue;
    const x = i % w;
    const y = (i / w) | 0;
    const white = ((x + y) >> 2) & 1;
    const o = i * 4;
    img.data[o] = img.data[o + 1] = img.data[o + 2] = white ? 255 : 0;
    img.data[o + 3] = 255;
  }
  if (step === 1) {
    ctx.putImageData(img, sel.x, sel.y);
    return;
  }
  // Downsampled for display: blit through a temp canvas so it scales back to the real bounds.
  const tmp = document.createElement('canvas');
  tmp.width = w;
  tmp.height = h;
  tmp.getContext('2d')?.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(tmp, sel.x, sel.y, sel.width, sel.height);
}

export type Band =
  | { kind: 'rect' | 'ellipse'; box: Box }
  | { kind: 'lasso'; points: [number, number][] }
  | { kind: 'poly'; points: [number, number][]; cursor?: [number, number] };

/** Live rubber band while dragging, in document pixels. Replaces the ants until pointer-up. */
export function drawBand(canvas: HTMLCanvasElement, docW: number, docH: number, band: Band | null) {
  const ctx = fit(canvas, docW, docH);
  if (!ctx || !band) return;
  ctx.setLineDash([4, 4]);
  ctx.lineWidth = 1;
  ctx.strokeStyle = '#fff';
  ctx.beginPath();
  if (band.kind === 'lasso' || band.kind === 'poly') {
    const [first, ...rest] = band.points;
    if (!first) return;
    ctx.moveTo(first[0] + 0.5, first[1] + 0.5);
    for (const [x, y] of rest) ctx.lineTo(x + 0.5, y + 0.5);
    if (band.kind === 'poly' && band.cursor) ctx.lineTo(band.cursor[0] + 0.5, band.cursor[1] + 0.5);
    else ctx.closePath();
  } else if (band.kind === 'ellipse') {
    const { x, y, width, height } = band.box;
    ctx.ellipse(x + width / 2, y + height / 2, Math.max(0.5, width / 2), Math.max(0.5, height / 2), 0, 0, Math.PI * 2);
  } else {
    const { x, y, width, height } = band.box;
    ctx.rect(x + 0.5, y + 0.5, width, height);
  }
  ctx.stroke();
  // A black underlay makes the band readable on light and dark pixels alike.
  ctx.setLineDash([4, 4]);
  ctx.lineDashOffset = 4;
  ctx.strokeStyle = '#000';
  ctx.stroke();
}

/** Local brush-stroke preview (not sent to the engine until pointer-up). */
export function drawStrokePreview(canvas: HTMLCanvasElement, docW: number, docH: number, points: [number, number][], size: number, color: string) {
  const ctx = fit(canvas, docW, docH);
  if (!ctx || points.length === 0) return;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(1, size);
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.75;
  ctx.beginPath();
  const [first, ...rest] = points;
  ctx.moveTo(first[0], first[1]);
  if (rest.length === 0) ctx.lineTo(first[0] + 0.01, first[1]);
  for (const [x, y] of rest) ctx.lineTo(x, y);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

/** Gradient direction guide while dragging. */
export function drawGradientGuide(canvas: HTMLCanvasElement, docW: number, docH: number, from: [number, number], to: [number, number]) {
  const ctx = fit(canvas, docW, docH);
  if (!ctx) return;
  ctx.lineWidth = 1;
  ctx.strokeStyle = '#fff';
  ctx.setLineDash([5, 3]);
  ctx.beginPath();
  ctx.moveTo(from[0] + 0.5, from[1] + 0.5);
  ctx.lineTo(to[0] + 0.5, to[1] + 0.5);
  ctx.stroke();
  ctx.setLineDash([]);
  for (const [x, y] of [from, to]) { ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.stroke(); }
}

/** Clears the overlay (e.g. after committing a stroke). */
export function clearOverlay(canvas: HTMLCanvasElement, docW: number, docH: number) {
  fit(canvas, docW, docH);
}

/** Free-transform frame: quad outline plus 4 corner and 4 edge-midpoint handles. */
export function drawTransformFrame(canvas: HTMLCanvasElement, docW: number, docH: number, quad: [number, number][], handle: number) {
  const ctx = fit(canvas, docW, docH);
  if (!ctx || quad.length !== 4) return;
  ctx.lineWidth = 1;
  ctx.strokeStyle = '#4aa3ff';
  ctx.beginPath();
  ctx.moveTo(quad[0][0], quad[0][1]);
  for (let i = 1; i < 4; i++) ctx.lineTo(quad[i][0], quad[i][1]);
  ctx.closePath();
  ctx.stroke();
  const h = handlePoints(quad);
  h.forEach((p, i) => {
    ctx.fillStyle = i === handle ? '#4aa3ff' : '#fff';
    ctx.strokeStyle = '#000';
    const r = handle === i ? 5 : 4;
    ctx.beginPath();
    ctx.rect(p[0] - r, p[1] - r, r * 2, r * 2);
    ctx.fill();
    ctx.stroke();
  });
}

/** Handle centres: indices 0-3 corners (TL,TR,BR,BL), 4-7 edge midpoints (top,right,bottom,left). */
export function handlePoints(quad: [number, number][]): [number, number][] {
  const mid = (a: number[], b: number[]): [number, number] => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  return [
    [quad[0][0], quad[0][1]], [quad[1][0], quad[1][1]], [quad[2][0], quad[2][1]], [quad[3][0], quad[3][1]],
    mid(quad[0], quad[1]), mid(quad[1], quad[2]), mid(quad[2], quad[3]), mid(quad[3], quad[0]),
  ];
}

// --- Vector overlay (pen / path selection / direct selection / shape handles / brush cursor) ---
// Drawn in document pixels on a canvas that shares the document's CSS transform, so sizes that
// must stay constant on screen are divided by the view scale.

export function overlayCtx(canvas: HTMLCanvasElement, docW: number, docH: number): CanvasRenderingContext2D | null {
  return fit(canvas, docW, docH);
}

function tracePath(ctx: CanvasRenderingContext2D, knots: Knot[], closed: boolean) {
  if (!knots.length) return;
  ctx.moveTo(knots[0].anchor[0], knots[0].anchor[1]);
  const n = knots.length;
  for (let i = 1; i < n + (closed ? 1 : 0); i++) {
    const a = knots[i - 1];
    const b = knots[i % n];
    ctx.bezierCurveTo(a.out[0], a.out[1], b.in[0], b.in[1], b.anchor[0], b.anchor[1]);
  }
  if (closed) ctx.closePath();
}

/** Path outline; with `anchors`, also anchor squares (filled = selected) and direction lines. */
export function drawPath(
  ctx: CanvasRenderingContext2D, path: PathData, scale: number,
  o: { anchors?: boolean; selected?: { sub: number; knot: number }[]; color?: string } = {},
) {
  const px = 1 / scale;
  ctx.save();
  ctx.lineWidth = px;
  ctx.strokeStyle = o.color ?? '#1e90ff';
  ctx.beginPath();
  for (const s of path.subpaths) tracePath(ctx, s.knots, s.closed);
  ctx.stroke();
  if (o.anchors) {
    const r = 3.5 * px;
    path.subpaths.forEach((s, si) => s.knots.forEach((k, ki) => {
      const sel = o.selected?.some((q) => q.sub === si && q.knot === ki);
      for (const h of [k.in, k.out]) {
        if (Math.hypot(h[0] - k.anchor[0], h[1] - k.anchor[1]) < 0.5) continue;
        ctx.beginPath(); ctx.moveTo(k.anchor[0], k.anchor[1]); ctx.lineTo(h[0], h[1]); ctx.stroke();
        ctx.beginPath(); ctx.arc(h[0], h[1], r * 0.8, 0, Math.PI * 2); ctx.fillStyle = '#1e90ff'; ctx.fill();
      }
      ctx.beginPath();
      ctx.rect(k.anchor[0] - r, k.anchor[1] - r, r * 2, r * 2);
      ctx.fillStyle = sel ? '#1e90ff' : '#fff';
      ctx.fill();
      ctx.stroke();
    }));
  }
  ctx.restore();
}

/** In-progress pen subpath plus the rubber band to the pointer. */
export function drawPenPreview(ctx: CanvasRenderingContext2D, knots: Knot[], cursor: [number, number] | undefined, scale: number) {
  if (!knots.length) return;
  drawPath(ctx, { subpaths: [{ closed: false, knots }] }, scale, { anchors: true });
  if (cursor) {
    const last = knots[knots.length - 1];
    ctx.save();
    ctx.lineWidth = 1 / scale;
    ctx.strokeStyle = '#1e90ff';
    ctx.setLineDash([4 / scale, 3 / scale]);
    ctx.beginPath();
    ctx.moveTo(last.anchor[0], last.anchor[1]);
    ctx.bezierCurveTo(last.out[0], last.out[1], cursor[0], cursor[1], cursor[0], cursor[1]);
    ctx.stroke();
    ctx.restore();
  }
}

/** Axis-aligned bounding box with 8 square handles (shape tool / move tool controls). */
export function drawBoxHandles(ctx: CanvasRenderingContext2D, b: [number, number, number, number], handles: [number, number][], scale: number, dashed = false) {
  const px = 1 / scale;
  ctx.save();
  ctx.lineWidth = px;
  ctx.strokeStyle = '#1e90ff';
  if (dashed) ctx.setLineDash([4 * px, 3 * px]);
  ctx.strokeRect(b[0], b[1], b[2], b[3]);
  ctx.setLineDash([]);
  const r = 4 * px;
  for (const [x, y] of handles) {
    ctx.beginPath();
    ctx.rect(x - r, y - r, r * 2, r * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

/** Round brush-size cursor (outline readable on light and dark pixels). */
export function drawBrushCursor(ctx: CanvasRenderingContext2D, at: [number, number], size: number, scale: number) {
  const r = Math.max(0.5, size / 2);
  ctx.save();
  ctx.lineWidth = 1 / scale;
  ctx.strokeStyle = '#000';
  ctx.beginPath(); ctx.arc(at[0], at[1], r, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = '#fff';
  ctx.beginPath(); ctx.arc(at[0], at[1], r + 1 / scale, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
}

/** Straight line band (line shape tool). */
export function drawLineBand(ctx: CanvasRenderingContext2D, from: [number, number], to: [number, number], scale: number) {
  ctx.save();
  ctx.lineWidth = 1 / scale;
  ctx.strokeStyle = '#1e90ff';
  ctx.beginPath(); ctx.moveTo(from[0], from[1]); ctx.lineTo(to[0], to[1]); ctx.stroke();
  ctx.restore();
}

/** Selection outline prepared for screen-space drawing (segments in document pixels). */
export interface AntsPath { segs: Float32Array }

export function antsPath(sel?: SelectionMask): AntsPath | undefined {
  if (!sel) return undefined;
  const step = outlineStep(sel.width, sel.height);
  const { cov, w, h } = downsample(sel.coverage, sel.width, sel.height, step);
  const segs = outlineSegments(cov, w, h);
  const out = new Float32Array(segs.length * 4);
  segs.forEach((s, i) => {
    out[i * 4] = sel.x + s[0] * step; out[i * 4 + 1] = sel.y + s[1] * step;
    out[i * 4 + 2] = sel.x + s[2] * step; out[i * 4 + 3] = sel.y + s[3] * step;
  });
  return { segs: out };
}

/** Marching ants in screen space: 1 px black/white dashes at any zoom, `offset` animates them. */
export function drawAntsScreen(canvas: HTMLCanvasElement, w: number, h: number, path: AntsPath | undefined, view: { scale: number; tx: number; ty: number }, offset: number) {
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, w, h);
  if (!path || !path.segs.length) return;
  const { segs } = path;
  const X = (x: number) => Math.round(view.tx + x * view.scale) + 0.5;
  const Y = (y: number) => Math.round(view.ty + y * view.scale) + 0.5;
  ctx.beginPath();
  for (let i = 0; i < segs.length; i += 4) { ctx.moveTo(X(segs[i]), Y(segs[i + 1])); ctx.lineTo(X(segs[i + 2]), Y(segs[i + 3])); }
  ctx.lineWidth = 1;
  ctx.setLineDash([]);
  ctx.strokeStyle = '#fff';
  ctx.stroke();
  ctx.setLineDash([4, 4]);
  ctx.lineDashOffset = -offset;
  ctx.strokeStyle = '#000';
  ctx.stroke();
}
