// Pure transform geometry for the Free Transform tool. No DOM/engine — unit-tested.
// The engine takes a source `rect` [x0,y0,x1,y1] and destination `quad` (4 corners, clockwise
// from top-left), or an affine `matrix` [a,b,c,d,e,f].
export type Corner = [number, number];
export type Quad = [Corner, Corner, Corner, Corner]; // TL, TR, BR, BL
export type Rect4 = [number, number, number, number]; // x0, y0, x1, y1
export type Matrix = [number, number, number, number, number, number];

/** The four corners of a rect, clockwise from top-left. */
export function rectCorners(r: Rect4): Quad {
  const [x0, y0, x1, y1] = r;
  return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
}

/** Moves one corner (free distort). */
export function moveCorner(q: Quad, i: number, dx: number, dy: number): Quad {
  const out = q.map((c) => [...c] as Corner) as Quad;
  out[i] = [q[i][0] + dx, q[i][1] + dy];
  return out;
}

/** Moves both corners of an edge (single-axis scale). edge: 0=top,1=right,2=bottom,3=left. */
export function moveEdge(q: Quad, edge: number, dx: number, dy: number): Quad {
  const pairs = [[0, 1], [1, 2], [2, 3], [3, 0]][edge];
  const out = q.map((c) => [...c] as Corner) as Quad;
  for (const i of pairs) out[i] = [q[i][0] + dx, q[i][1] + dy];
  return out;
}

/** Shift+corner: scale from the opposite corner so the dragged corner keeps the frame's aspect. */
export function proportionalCorner(q: Quad, i: number, dx: number, dy: number): Quad {
  const opp = q[(i + 2) % 4];
  const cur = q[i];
  const w = cur[0] - opp[0];
  const h = cur[1] - opp[1];
  if (w === 0 || h === 0) return moveCorner(q, i, dx, dy);
  // Uniform scale factor from the larger of the two axis drags, preserving aspect.
  const sx = (w + dx) / w;
  const sy = (h + dy) / h;
  const s = Math.abs(sx) > Math.abs(sy) ? sx : sy;
  const out = q.map((c) => [...c] as Corner) as Quad;
  out[i] = [opp[0] + w * s, opp[1] + h * s];
  // Keep the two adjacent corners aligned to the new box.
  const nx = out[i][0];
  const ny = out[i][1];
  out[(i + 1) % 4] = i % 2 === 0 ? [nx, out[(i + 1) % 4][1]] : [out[(i + 1) % 4][0], ny];
  out[(i + 3) % 4] = i % 2 === 0 ? [out[(i + 3) % 4][0], ny] : [nx, out[(i + 3) % 4][1]];
  return out;
}

/** Affine matrix for rotate (deg) + uniform scale about centre (cx,cy): [a,b,c,d,e,f]. */
export function rotateScaleMatrix(cx: number, cy: number, deg: number, scale: number): Matrix {
  const r = (deg * Math.PI) / 180;
  const a = Math.cos(r) * scale;
  const b = Math.sin(r) * scale;
  const c = -Math.sin(r) * scale;
  const d = Math.cos(r) * scale;
  const e = cx - a * cx - c * cy;
  const f = cy - b * cx - d * cy;
  return [a, b, c, d, e, f];
}

/** Axis-aligned bounds of a quad: [x0,y0,x1,y1]. */
export function quadBounds(q: Quad): Rect4 {
  const xs = q.map((c) => c[0]);
  const ys = q.map((c) => c[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

// --- Free Transform v2 (A27): frame-local scale, rotate, skew, perspective, warp mesh ---
type V = [number, number];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1]];
const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1]];
const mul = (a: V, k: number): V => [a[0] * k, a[1] * k];
const cloneQ = (q: Quad): Quad => q.map((c) => [c[0], c[1]] as Corner) as Quad;

/** Unit coordinates of handle i in the frame (0-3 corners TL,TR,BR,BL; 4-7 edges T,R,B,L). */
export const HANDLE_UV: V[] = [[0, 0], [1, 0], [1, 1], [0, 1], [0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]];

