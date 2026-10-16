import { describe, expect, it } from 'vitest';
import { centeredRatioCrop, intersectCanvas } from './crop';

describe('centeredRatioCrop', () => {
  it('keeps full width on a taller canvas (16:9 out of 1000x1000)', () => {
    expect(centeredRatioCrop(1000, 1000, 16, 9)).toEqual({ x: 0, y: 218, width: 1000, height: 563 });
  });

  it('keeps full height on a wider canvas (1:1 out of 2000x1000)', () => {
    expect(centeredRatioCrop(2000, 1000, 1, 1)).toEqual({ x: 500, y: 0, width: 1000, height: 1000 });
  });

  it('is the whole canvas when the ratio already matches', () => {
    expect(centeredRatioCrop(1600, 900, 16, 9)).toEqual({ x: 0, y: 0, width: 1600, height: 900 });
  });

  it('rejects degenerate inputs', () => {
    expect(centeredRatioCrop(0, 100, 1, 1)).toBeNull();
    expect(centeredRatioCrop(100, 100, 0, 1)).toBeNull();
    expect(centeredRatioCrop(100, 100, 1, -2)).toBeNull();
  });
});

describe('intersectCanvas', () => {
  it('passes an inside rect through', () => {
    expect(intersectCanvas({ x: 10, y: 10, width: 50, height: 50 }, 100, 100))
      .toEqual({ x: 10, y: 10, width: 50, height: 50 });
  });

  it('clips a rect that overflows the canvas', () => {
    expect(intersectCanvas({ x: 80, y: 80, width: 50, height: 50 }, 100, 100))
      .toEqual({ x: 80, y: 80, width: 20, height: 20 });
  });

  it('clips negative origins', () => {
    expect(intersectCanvas({ x: -20, y: -5, width: 50, height: 50 }, 100, 100))
      .toEqual({ x: 0, y: 0, width: 30, height: 45 });
  });

  it('returns null for an empty intersection', () => {
    expect(intersectCanvas({ x: 200, y: 0, width: 50, height: 50 }, 100, 100)).toBeNull();
    expect(intersectCanvas({ x: 0, y: 0, width: 0, height: 50 }, 100, 100)).toBeNull();
  });
});
