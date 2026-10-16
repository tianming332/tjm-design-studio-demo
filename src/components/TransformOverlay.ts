// Free Transform v2: hit-testing, drag semantics, frame/warp drawing and the live pixel preview.
// Geometry lives in engine/transform.ts (pure, unit-tested); this file maps gestures onto it.
import {
  distToQuad, moveCorner, moveEdge, patchPoint, perspectiveQuad, pointInQuad, quadPoint, rotateQuad,
  scaleQuad, skewQuad, sweep, toUnit, translateQuad, unitToQuad, HANDLE_UV, type Quad,
} from '../engine/transform';
import type { TransformSession } from '../state/store';

type V = [number, number];
export type TfHit =
  | { kind: 'handle'; i: number }
  | { kind: 'ref' }
  | { kind: 'inside' }
  | { kind: 'rotate' }
  | { kind: 'warp'; i: number };

export interface TfMods { shift: boolean; alt: boolean; mod: boolean }

export const handlesOf = (q: Quad): V[] => HANDLE_UV.map(([u, v]) => quadPoint(q, u, v));
export const refPointOf = (t: TransformSession): V => quadPoint(t.quad, t.ref[0], t.ref[1]);

/** What the pointer is over. Priority: warp points / handles, reference point, inside, rotate ring. */
export function tfHit(t: TransformSession, p: V, tol: number): TfHit | null {
  const near = (a: V) => Math.abs(a[0] - p[0]) <= tol && Math.abs(a[1] - p[1]) <= tol;
  if (t.mode === 'warp' && t.warp) {
    const i = t.warp.findIndex(near);
    if (i >= 0) return { kind: 'warp', i };
    return pointInQuad(t.quad, p) ? { kind: 'inside' } : null;
  }
  const h = handlesOf(t.quad).findIndex(near);
  if (h >= 0) return { kind: 'handle', i: h };
  if (near(refPointOf(t))) return { kind: 'ref' };
  if (pointInQuad(t.quad, p)) return { kind: 'inside' };
  if (distToQuad(t.quad, p) <= tol * 5) return { kind: 'rotate' };
  return null;
}

/** CSS cursor for a hover hit (frame-axis aware enough for an axis-aligned frame). */
export function tfCursor(h: TfHit | null): string {
  if (!h) return 'default';
  switch (h.kind) {
    case 'handle': return ['nwse-resize', 'nesw-resize', 'nwse-resize', 'nesw-resize', 'ns-resize', 'ew-resize', 'ns-resize', 'ew-resize'][h.i];
    case 'warp': return 'pointer';
    case 'ref': return 'crosshair';
    case 'inside': return 'move';
    case 'rotate': return 'alias';
  }
}

/** New session for a drag from `start` to `now` that grabbed `hit` on session `t0`. */
export function tfDrag(t0: TransformSession, hit: TfHit, start: V, now: V, m: TfMods): TransformSession {
  const q0 = t0.quad;
  const delta: V = [now[0] - start[0], now[1] - start[1]];
  switch (hit.kind) {
    case 'inside':
      if (t0.mode === 'warp' && t0.warp) return { ...t0, warp: t0.warp.map((p) => [p[0] + delta[0], p[1] + delta[1]] as V), quad: translateQuad(q0, delta[0], delta[1]) };
      return { ...t0, quad: translateQuad(q0, delta[0], delta[1]) };
    case 'ref': return { ...t0, ref: toUnit(q0, now) };
    case 'warp': {
      const warp = t0.warp!.map((p, i) => (i === hit.i ? [p[0] + delta[0], p[1] + delta[1]] : p) as V);
      return { ...t0, warp };
    }
    case 'rotate': {
      let deg = sweep(refPointOf(t0), start, now);
      if (m.shift) deg = Math.round(deg / 15) * 15;
      return { ...t0, quad: rotateQuad(q0, refPointOf(t0), deg) };
    }
    case 'handle': {
      const h = hit.i;
      let mode = t0.mode;
      if (mode === 'free' && m.mod) mode = m.shift && m.alt && h < 4 ? 'perspective' : m.shift ? 'skew' : 'distort';
      switch (mode) {
        case 'rotate': {
          let deg = sweep(refPointOf(t0), start, now);
          if (m.shift) deg = Math.round(deg / 15) * 15;
          return { ...t0, quad: rotateQuad(q0, refPointOf(t0), deg) };
        }
        case 'skew': return { ...t0, quad: skewQuad(q0, h, delta, m.alt) };
        case 'distort':
          return { ...t0, quad: h < 4 ? moveCorner(q0, h, delta[0], delta[1]) : moveEdge(q0, h - 4, delta[0], delta[1]) };
        case 'perspective': return { ...t0, quad: perspectiveQuad(q0, h, delta) };
        default: {
          // free / scale: drag the handle to the pointer (keeping the grab offset).
          const hp = handlesOf(q0)[h];
          const target: V = [hp[0] + delta[0], hp[1] + delta[1]];
          // Current Photoshop: corners scale proportionally by default, Shift frees them.
          const keepRatio = h < 4 ? !m.shift : m.shift;
          return { ...t0, quad: scaleQuad(q0, h, target, { keepRatio, anchor: m.alt ? t0.ref : undefined }) };
        }
      }
    }
  }
}

