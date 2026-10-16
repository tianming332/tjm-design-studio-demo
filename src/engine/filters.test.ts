import { describe, expect, it } from 'vitest';
import { FILTERS, filterByCmd, filterId, defaultValues, filterParams } from './filters';

describe('filter table', () => {
  it('has valid field ranges and in-range defaults', () => {
    for (const f of FILTERS) {
      expect(f.cmd.startsWith('filter.'), f.cmd).toBe(true);
      for (const fld of f.fields) {
        expect(fld.min, `${f.cmd}.${fld.key}`).toBeLessThan(fld.max);
        expect(fld.default).toBeGreaterThanOrEqual(fld.min);
        expect(fld.default).toBeLessThanOrEqual(fld.max);
      }
    }
  });
  it('has unique ids (command + variant)', () => {
    const ids = FILTERS.map(filterId);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('looks up by cmd or cmd#variant', () => {
    expect(filterByCmd('filter.blur.gaussianBlur')?.label).toBe('高斯模糊');
    expect(filterByCmd('filter.blur.radialBlur#zoom')?.baked).toMatchObject({ method: 'zoom' });
    expect(filterByCmd('nope')).toBeUndefined();
  });
  it('custom kernels are 5x5 with the 3x3 core centred', () => {
    const k = filterByCmd('filter.other.custom#sharpen')!.baked!.kernel as number[];
    expect(k).toHaveLength(25);
    expect(k[12]).toBe(5);
    expect(k.reduce((a, b) => a + b, 0)).toBe(1);
  });
});

describe('params', () => {
  it('merges baked choices and exposes the noise seed (addNoise)', () => {
    const spec = filterByCmd('filter.noise.addNoise')!;
    expect(defaultValues(spec)).toEqual({ amount: 12.5, seed: 0 });
    expect(filterParams(spec, { amount: 20, seed: 7 })).toEqual({ amount: 20, seed: 7, distribution: 'gaussian', monochromatic: true });
  });
  it('no-param filters produce empty params', () => {
    const spec = filterByCmd('filter.stylize.findEdges')!;
    expect(filterParams(spec, {})).toEqual({});
  });
});
