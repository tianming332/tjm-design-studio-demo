import { describe, expect, it } from 'vitest';
import { modeFrom, screenToDoc, dragBox, isTinyDrag, outlinePixels, outlineStep, downsample } from './selection';
import { unpackSelectionMask } from './protocol';

describe('modeFrom', () => {
  it('maps the PS modifier convention', () => {
    expect(modeFrom(false, false)).toBe('replace');
    expect(modeFrom(true, false)).toBe('add');
    expect(modeFrom(false, true)).toBe('subtract');
    expect(modeFrom(true, true)).toBe('intersect');
  });
});

describe('screenToDoc', () => {
  it('undoes pan and zoom', () => {
    const wrap = { left: 100, top: 50 };
    expect(screenToDoc(150, 100, wrap, { scale: 1, tx: 0, ty: 0 })).toEqual({ x: 50, y: 50 });
    expect(screenToDoc(150, 100, wrap, { scale: 2, tx: 0, ty: 0 })).toEqual({ x: 25, y: 25 });
    expect(screenToDoc(150, 100, wrap, { scale: 1, tx: 10, ty: -10 })).toEqual({ x: 40, y: 60 });
  });
});

describe('dragBox / isTinyDrag', () => {
  it('normalises either drag direction', () => {
    expect(dragBox({ x: 30, y: 40 }, { x: 10, y: 10 })).toEqual({ x: 10, y: 10, width: 20, height: 30 });
    expect(dragBox({ x: 10, y: 10 }, { x: 30, y: 40 })).toEqual({ x: 10, y: 10, width: 20, height: 30 });
  });
  it('treats a sub-2px drag as a click', () => {
    expect(isTinyDrag({ x: 10, y: 10 }, { x: 11, y: 40 })).toBe(true);
    expect(isTinyDrag({ x: 10, y: 10 }, { x: 40, y: 40 })).toBe(false);
  });
});

describe('outlinePixels', () => {
  it('outlines a filled square as its border only', () => {
    const w = 4, h = 4;
    const cov = new Uint8Array(w * h).fill(255);
    const out = outlinePixels(cov, w, h);
    // The 2x2 block in the middle is fully surrounded, so only the border ring is outline.
    const expected = new Array(16).fill(1);
    for (const i of [5, 6, 9, 10]) expected[i] = 0;
    expect(Array.from(out)).toEqual(expected);
  });

  it('leaves interior pixels alone on a larger mask', () => {
    const w = 5, h = 5;
    const cov = new Uint8Array(w * h).fill(255);
    const out = outlinePixels(cov, w, h);
    expect(out[2 * w + 2]).toBe(0);   // centre is interior
    expect(out[0]).toBe(1);           // corner is on the border
  });

  it('ignores coverage below the 128 threshold', () => {
    const cov = new Uint8Array(9).fill(100);
    expect(Array.from(outlinePixels(cov, 3, 3))).toEqual(new Array(9).fill(0));
  });
});

describe('downsampling huge masks', () => {
  it('keeps small masks untouched', () => {
    expect(outlineStep(100, 100)).toBe(1);
    const cov = new Uint8Array(4);
    expect(downsample(cov, 2, 2, 1).w).toBe(2);
  });
  it('steps down masks beyond the display limit', () => {
    expect(outlineStep(8192, 100)).toBe(2);
    const cov = new Uint8Array(16).fill(255);
    const d = downsample(cov, 4, 4, 2);
    expect([d.w, d.h]).toEqual([2, 2]);
    expect(d.cov.length).toBe(4);
  });
});

describe('unpackSelectionMask', () => {
  const pack = (x: number, y: number, w: number, h: number, fill = 255) => {
    const buf = new ArrayBuffer(16 + w * h);
    const dv = new DataView(buf);
    dv.setInt32(0, x, true); dv.setInt32(4, y, true);
    dv.setUint32(8, w, true); dv.setUint32(12, h, true);
    new Uint8Array(buf, 16).fill(fill);
    return buf;
  };

  it('decodes the header and coverage', () => {
    const m = unpackSelectionMask(pack(10, 20, 3, 4))!;
    expect([m.x, m.y, m.width, m.height]).toEqual([10, 20, 3, 4]);
    expect(m.coverage.length).toBe(12);
    expect(m.coverage[0]).toBe(255);
  });

  it('treats empty or zero-sized payloads as no selection', () => {
    expect(unpackSelectionMask(undefined)).toBeUndefined();
    expect(unpackSelectionMask(new ArrayBuffer(0))).toBeUndefined();
    expect(unpackSelectionMask(pack(0, 0, 0, 0))).toBeUndefined();
  });

  it('handles negative origins', () => {
    const m = unpackSelectionMask(pack(-5, -7, 2, 2))!;
    expect([m.x, m.y]).toEqual([-5, -7]);
  });
});

import { outlineSegments } from './selection';
describe('outlineSegments', () => {
  it('a filled 2×2 block gives four merged edges', () => {
    const segs = outlineSegments(new Uint8Array([255, 255, 255, 255]), 2, 2);
    expect(segs).toHaveLength(4);
    expect(segs).toContainEqual([0, 0, 2, 0]);
    expect(segs).toContainEqual([0, 2, 2, 2]);
    expect(segs).toContainEqual([0, 0, 0, 2]);
    expect(segs).toContainEqual([2, 0, 2, 2]);
  });
  it('an L shape has six edges; empty has none', () => {
    expect(outlineSegments(new Uint8Array([255, 0, 255, 255]), 2, 2)).toHaveLength(6);
    expect(outlineSegments(new Uint8Array([0, 0, 0, 0]), 2, 2)).toHaveLength(0);
  });
});