/** Bilinear point of a quad at unit (u, v) (exact for parallelograms; used for handles/ref). */
export function quadPoint(q: Quad, u: number, v: number): V {
  const top = add(q[0], mul(sub(q[1], q[0]), u));
  const bot = add(q[3], mul(sub(q[2], q[3]), u));
  return add(top, mul(sub(bot, top), v));
}

/** Frame axes of an (assumed affine) quad: origin TL, u = TL→TR, v = TL→BL. */
function axes(q: Quad) { return { o: q[0], u: sub(q[1], q[0]), v: sub(q[3], q[0]) }; }

/** Document point → frame unit coordinates (inverse of the affine frame). */
export function toUnit(q: Quad, p: V): V {
  const { o, u, v } = axes(q);
  const det = u[0] * v[1] - u[1] * v[0];
  if (Math.abs(det) < 1e-9) return [0, 0];
  const d = sub(p, o);
  return [(d[0] * v[1] - d[1] * v[0]) / det, (u[0] * d[1] - u[1] * d[0]) / det];
}

/**
 * Scale by dragging handle `h` to document point `p` (frame-local, so it works on a rotated
 * frame). Corners scale both axes, edges one. `keepRatio` = Shift on a corner; `anchor` = unit
 * point that stays fixed (the opposite handle, or the reference point with Alt).
 */
export function scaleQuad(q0: Quad, h: number, p: V, o: { keepRatio?: boolean; anchor?: V } = {}): Quad {
  const hu = HANDLE_UV[h];
  const a = o.anchor ?? ([1 - hu[0], 1 - hu[1]] as V);
  const pu = toUnit(q0, p);
  const affectsU = hu[0] !== 0.5, affectsV = hu[1] !== 0.5;
  let su = affectsU && hu[0] !== a[0] ? (pu[0] - a[0]) / (hu[0] - a[0]) : 1;
  let sv = affectsV && hu[1] !== a[1] ? (pu[1] - a[1]) / (hu[1] - a[1]) : 1;
  if (o.keepRatio && affectsU && affectsV) { const s = Math.abs(su) > Math.abs(sv) ? su : sv; su = s; sv = s; }
  const { o: org, u, v } = axes(q0);
  const map = (c: V): Corner => {
    const uu = a[0] + (c[0] - a[0]) * su, vv = a[1] + (c[1] - a[1]) * sv;
    const r = add(org, add(mul(u, uu), mul(v, vv)));
    return [r[0], r[1]];
  };
  return [map([0, 0]), map([1, 0]), map([1, 1]), map([0, 1])];
}

export function rotateQuad(q: Quad, c: V, deg: number): Quad {
  const r = (deg * Math.PI) / 180, cos = Math.cos(r), sin = Math.sin(r);
  return q.map((p) => { const d = sub(p, c); return [c[0] + d[0] * cos - d[1] * sin, c[1] + d[0] * sin + d[1] * cos] as Corner; }) as Quad;
}

export function translateQuad(q: Quad, dx: number, dy: number): Quad {
  return q.map((p) => [p[0] + dx, p[1] + dy] as Corner) as Quad;
}

/** Signed angle (deg) swept around c from a to b. */
export function sweep(c: V, a: V, b: V): number {
  const d = (Math.atan2(b[1] - c[1], b[0] - c[0]) - Math.atan2(a[1] - c[1], a[0] - c[0])) * (180 / Math.PI);
  return ((d + 540) % 360) - 180;
}

/** Skew: an edge handle slides its edge along the edge direction; `symmetric` (Alt) moves the
 *  opposite edge the other way. Corner handles slide their corner along the nearer edge. */
