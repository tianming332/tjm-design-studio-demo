// Pure Bézier-path geometry for the pen / path-selection / direct-selection tools.
// Mirrors the engine's path JSON (`path.info`, `shape.info`): subpaths of knots with an anchor
// and in/out control points (absolute document coordinates). No DOM, no engine — unit-tested.
export type P = [number, number];

export interface Knot { anchor: P; in: P; out: P; smooth: boolean }
export interface Subpath { closed: boolean; op?: string; knots: Knot[] }
export interface PathData { subpaths: Subpath[]; fillRule?: string; inverted?: boolean }

/** Engine knots may be bare `[x,y]` (corner, retracted handles) or full objects. */
export function normKnot(k: unknown): Knot {
  if (Array.isArray(k)) return { anchor: [k[0], k[1]], in: [k[0], k[1]], out: [k[0], k[1]], smooth: false };
  const o = k as Partial<Knot>;
  const a = (o.anchor ?? [0, 0]) as P;
  return { anchor: [a[0], a[1]], in: (o.in ?? a).slice(0, 2) as P, out: (o.out ?? a).slice(0, 2) as P, smooth: !!o.smooth };
}

export function normPath(p: unknown): PathData {
  const o = (p ?? {}) as { subpaths?: { closed?: boolean; op?: string; knots?: unknown[] }[]; fillRule?: string; inverted?: boolean };
  return {
    subpaths: (o.subpaths ?? []).map((s) => ({ closed: s.closed ?? true, op: s.op, knots: (s.knots ?? []).map(normKnot) })),
    ...(o.fillRule ? { fillRule: o.fillRule } : {}),
    ...(o.inverted != null ? { inverted: o.inverted } : {}),
  };
}

export const knotCount = (p: PathData) => p.subpaths.reduce((n, s) => n + s.knots.length, 0);

const lerp = (a: P, b: P, t: number): P => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const dist = (a: P, b: P) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Cubic segment between knot i and the next one (wrapping when closed). */
export function segment(s: Subpath, i: number): [P, P, P, P] | undefined {
  const j = i + 1 < s.knots.length ? i + 1 : s.closed ? 0 : -1;
  if (j < 0 || j === i) return undefined;
  const a = s.knots[i];
  const b = s.knots[j];
  return [a.anchor, a.out, b.in, b.anchor];
}

export function bezierAt(seg: [P, P, P, P], t: number): P {
  const [p0, p1, p2, p3] = seg;
  const a = lerp(p0, p1, t), b = lerp(p1, p2, t), c = lerp(p2, p3, t);
  return lerp(lerp(a, b, t), lerp(b, c, t), t);
}

/** Nearest point on any segment of the path: subpath, segment start knot, parameter, distance. */
export function nearestSegment(p: PathData, pt: P, samples = 48): { sub: number; seg: number; t: number; d: number } | undefined {
  let best: { sub: number; seg: number; t: number; d: number } | undefined;
  p.subpaths.forEach((s, si) => {
    for (let i = 0; i < s.knots.length; i++) {
      const seg = segment(s, i);
      if (!seg) continue;
      for (let k = 1; k < samples; k++) {
        const t = k / samples;
        const d = dist(bezierAt(seg, t), pt);
        if (!best || d < best.d) best = { sub: si, seg: i, t, d };
      }
    }
  });
  return best;
}

/** Inserts an anchor on segment (sub, seg) at parameter t without changing the curve (de Casteljau). */
export function splitSegment(p: PathData, sub: number, seg: number, t: number): PathData {
  const out = clonePath(p);
  const s = out.subpaths[sub];
  const g = segment(s, seg);
  if (!g) return out;
  const [p0, p1, p2, p3] = g;
  const a = lerp(p0, p1, t), b = lerp(p1, p2, t), c = lerp(p2, p3, t);
  const d = lerp(a, b, t), e = lerp(b, c, t), m = lerp(d, e, t);
  const j = seg + 1 < s.knots.length ? seg + 1 : 0;
  s.knots[seg] = { ...s.knots[seg], out: a };
  s.knots[j] = { ...s.knots[j], in: c };
  const straight = p0[0] === p1[0] && p0[1] === p1[1] && p2[0] === p3[0] && p2[1] === p3[1];
  s.knots.splice(seg + 1, 0, { anchor: m, in: straight ? m : d, out: straight ? m : e, smooth: !straight });
  return out;
}

export type Hit = { kind: 'anchor' | 'in' | 'out'; sub: number; knot: number };

/** Hit-test anchors first, then handles (only handles that stick out from their anchor). */
export function hitKnot(p: PathData, pt: P, tol: number): Hit | undefined {
  for (let si = 0; si < p.subpaths.length; si++) {
    const ks = p.subpaths[si].knots;
    for (let i = 0; i < ks.length; i++) if (dist(ks[i].anchor, pt) <= tol) return { kind: 'anchor', sub: si, knot: i };
  }
  for (let si = 0; si < p.subpaths.length; si++) {
    const ks = p.subpaths[si].knots;
    for (let i = 0; i < ks.length; i++) {
      const k = ks[i];
      if (dist(k.out, k.anchor) > 0.5 && dist(k.out, pt) <= tol) return { kind: 'out', sub: si, knot: i };
      if (dist(k.in, k.anchor) > 0.5 && dist(k.in, pt) <= tol) return { kind: 'in', sub: si, knot: i };
    }
  }
  return undefined;
}

