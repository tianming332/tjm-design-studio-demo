import { describe, expect, it } from 'vitest';
import { boxHandles, constrainBox, pointInMask, resizeBox, stripBox } from './selection';
import {
  bezierAt, cornerKnot, deleteKnot, hitKnot, knotCount, moveHandle, moveKnots, nearestSegment, normPath,
  pathBounds, smoothKnot, splitSegment, toEngine, togglePoint, translatePath, type PathData,
} from './pathgeom';

describe('constrainBox', () => {
  const a = { x: 10, y: 10 };
  it('free drag is the normalised box', () => {
    expect(constrainBox(a, { x: 4, y: 30 })).toEqual({ x: 4, y: 10, width: 6, height: 20 });
  });
  it('Shift forces a square along the larger axis', () => {
    expect(constrainBox(a, { x: 50, y: 20 }, { square: true })).toEqual({ x: 10, y: 10, width: 40, height: 40 });
  });
  it('fixed ratio 2:1', () => {
    expect(constrainBox(a, { x: 50, y: 50 }, { style: { kind: 'ratio', w: 2, h: 1 } })).toEqual({ x: 10, y: 10, width: 80, height: 40 });
  });
  it('fixed size keeps the drag direction', () => {
    expect(constrainBox(a, { x: 0, y: 0 }, { style: { kind: 'size', w: 30, h: 20 } })).toEqual({ x: -20, y: -10, width: 30, height: 20 });
  });
  it('Alt grows from the centre', () => {
    expect(constrainBox(a, { x: 15, y: 13 }, { center: true })).toEqual({ x: 5, y: 7, width: 10, height: 6 });
  });
});

describe('strip / mask / resize', () => {
  it('single row and column span the canvas', () => {
    expect(stripBox({ x: 5, y: 7 }, 'row', 100, 50)).toEqual({ x: 0, y: 7, width: 100, height: 1 });
    expect(stripBox({ x: 500, y: 7 }, 'col', 100, 50)).toEqual({ x: 99, y: 0, width: 1, height: 50 });
  });
  it('pointInMask honours the mask origin', () => {
    const m = { x: 10, y: 10, width: 2, height: 1, coverage: new Uint8Array([255, 0]) };
    expect(pointInMask({ x: 10, y: 10 }, m)).toBe(true);
    expect(pointInMask({ x: 11, y: 10 }, m)).toBe(false);
    expect(pointInMask({ x: 0, y: 0 }, m)).toBe(false);
  });
  it('resizeBox moves only the dragged sides and flips past the opposite edge', () => {
    expect(resizeBox([10, 10, 20, 20], 2, 5, 10)).toEqual([10, 10, 25, 30]);
    expect(resizeBox([10, 10, 20, 20], 7, 30, 99)).toEqual([30, 10, 10, 20]);
    expect(resizeBox([0, 0, 20, 10], 2, 20, 0, true)).toEqual([0, 0, 40, 20]);
    expect(boxHandles([0, 0, 10, 20])[5]).toEqual([10, 10]);
  });
});

const tri = (): PathData => normPath({ subpaths: [{ closed: true, knots: [[0, 0], [30, 0], [0, 30]] }] });