export function skewQuad(q0: Quad, h: number, delta: V, symmetric = false): Quad {
  const out = cloneQ(q0);
  const edges = [[0, 1], [1, 2], [2, 3], [3, 0]];
  let edge: number;
  if (h >= 4) edge = h - 4;
  else {
    // Corner: pick the adjacent edge most aligned with the drag.
    const e1 = edges.findIndex((e) => e[0] === h), e2 = edges.findIndex((e) => e[1] === h);
    const dir = (e: number) => { const [i, j] = edges[e]; const d = sub(q0[j], q0[i]); const n = Math.hypot(d[0], d[1]) || 1; return Math.abs((d[0] * delta[0] + d[1] * delta[1]) / n); };
    edge = dir(e1) >= dir(e2) ? e1 : e2;
  }
  const [i, j] = edges[edge];
  const d = sub(q0[j], q0[i]);
  const n = Math.hypot(d[0], d[1]) || 1;
  const k = (d[0] * delta[0] + d[1] * delta[1]) / n;
  const shift = mul(d, k / n);
  const move = h >= 4 ? [i, j] : [h];
  for (const m of move) out[m] = [q0[m][0] + shift[0], q0[m][1] + shift[1]];
  if (symmetric && h >= 4) {
    const [oi, oj] = edges[(edge + 2) % 4];
    for (const m of [oi, oj]) out[m] = [q0[m][0] - shift[0], q0[m][1] - shift[1]];
  }
  return out;
}

/** Perspective: dragging a corner moves its partner on the same edge symmetrically, keeping the
 *  edge centred (PS Perspective). The edge is the one the drag runs along. */
export function perspectiveQuad(q0: Quad, h: number, delta: V): Quad {
  if (h > 3) return moveEdge(q0, h - 4, delta[0], delta[1]);
  const horizPartner = [1, 0, 3, 2][h], vertPartner = [3, 2, 1, 0][h];
  const along = (partner: number) => { const d = sub(q0[partner], q0[h]); const n = Math.hypot(d[0], d[1]) || 1; return { d, n, k: (d[0] * delta[0] + d[1] * delta[1]) / n }; };
  const H = along(horizPartner), Vv = along(vertPartner);
  const use = Math.abs(H.k) >= Math.abs(Vv.k) ? { p: horizPartner, ...H } : { p: vertPartner, ...Vv };
  const out = cloneQ(q0);
  const shift = mul(use.d, use.k / use.n);
  out[h] = [q0[h][0] + shift[0], q0[h][1] + shift[1]];
  out[use.p] = [q0[use.p][0] - shift[0], q0[use.p][1] - shift[1]];
  return out;
}

/** In-session flips / quarter turns (the frame's corners are re-assigned or rotated). */
export function flipQuad(q: Quad, axis: 'h' | 'v'): Quad {
  return (axis === 'h' ? [q[1], q[0], q[3], q[2]] : [q[3], q[2], q[1], q[0]]).map((c) => [c[0], c[1]]) as Quad;
}

export function pointInQuad(q: Quad, p: V): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4];
    const cr = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    if (cr !== 0) { const s = Math.sign(cr); if (sign && s !== sign) return false; sign = s; }
  }
  return true;
}

/** Distance from p to the quad outline. */
export function distToQuad(q: Quad, p: V): number {
  let best = Infinity;
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4];
    const d = sub(b, a), l2 = d[0] * d[0] + d[1] * d[1] || 1;
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1]) / l2));
    best = Math.min(best, Math.hypot(p[0] - (a[0] + d[0] * t), p[1] - (a[1] + d[1] * t)));
  }
  return best;
}

/** Is the quad still an affine image of the rect (a parallelogram)? Numeric fields need that. */
export function isAffine(q: Quad, eps = 0.5): boolean {
  return Math.hypot(q[0][0] + q[2][0] - q[1][0] - q[3][0], q[0][1] + q[2][1] - q[1][1] - q[3][1]) < eps;
}

export interface AffineParams { x: number; y: number; sx: number; sy: number; rot: number; skew: number }

/** Decomposes the frame into ref position (x, y of unit point `ref`), scale % of the source
 *  rect, rotation and horizontal skew (degrees): A = R(rot)·K(skew)·S(sx, sy). */
