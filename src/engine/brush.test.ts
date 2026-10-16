import { describe, expect, it } from 'vitest';
import { sampleSpacing, shouldSample, addPoint, isGradientTooShort, MAX_STROKE_POINTS, type Pt2 } from './brush';

describe('sampleSpacing', () => {
  it('is a quarter of the brush size, floored at 1px', () => {
    expect(sampleSpacing(20)).toBe(5);
    expect(sampleSpacing(2)).toBe(1);
    expect(sampleSpacing(0.5)).toBe(1);
  });
});

describe('shouldSample / addPoint', () => {
  it('always keeps the first point', () => {
    expect(shouldSample([], [10, 10], 5)).toBe(true);
  });
  it('skips points closer than the spacing', () => {
    expect(shouldSample([[10, 10]], [12, 11], 5)).toBe(false);
    expect(shouldSample([[10, 10]], [16, 10], 5)).toBe(true);
  });
  it('addPoint thins a dense drag', () => {
    const pts: Pt2[] = [];
    for (let x = 0; x < 100; x++) addPoint(pts, [x, 0], 20); // spacing 5
    expect(pts.length).toBe(20);
  });
  it('stops at the hard cap', () => {
    const pts: Pt2[] = [];
    for (let i = 0; i < MAX_STROKE_POINTS + 50; i++) addPoint(pts, [i * 10, 0], 20);
    expect(pts.length).toBe(MAX_STROKE_POINTS);
  });
});

describe('isGradientTooShort', () => {
  it('rejects a near-zero drag', () => {
    expect(isGradientTooShort([10, 10], [11, 10])).toBe(true);
    expect(isGradientTooShort([10, 10], [40, 10])).toBe(false);
  });
});