describe('pathgeom', () => {
  it('normalises bare and full knots', () => {
    const p = normPath({ subpaths: [{ closed: false, knots: [[1, 2], { anchor: [5, 5], in: [4, 5], out: [6, 5], smooth: true }] }] });
    expect(p.subpaths[0].knots[0]).toEqual(cornerKnot([1, 2]));
    expect(p.subpaths[0].knots[1].smooth).toBe(true);
    expect(knotCount(p)).toBe(2);
  });
  it('splitting a straight segment keeps it straight and adds one knot', () => {
    const s = splitSegment(tri(), 0, 0, 0.5);
    expect(knotCount(s)).toBe(4);
    expect(s.subpaths[0].knots[1].anchor).toEqual([15, 0]);
    expect(s.subpaths[0].knots[1].smooth).toBe(false);
  });
  it('splitting a curve keeps the curve point at t', () => {
    const p = normPath({ subpaths: [{ closed: false, knots: [{ anchor: [0, 0], in: [0, 0], out: [0, 20], smooth: false }, { anchor: [40, 0], in: [40, 20], out: [40, 0], smooth: false }] }] });
    const mid = bezierAt([[0, 0], [0, 20], [40, 20], [40, 0]], 0.5);
    const s = splitSegment(p, 0, 0, 0.5);
    expect(s.subpaths[0].knots[1].anchor[0]).toBeCloseTo(mid[0]);
    expect(s.subpaths[0].knots[1].anchor[1]).toBeCloseTo(mid[1]);
  });
  it('nearestSegment finds the closing edge of a closed path', () => {
    const n = nearestSegment(tri(), [15, 15]);
    expect(n?.seg).toBe(1);
    expect(n!.d).toBeLessThan(1);
  });
  it('hitKnot prefers anchors, then protruding handles', () => {
    const p = normPath({ subpaths: [{ closed: false, knots: [[0, 0], { anchor: [20, 0], in: [10, 0], out: [30, 0], smooth: true }] }] });
    expect(hitKnot(p, [1, 1], 3)).toEqual({ kind: 'anchor', sub: 0, knot: 0 });
    expect(hitKnot(p, [30, 1], 3)).toEqual({ kind: 'out', sub: 0, knot: 1 });
    expect(hitKnot(p, [50, 50], 3)).toBeUndefined();
  });
  it('moving a smooth handle mirrors the other one; Alt breaks it', () => {
    const p = normPath({ subpaths: [{ closed: false, knots: [{ anchor: [20, 20], in: [10, 20], out: [30, 20], smooth: true }, [50, 50]] }] });
    const m = moveHandle(p, 0, 0, 'out', [20, 40]);
    expect(m.subpaths[0].knots[0].in[0]).toBeCloseTo(20);
    expect(m.subpaths[0].knots[0].in[1]).toBeCloseTo(10);
    const b = moveHandle(p, 0, 0, 'out', [20, 40], true);
    expect(b.subpaths[0].knots[0].in).toEqual([10, 20]);
    expect(b.subpaths[0].knots[0].smooth).toBe(false);
  });
  it('moveKnots / translate / delete / toggle / bounds', () => {
    expect(moveKnots(tri(), [{ sub: 0, knot: 1 }], 5, 5).subpaths[0].knots[1].anchor).toEqual([35, 5]);
    expect(pathBounds(translatePath(tri(), 10, 0))).toEqual([10, 0, 30, 30]);
    expect(knotCount(deleteKnot(tri(), 0, 0))).toBe(2);
    expect(deleteKnot(deleteKnot(tri(), 0, 0), 0, 0).subpaths).toHaveLength(0);
    const sm = togglePoint(tri(), 0, 0);
    expect(sm.subpaths[0].knots[0].smooth).toBe(true);
    expect(togglePoint(sm, 0, 0).subpaths[0].knots[0]).toEqual(cornerKnot([0, 0]));
  });
  it('smoothKnot mirrors the drag; a click is a corner', () => {
    expect(smoothKnot([10, 10], [20, 10])).toEqual({ anchor: [10, 10], in: [0, 10], out: [20, 10], smooth: true });
    expect(smoothKnot([10, 10], [10, 10]).smooth).toBe(false);
  });
  it('toEngine emits full knots', () => {
    const e = toEngine(tri()) as { subpaths: { knots: { anchor: number[] }[] }[] };
    expect(e.subpaths[0].knots[2].anchor).toEqual([0, 30]);
  });
});

import { boxCenter, cropRatio, fitRatio, rotateAbout, sweepAngle } from './selection';
describe('crop geometry', () => {
  it('ratio options', () => {
    expect(cropRatio({ ratio: '16:9', w: 0, h: 0 })).toBeCloseTo(16 / 9);
    expect(cropRatio({ ratio: 'custom', w: 3, h: 2 })).toBe(1.5);
    expect(cropRatio({ ratio: 'free', w: 3, h: 2 })).toBe(0);
  });
  it('fitRatio keeps the edge opposite the dragged handle', () => {
    expect(fitRatio([10, 10, 100, 30], 2, 2)).toEqual([10, 10, 100, 50]);
    expect(fitRatio([10, 10, 100, 30], 2, 0)).toEqual([10, -10, 100, 50]);
    expect(fitRatio([10, 10, 100, 40], 1, 6)).toEqual([40, 10, 40, 40]);
  });
  it('rotation helpers', () => {
    const p = rotateAbout([10, 0], [0, 0], 90);
    expect(p[0]).toBeCloseTo(0); expect(p[1]).toBeCloseTo(10);
    expect(sweepAngle([0, 0], [10, 0], [0, 10])).toBeCloseTo(90);
    expect(sweepAngle([0, 0], [10, 0], [10, -0.0001])).toBeCloseTo(0);
    expect(boxCenter([0, 0, 10, 20])).toEqual([5, 10]);
  });
});
