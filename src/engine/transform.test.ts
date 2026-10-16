import { describe, expect, it } from 'vitest';
import { rectCorners, moveCorner, moveEdge, proportionalCorner, rotateScaleMatrix, quadBounds, type Quad } from './transform';

const SRC = rectCorners([0, 0, 100, 100]);

describe('rectCorners', () => {
  it('is clockwise from top-left', () => {
    expect(SRC).toEqual([[0, 0], [100, 0], [100, 100], [0, 100]]);
  });
});

describe('moveCorner / moveEdge', () => {
  it('moves a single corner', () => {
    expect(moveCorner(SRC, 2, 20, 10)[2]).toEqual([120, 110]);
  });
  it('moves both corners of the top edge (single-axis scale)', () => {
    const q = moveEdge(SRC, 0, 0, -30);
    expect(q[0]).toEqual([0, -30]);
    expect(q[1]).toEqual([100, -30]);
    expect(q[2]).toEqual([100, 100]);
  });
});

describe('proportionalCorner', () => {
  it('scales uniformly from the opposite corner', () => {
    // Drag BR (i=2) outward by +100,+50; width drag dominates → 2x about TL(0,0).
    const q = proportionalCorner(SRC, 2, 100, 50);
    expect(q[2]).toEqual([200, 200]);
    expect(q[0]).toEqual([0, 0]);
    expect(quadBounds(q)).toEqual([0, 0, 200, 200]);
  });
});

describe('rotateScaleMatrix', () => {
  it('rotates 90° about the centre', () => {
    const [a, b, c, d] = rotateScaleMatrix(50, 50, 90, 1);
    expect(a).toBeCloseTo(0);
    expect(b).toBeCloseTo(1);
    expect(c).toBeCloseTo(-1);
    expect(d).toBeCloseTo(0);
  });
  it('scales about the centre leaving the centre fixed', () => {
    const [a, b, c, d, e, f] = rotateScaleMatrix(50, 50, 0, 2);
    // centre maps to itself
    expect(a * 50 + c * 50 + e).toBeCloseTo(50);
    expect(b * 50 + d * 50 + f).toBeCloseTo(50);
    // a corner at (0,0) maps outward to (-50,-50)
    expect(a * 0 + c * 0 + e).toBeCloseTo(-50);
  });
});

describe('quadBounds', () => {
  it('is the axis-aligned bounding box', () => {
    const q: Quad = [[10, 5], [40, 0], [50, 60], [0, 40]];
    expect(quadBounds(q)).toEqual([0, 0, 50, 60]);
  });
});

import {
  compose, decompose, distToQuad, flipQuad, isAffine, patchPoint, perspectiveQuad, pointInQuad, quadPoint,
  rotateQuad, scaleQuad, skewQuad, sweep, toUnit, translateQuad, unitToQuad, warpGrid,
} from './transform';

describe('free transform v2', () => {
  const R: [number, number, number, number] = [0, 0, 100, 50];
  const q = rectCorners(R);
  const near = (a: number[], b: number[]) => a.every((v, i) => Math.abs(v - b[i]) < 1e-6);
  it('scales from the opposite handle, optionally keeping the ratio', () => {
    expect(scaleQuad(q, 2, [200, 100])[2]).toEqual([200, 100]);
    expect(scaleQuad(q, 5, [150, 999])[2]).toEqual([150, 50]); // right edge: width only
    const r = scaleQuad(q, 2, [200, 60], { keepRatio: true });
    expect(near(r[2], [200, 100])).toBe(true);
  });
  it('Alt scales about the reference point (centre)', () => {
    const r = scaleQuad(q, 2, [150, 75], { anchor: [0.5, 0.5] });
    expect(near(r[0], [-50, -25])).toBe(true);
    expect(near(r[2], [150, 75])).toBe(true);
  });
  it('scales in the frame of a rotated quad', () => {
    const rq = rotateQuad(q, [50, 25], 90);
    const target = quadPoint(rq, 2, 1); // twice as wide in frame units
    const r = scaleQuad(rq, 5, target);
    expect(near(toUnit(rq, r[2]), [2, 1])).toBe(true);
  });
  it('rotate / translate / flip / hit tests', () => {
    expect(near(rotateQuad(q, [0, 0], 90)[1], [0, 100])).toBe(true);
    expect(translateQuad(q, 5, 6)[0]).toEqual([5, 6]);
    expect(flipQuad(q, 'h')[0]).toEqual([100, 0]);
    expect(flipQuad(q, 'v')[0]).toEqual([0, 50]);
    expect(pointInQuad(q, [10, 10])).toBe(true);
    expect(pointInQuad(q, [110, 10])).toBe(false);
    expect(distToQuad(q, [110, 25])).toBeCloseTo(10);
    expect(sweep([0, 0], [1, 0], [0, 1])).toBeCloseTo(90);
  });
  it('skew slides an edge; Alt mirrors the opposite edge', () => {
    const s = skewQuad(q, 4, [20, 7]);
    expect(s[0]).toEqual([20, 0]); expect(s[1]).toEqual([120, 0]); expect(s[3]).toEqual([0, 50]);
    const a = skewQuad(q, 4, [20, 0], true);
    expect(a[3]).toEqual([-20, 50]);
    expect(isAffine(s)).toBe(true);
  });
  it('perspective moves the partner corner symmetrically', () => {
    const p = perspectiveQuad(q, 0, [10, 1]);
    expect(near(p[0], [10, 0])).toBe(true);
    expect(near(p[1], [90, 0])).toBe(true);
    expect(isAffine(p)).toBe(false);
  });
  it('decompose / compose round-trip (scale, rotate, skew, ref)', () => {
    const params = { x: 30, y: 40, sx: 150, sy: 80, rot: 30, skew: 12 };
    const qq = compose(R, params, [0.5, 0.5]);
    const back = decompose(R, qq, [0.5, 0.5]);
    for (const k of Object.keys(params) as (keyof typeof params)[]) expect(back[k]).toBeCloseTo(params[k], 6);
    expect(decompose(R, q, [0, 0])).toMatchObject({ x: 0, y: 0, sx: 100, sy: 100, rot: 0, skew: 0 });
  });
  it('homography hits the corners; warp grid of an identity patch is flat', () => {
    const qq: [number, number][] = [[0, 0], [100, 10], [90, 60], [5, 50]];
    const m = unitToQuad(qq as never);
    expect(near(m(1, 0), [100, 10])).toBe(true);
    expect(near(m(1, 1), [90, 60])).toBe(true);
    expect(near(m(0, 1), [5, 50])).toBe(true);
    const g = warpGrid(q);
    expect(g).toHaveLength(16);
    expect(near(patchPoint(g, 0.5, 0.5), [50, 25])).toBe(true);
  });
});
