// Pure geometry/raster helpers for the selection tools. No DOM, no engine — all unit-tested.
import type { SelectMode } from './protocol';

/** PS modifier convention: Shift adds, Alt subtracts, both intersect. */
export function modeFrom(shift: boolean, alt: boolean): SelectMode {
  if (shift && alt) return 'intersect';
  if (shift) return 'add';
  if (alt) return 'subtract';
  return 'replace';
}

export interface Pt { x: number; y: number }
export interface Box { x: number; y: number; width: number; height: number }

/** Screen point → document pixel, undoing the canvas pan/zoom transform. */
export function screenToDoc(clientX: number, clientY: number, wrap: { left: number; top: number }, view: { scale: number; tx: number; ty: number }): Pt {
  return {
    x: Math.round((clientX - wrap.left - view.tx) / view.scale),
    y: Math.round((clientY - wrap.top - view.ty) / view.scale),
  };
}

/** Normalises a drag (either direction) into a positive-size box. */
export function dragBox(a: Pt, b: Pt): Box {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) };
}

/** A drag this small is a click, not a selection (avoids 1px marquees). */
export function isTinyDrag(a: Pt, b: Pt, min = 2): boolean {
  return Math.abs(b.x - a.x) < min || Math.abs(b.y - a.y) < min;
}

/** Marquee / shape style (PS options bar): free, fixed aspect ratio, or fixed size. */
export type BoxStyle = { kind: 'normal' } | { kind: 'ratio'; w: number; h: number } | { kind: 'size'; w: number; h: number };

/**
 * Drag box with Photoshop modifiers: `square` (Shift during the drag) forces 1:1, `center`
 * (Alt during the drag) grows from the start point; a fixed ratio keeps w:h along the larger
 * drag axis, a fixed size ignores the drag extent (only its direction).
 */
export function constrainBox(a: Pt, b: Pt, o: { style?: BoxStyle; square?: boolean; center?: boolean } = {}): Box {
  let dx = b.x - a.x;
  let dy = b.y - a.y;
  const sx = dx < 0 ? -1 : 1;
  const sy = dy < 0 ? -1 : 1;
  const style = o.style ?? { kind: 'normal' };
  if (style.kind === 'size') {
    dx = sx * Math.max(1, style.w);
    dy = sy * Math.max(1, style.h);
  } else {
    const ratio = style.kind === 'ratio' && style.w > 0 && style.h > 0 ? style.w / style.h : o.square ? 1 : 0;
    if (ratio > 0) {
      const ax = Math.abs(dx), ay = Math.abs(dy);
      if (ax / ratio >= ay) dy = sy * Math.round(ax / ratio);
      else dx = sx * Math.round(ay * ratio);
    }
  }
  if (o.center) {
    const w = Math.abs(dx), h = Math.abs(dy);
    if (style.kind === 'size') return { x: Math.round(a.x - w / 2), y: Math.round(a.y - h / 2), width: w, height: h };
    return { x: a.x - w, y: a.y - h, width: 2 * w, height: 2 * h };
  }
  return dragBox(a, { x: a.x + dx, y: a.y + dy });
}

/** Single-row / single-column marquee: a 1 px strip across the whole canvas through `p`. */
export function stripBox(p: Pt, kind: 'row' | 'col', docW: number, docH: number): Box {
  return kind === 'row'
    ? { x: 0, y: Math.min(docH - 1, Math.max(0, p.y)), width: docW, height: 1 }
    : { x: Math.min(docW - 1, Math.max(0, p.x)), y: 0, width: 1, height: docH };
}

/** Whether document pixel `p` is inside a selection coverage mask (coverage ≥ 128). */
export function pointInMask(p: Pt, m?: { x: number; y: number; width: number; height: number; coverage: Uint8Array }): boolean {
  if (!m) return false;
  const lx = Math.floor(p.x - m.x), ly = Math.floor(p.y - m.y);
  if (lx < 0 || ly < 0 || lx >= m.width || ly >= m.height) return false;
  return m.coverage[ly * m.width + lx] >= 128;
}

/**
 * Resizes an axis-aligned box [x, y, w, h] by dragging one of its 8 handles
 * (0-3 corners TL,TR,BR,BL; 4-7 edges top,right,bottom,left). `keepRatio` (Shift) preserves the
 * aspect on corner drags. Dragging past the opposite side flips; the result is normalised.
 */
export function resizeBox(b: [number, number, number, number], handle: number, dx: number, dy: number, keepRatio = false): [number, number, number, number] {
  let [x0, y0] = [b[0], b[1]];
  let [x1, y1] = [b[0] + b[2], b[1] + b[3]];
  const left = handle === 0 || handle === 3 || handle === 7;
  const right = handle === 1 || handle === 2 || handle === 5;
  const top = handle === 0 || handle === 1 || handle === 4;
  const bottom = handle === 2 || handle === 3 || handle === 6;
  if (keepRatio && handle < 4 && b[2] > 0 && b[3] > 0) {
    const r = b[2] / b[3];
    const sxSign = left ? -1 : 1, sySign = top ? -1 : 1;
    const grow = Math.max(sxSign * dx, (sySign * dy) * r);
    dx = sxSign * grow;
    dy = sySign * (grow / r);
  }
  if (left) x0 += dx;
  if (right) x1 += dx;
  if (top) y0 += dy;
  if (bottom) y1 += dy;
  const nx = Math.min(x0, x1), ny = Math.min(y0, y1);
  return [Math.round(nx), Math.round(ny), Math.max(1, Math.round(Math.abs(x1 - x0))), Math.max(1, Math.round(Math.abs(y1 - y0)))];
}