export function clonePath(p: PathData): PathData {
  return { ...p, subpaths: p.subpaths.map((s) => ({ ...s, knots: s.knots.map((k) => ({ anchor: [...k.anchor] as P, in: [...k.in] as P, out: [...k.out] as P, smooth: k.smooth })) })) };
}

/** Moves the given anchors (with their handles) by (dx, dy). */
export function moveKnots(p: PathData, sel: { sub: number; knot: number }[], dx: number, dy: number): PathData {
  const out = clonePath(p);
  for (const { sub, knot } of sel) {
    const k = out.subpaths[sub]?.knots[knot];
    if (!k) continue;
    for (const q of [k.anchor, k.in, k.out]) { q[0] += dx; q[1] += dy; }
  }
  return out;
}

export function translatePath(p: PathData, dx: number, dy: number): PathData {
  const all = p.subpaths.flatMap((s, sub) => s.knots.map((_, knot) => ({ sub, knot })));
  return moveKnots(p, all, dx, dy);
}

/** Drags one handle to `to`. A smooth knot mirrors the opposite handle (keeping its length)
 *  unless `breakSmooth` (Alt), which turns it into a corner with independent handles. */
export function moveHandle(p: PathData, sub: number, knot: number, which: 'in' | 'out', to: P, breakSmooth = false): PathData {
  const out = clonePath(p);
  const k = out.subpaths[sub]?.knots[knot];
  if (!k) return out;
  k[which] = [to[0], to[1]];
  if (breakSmooth) { k.smooth = false; return out; }
  if (k.smooth) {
    const other = which === 'in' ? 'out' : 'in';
    const len = dist(k[other], k.anchor) || dist(to, k.anchor);
    const vx = k.anchor[0] - to[0], vy = k.anchor[1] - to[1];
    const n = Math.hypot(vx, vy) || 1;
    k[other] = [k.anchor[0] + (vx / n) * len, k.anchor[1] + (vy / n) * len];
  }
  return out;
}

/** Pen drag: a smooth knot at `anchor` whose out handle follows the pointer (in is mirrored). */
export function smoothKnot(anchor: P, dragTo: P): Knot {
  const inP: P = [2 * anchor[0] - dragTo[0], 2 * anchor[1] - dragTo[1]];
  const moved = dist(anchor, dragTo) > 0.5;
  return { anchor: [...anchor] as P, in: moved ? inP : [...anchor] as P, out: moved ? [...dragTo] as P : [...anchor] as P, smooth: moved };
}

export const cornerKnot = (a: P): Knot => ({ anchor: [a[0], a[1]], in: [a[0], a[1]], out: [a[0], a[1]], smooth: false });

/** Alt-click with the pen: smooth → corner (retract handles); corner → smooth (handles along the
 *  neighbours' chord, a third of the distance each way). */
export function togglePoint(p: PathData, sub: number, knot: number): PathData {
  const out = clonePath(p);
  const s = out.subpaths[sub];
  const k = s?.knots[knot];
  if (!k) return out;
  const retracted = dist(k.in, k.anchor) < 0.5 && dist(k.out, k.anchor) < 0.5;
  if (!retracted) { s.knots[knot] = cornerKnot(k.anchor); return out; }
  const n = s.knots.length;
  const prev = s.knots[(knot - 1 + n) % n].anchor;
  const next = s.knots[(knot + 1) % n].anchor;
  const vx = (next[0] - prev[0]) / 6, vy = (next[1] - prev[1]) / 6;
  s.knots[knot] = { anchor: k.anchor, in: [k.anchor[0] - vx, k.anchor[1] - vy], out: [k.anchor[0] + vx, k.anchor[1] + vy], smooth: true };
  return out;
}

/** Removes one anchor; a subpath left with < 2 knots is dropped. */
export function deleteKnot(p: PathData, sub: number, knot: number): PathData {
  const out = clonePath(p);
  const s = out.subpaths[sub];
  if (!s) return out;
  s.knots.splice(knot, 1);
  if (s.knots.length < 2) out.subpaths.splice(sub, 1);
  return out;
}

/** Axis-aligned bounds of all anchors and handles. */
export function pathBounds(p: PathData): [number, number, number, number] | undefined {
  const pts = p.subpaths.flatMap((s) => s.knots.flatMap((k) => [k.anchor, k.in, k.out]));
  if (!pts.length) return undefined;
  const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
  const x0 = Math.min(...xs), y0 = Math.min(...ys);
  return [x0, y0, Math.max(...xs) - x0, Math.max(...ys) - y0];
}

/** Engine JSON for path.set / shape.edit {path}. */
export function toEngine(p: PathData): object {
  return {
    ...(p.fillRule ? { fillRule: p.fillRule } : {}),
    subpaths: p.subpaths.map((s) => ({
      closed: s.closed,
      ...(s.op ? { op: s.op } : {}),
      knots: s.knots.map((k) => ({ anchor: k.anchor, in: k.in, out: k.out, smooth: k.smooth })),
    })),
  };
}
