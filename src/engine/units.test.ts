import { describe, expect, it } from 'vitest';
import { pxToUnit, unitToPx, formatLength, majorStep, rulerTicks } from './units';

describe('unit conversion', () => {
  it('converts an A4 page at 300 ppi', () => {
    expect(formatLength(2480, 'mm', 300)).toBe('210.0');
    expect(formatLength(3508, 'mm', 300)).toBe('297.0');
    expect(formatLength(2480, 'in', 300)).toBe('8.27');
    expect(formatLength(3508, 'in', 300)).toBe('11.69');
    expect(formatLength(2480, 'cm', 300)).toBe('21.00');
    expect(formatLength(300, 'pt', 300)).toBe('72.0');
    expect(formatLength(2480, 'px', 300)).toBe('2480');
  });
  it('round-trips px -> unit -> px', () => {
    for (const u of ['mm', 'cm', 'in', 'pt'] as const) {
      expect(unitToPx(pxToUnit(1234, u, 150), u, 150)).toBeCloseTo(1234, 6);
    }
  });
  it('falls back to 72 ppi for a missing resolution', () => {
    expect(pxToUnit(72, 'in', 0)).toBe(1);
    expect(pxToUnit(72, 'in', Number.NaN)).toBe(1);
  });
});

describe('ruler ticks', () => {
  it('picks a 1-2-5 step that is at least the minimum on screen', () => {
    expect(majorStep('px', 72, 1)).toBe(100); // 60 px needed at 100% -> 100
    expect(majorStep('px', 72, 4)).toBe(20); // 15 px needed -> 20
    expect(majorStep('mm', 300, 0.25)).toBe(50); // ~2.95 screen px per mm -> need 20.3 mm -> 50
  });
  it('places ticks at doc 0 = offset and stays inside the ruler', () => {
    const ticks = rulerTicks(50, 500, 1, 'px', 72);
    expect(ticks[0]).toEqual({ screen: 50, label: '0' });
    expect(ticks.every((t) => t.screen >= 0 && t.screen <= 500)).toBe(true);
    expect(ticks.map((t) => t.label)).toEqual(['0', '100', '200', '300', '400']);
  });
  it('includes negative labels left of the origin', () => {
    const ticks = rulerTicks(250, 500, 1, 'px', 72);
    expect(ticks.map((t) => t.label)).toEqual(['-200', '-100', '0', '100', '200']);
  });
});