/** Handle centres of an axis-aligned box, same index order as {@link resizeBox}. */
export function boxHandles(b: [number, number, number, number]): [number, number][] {
  const [x, y, w, h] = b;
  return [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x + w / 2, y], [x + w, y + h / 2], [x + w / 2, y + h], [x, y + h / 2]];
}

/**
 * Marching-ants outline: 1 where the pixel is inside (coverage ≥ 128) and at least one
 * 4-neighbour is outside. Pixels beyond the mask edge count as outside, so the border of a
 * full-canvas selection is drawn too.
 */
export function outlinePixels(cov: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && cov[y * w + x] >= 128;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!inside(x, y)) continue;
      if (!inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1)) out[y * w + x] = 1;
    }
  }
  return out;
}

/** Step for downsampling a huge mask before outlining (display only; the engine keeps the real one). */
export function outlineStep(w: number, h: number, maxSide = 4096): number {
  return Math.max(1, Math.ceil(Math.max(w, h) / maxSide));
}

/** Subsamples coverage by `step`, returning the smaller grid. */
export function downsample(cov: Uint8Array, w: number, h: number, step: number): { cov: Uint8Array; w: number; h: number } {
  if (step <= 1) return { cov, w, h };
  const dw = Math.ceil(w / step);
  const dh = Math.ceil(h / step);
  const out = new Uint8Array(dw * dh);
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) out[y * dw + x] = cov[Math.min(h - 1, y * step) * w + Math.min(w - 1, x * step)];
  }
  return { cov: out, w: dw, h: dh };
}

// --- Crop tool geometry ---
export type Box4 = [number, number, number, number];

/** Rotates `p` about `c` by `deg` degrees (screen coordinates: +deg is clockwise). */
export function rotateAbout(p: [number, number], c: [number, number], deg: number): [number, number] {
  const r = (deg * Math.PI) / 180, cos = Math.cos(r), sin = Math.sin(r);
  const dx = p[0] - c[0], dy = p[1] - c[1];
  return [c[0] + dx * cos - dy * sin, c[1] + dx * sin + dy * cos];
}

export const boxCenter = (b: Box4): [number, number] => [b[0] + b[2] / 2, b[1] + b[3] / 2];

/** Crop ratio option → w/h (0 = unconstrained). */
export function cropRatio(o: { ratio: string; w: number; h: number }): number {
  switch (o.ratio) {
    case '1:1': return 1;
    case '4:3': return 4 / 3;
    case '16:9': return 16 / 9;
    case 'custom': return o.w > 0 && o.h > 0 ? o.w / o.h : 0;
    default: return 0;
  }
}

/** Forces a box to aspect `r` (w/h) after a handle drag, keeping the edge(s) opposite the handle. */
export function fitRatio(b: Box4, r: number, handle: number): Box4 {
  if (!(r > 0)) return b;
  let [x, y, w, h] = b;
  const vertical = handle === 4 || handle === 6; // top/bottom edge drives the height
  if (vertical) w = Math.max(1, Math.round(h * r));
  else h = Math.max(1, Math.round(w / r));
  if (handle === 0 || handle === 1 || handle === 4) y = b[1] + b[3] - h; // top handles keep the bottom
  if (handle === 0 || handle === 3 || handle === 7) x = b[0] + b[2] - w; // left handles keep the right
  if (handle === 4 || handle === 6) x = Math.round(b[0] + (b[2] - w) / 2);
  return [x, y, w, h];
}

/** Angle (degrees) swept around `c` from `a` to `b`, normalised to (-180, 180]. */
export function sweepAngle(c: [number, number], a: [number, number], b: [number, number]): number {
  const d = (Math.atan2(b[1] - c[1], b[0] - c[0]) - Math.atan2(a[1] - c[1], a[0] - c[0])) * (180 / Math.PI);
  return ((d + 540) % 360) - 180 || 0;
}

/**
 * Selection outline as pixel-boundary segments (mask-local units), merged into straight runs:
 * a horizontal edge wherever a pixel and the one above differ, a vertical one wherever a pixel
 * and its left neighbour differ. Drawn in screen space, this gives crisp 1 px marching ants at
 * any zoom (A29).
 */
export function outlineSegments(cov: Uint8Array, w: number, h: number): [number, number, number, number][] {
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && cov[y * w + x] >= 128;
  const out: [number, number, number, number][] = [];
  for (let y = 0; y <= h; y++) {
    let start = -1;
    for (let x = 0; x <= w; x++) {
      const edge = x < w && inside(x, y - 1) !== inside(x, y);
      if (edge && start < 0) start = x;
      else if (!edge && start >= 0) { out.push([start, y, x, y]); start = -1; }
    }
  }
  for (let x = 0; x <= w; x++) {
    let start = -1;
    for (let y = 0; y <= h; y++) {
      const edge = y < h && inside(x - 1, y) !== inside(x, y);
      if (edge && start < 0) start = y;
      else if (!edge && start >= 0) { out.push([x, start, x, y]); start = -1; }
    }
  }
  return out;
}