/** Frame, 8 handles and the reference point; or the warp mesh with its 16 control points. */
export function drawTfUI(ctx: CanvasRenderingContext2D, t: TransformSession, scale: number) {
  const px = 1 / scale;
  ctx.save();
  ctx.lineWidth = px;
  ctx.strokeStyle = '#4aa3ff';
  if (t.mode === 'warp' && t.warp) {
    const w = t.warp;
    ctx.beginPath();
    for (let k = 0; k <= 3; k++) {
      for (let s = 0; s <= 24; s++) { const p = patchPoint(w, s / 24, k / 3); if (s) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); }
      for (let s = 0; s <= 24; s++) { const p = patchPoint(w, k / 3, s / 24); if (s) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); }
    }
    ctx.stroke();
    const r = 3.5 * px;
    for (const p of w) { ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill(); ctx.stroke(); }
    ctx.restore();
    return;
  }
  const q = t.quad;
  ctx.beginPath();
  ctx.moveTo(q[0][0], q[0][1]);
  for (let i = 1; i < 4; i++) ctx.lineTo(q[i][0], q[i][1]);
  ctx.closePath();
  ctx.stroke();
  const r = 4 * px;
  for (const [x, y] of handlesOf(q)) {
    ctx.beginPath(); ctx.rect(x - r, y - r, r * 2, r * 2);
    ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = '#000'; ctx.stroke();
  }
  const [rx, ry] = refPointOf(t);
  ctx.strokeStyle = '#000';
  ctx.beginPath(); ctx.arc(rx, ry, 4 * px, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(rx - 7 * px, ry); ctx.lineTo(rx + 7 * px, ry); ctx.moveTo(rx, ry - 7 * px); ctx.lineTo(rx, ry + 7 * px); ctx.stroke();
  ctx.restore();
}

/** Preview source: the layer alone and the document without it, over `area` (canvas-clipped). */
export interface TfPreviewSrc { layer: HTMLCanvasElement; under: HTMLCanvasElement; area: [number, number, number, number] }

/** Draws `img` (covering doc `area`) mapped through `map` (unit (u,v) of `rect` → doc point). */
function drawMapped(ctx: CanvasRenderingContext2D, img: HTMLCanvasElement, area: [number, number, number, number],
  rect: [number, number, number, number], map: (u: number, v: number) => V, n = 12) {
  const [x0, y0, x1, y1] = rect;
  const src = (u: number, v: number): V => [x0 + (x1 - x0) * u - area[0], y0 + (y1 - y0) * v - area[1]];
  const tri = (s: V[], d: V[]) => {
    // Affine from source triangle to destination triangle; clip slightly enlarged to hide seams.
    const [s0, s1, s2] = s, [d0, d1, d2] = d;
    const den = (s1[0] - s0[0]) * (s2[1] - s0[1]) - (s2[0] - s0[0]) * (s1[1] - s0[1]);
    if (Math.abs(den) < 1e-9) return;
    const a = ((d1[0] - d0[0]) * (s2[1] - s0[1]) - (d2[0] - d0[0]) * (s1[1] - s0[1])) / den;
    const b = ((d1[1] - d0[1]) * (s2[1] - s0[1]) - (d2[1] - d0[1]) * (s1[1] - s0[1])) / den;
    const c = ((d2[0] - d0[0]) * (s1[0] - s0[0]) - (d1[0] - d0[0]) * (s2[0] - s0[0])) / den;
    const dd = ((d2[1] - d0[1]) * (s1[0] - s0[0]) - (d1[1] - d0[1]) * (s2[0] - s0[0])) / den;
    const e = d0[0] - a * s0[0] - c * s0[1];
    const f = d0[1] - b * s0[0] - dd * s0[1];
    const cx = (d0[0] + d1[0] + d2[0]) / 3, cy = (d0[1] + d1[1] + d2[1]) / 3;
    const grow = (p: V): V => { const vx = p[0] - cx, vy = p[1] - cy, l = Math.hypot(vx, vy) || 1; return [p[0] + (vx / l) * 0.6, p[1] + (vy / l) * 0.6]; };
    const g = d.map(grow);
    ctx.save();
    ctx.beginPath(); ctx.moveTo(g[0][0], g[0][1]); ctx.lineTo(g[1][0], g[1][1]); ctx.lineTo(g[2][0], g[2][1]); ctx.closePath();
    ctx.clip();
    ctx.setTransform(ctx.getTransform().multiply(new DOMMatrix([a, b, c, dd, e, f])));
    ctx.drawImage(img, 0, 0);
    ctx.restore();
  };
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const u0 = i / n, u1 = (i + 1) / n, v0 = j / n, v1 = (j + 1) / n;
      const sA = src(u0, v0), sB = src(u1, v0), sC = src(u1, v1), sD = src(u0, v1);
      const dA = map(u0, v0), dB = map(u1, v0), dC = map(u1, v1), dD = map(u0, v1);
      tri([sA, sB, sC], [dA, dB, dC]);
      tri([sA, sC, sD], [dA, dC, dD]);
    }
  }
}

/** Live preview: cover the layer's original area with what lies beneath it, then draw the layer
 *  through the current frame (perspective-correct) or warp mesh. */
export function drawTfPreview(ctx: CanvasRenderingContext2D, t: TransformSession, s: TfPreviewSrc) {
  const [ax, ay] = s.area;
  ctx.drawImage(s.under, ax, ay);
  const map = t.mode === 'warp' && t.warp ? (u: number, v: number) => patchPoint(t.warp!, u, v) : unitToQuad(t.quad);
  drawMapped(ctx, s.layer, s.area, t.rect, map, t.mode === 'warp' ? 16 : isPerspective(t.quad) ? 12 : 1);
}

const isPerspective = (q: Quad) => Math.hypot(q[0][0] + q[2][0] - q[1][0] - q[3][0], q[0][1] + q[2][1] - q[1][1] - q[3][1]) > 0.5;