export function decompose(rect: Rect4, q: Quad, ref: V): AffineParams {
  const w = rect[2] - rect[0] || 1, h = rect[3] - rect[1] || 1;
  const { u, v } = axes(q);
  const a = u[0] / w, b = u[1] / w, c = v[0] / h, d = v[1] / h;
  const sx = Math.hypot(a, b);
  const rot = Math.atan2(b, a);
  const cos = Math.cos(rot), sin = Math.sin(rot);
  const m = cos * c + sin * d;
  const sy = -sin * c + cos * d;
  const p = quadPoint(q, ref[0], ref[1]);
  return { x: p[0], y: p[1], sx: sx * 100, sy: sy * 100, rot: (rot * 180) / Math.PI, skew: sy ? (Math.atan(m / sy) * 180) / Math.PI : 0 };
}

/** Inverse of {@link decompose}. */
export function compose(rect: Rect4, p: AffineParams, ref: V): Quad {
  const w = rect[2] - rect[0], h = rect[3] - rect[1];
  const r = (p.rot * Math.PI) / 180, cos = Math.cos(r), sin = Math.sin(r);
  const sx = p.sx / 100, sy = p.sy / 100, k = Math.tan((p.skew * Math.PI) / 180);
  // A = R · [[sx, k*sy],[0, sy]]
  const A = [cos * sx, sin * sx, cos * k * sy - sin * sy, sin * k * sy + cos * sy];
  const ap = (x: number, y: number): V => [A[0] * x + A[2] * y, A[1] * x + A[3] * y];
  const refSrc: V = [ref[0] * w, ref[1] * h];
  const off = sub([p.x, p.y], ap(refSrc[0], refSrc[1]));
  return ([[0, 0], [w, 0], [w, h], [0, h]] as V[]).map((c) => { const t = add(ap(c[0], c[1]), off); return [t[0], t[1]] as Corner; }) as Quad;
}

/** Homography mapping the unit square onto the quad (for perspective preview / warp grid). */
export function unitToQuad(q: Quad): (u: number, v: number) => V {
  const [p0, p1, p2, p3] = q;
  const dx1 = p1[0] - p2[0], dx2 = p3[0] - p2[0], dx3 = p0[0] - p1[0] + p2[0] - p3[0];
  const dy1 = p1[1] - p2[1], dy2 = p3[1] - p2[1], dy3 = p0[1] - p1[1] + p2[1] - p3[1];
  let g = 0, hh = 0;
  const den = dx1 * dy2 - dx2 * dy1;
  if (Math.abs(dx3) > 1e-9 || Math.abs(dy3) > 1e-9) {
    g = den ? (dx3 * dy2 - dx2 * dy3) / den : 0;
    hh = den ? (dx1 * dy3 - dx3 * dy1) / den : 0;
  }
  const a = p1[0] - p0[0] + g * p1[0], b = p3[0] - p0[0] + hh * p3[0], c = p0[0];
  const d = p1[1] - p0[1] + g * p1[1], e = p3[1] - p0[1] + hh * p3[1], f = p0[1];
  return (u, v) => { const w = g * u + hh * v + 1; return [(a * u + b * v + c) / w, (d * u + e * v + f) / w]; };
}

/** Initial 4×4 warp control points (one Bézier patch, row-major) over a quad. */
export function warpGrid(q: Quad): V[] {
  const m = unitToQuad(q);
  const pts: V[] = [];
  for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) pts.push(m(i / 3, j / 3));
  return pts;
}

/** Point of a bicubic Bézier patch (16 control points, row-major) at (u, v). */
export function patchPoint(pts: V[], u: number, v: number): V {
  const B = (t: number) => [(1 - t) ** 3, 3 * t * (1 - t) ** 2, 3 * t * t * (1 - t), t ** 3];
  const bu = B(u), bv = B(v);
  let x = 0, y = 0;
  for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) { const w = bu[i] * bv[j]; x += pts[j * 4 + i][0] * w; y += pts[j * 4 + i][1] * w; }
  return [x, y];
}
