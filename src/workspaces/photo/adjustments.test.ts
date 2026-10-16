import { describe, expect, it } from 'vitest';
import { ADJUSTMENTS, specForKind, valuesFrom, paramsFrom, fieldsForGroup, applyPreset, curveAt } from './adjustments';

describe('adjustment table', () => {
  it('every spec has an engine cmd and in-range field defaults', () => {
    for (const a of ADJUSTMENTS) {
      // Parameterless adjustments (e.g. Invert) legitimately have no fields.
      expect(a.cmd.startsWith('layer.newAdjustmentLayer.'), a.cmd).toBe(true);
      for (const f of a.fields) {
        expect(f.min, `${a.kind}.${f.key}`).toBeLessThan(f.max);
        expect(f.default, `${a.kind}.${f.key}`).toBeGreaterThanOrEqual(f.min);
        expect(f.default, `${a.kind}.${f.key}`).toBeLessThanOrEqual(f.max);
      }
    }
  });
  it('kinds are unique', () => {
    const kinds = ADJUSTMENTS.map((a) => a.kind.toLowerCase());
    expect(new Set(kinds).size).toBe(kinds.length);
  });
  it('looks specs up case-insensitively', () => {
    expect(specForKind('brightnesscontrast')?.label).toBe('亮度/对比度');
    expect(specForKind('HueSaturation')?.kind).toBe('HueSaturation');
    expect(specForKind('nope')).toBeUndefined();
  });
});

describe('values <-> params', () => {
  it('falls back to defaults and clamps out-of-range params', () => {
    const spec = specForKind('BrightnessContrast')!;
    expect(valuesFrom(spec, {})).toEqual({ brightness: 0, contrast: 0 });
    expect(valuesFrom(spec, { brightness: 999 })).toEqual({ brightness: 150, contrast: 0 });
  });
  it('passes plain values straight through', () => {
    const spec = specForKind('Exposure')!;
    expect(paramsFrom(spec, { exposure: 1.5, offset: 0, gamma: 1 })).toEqual({ exposure: 1.5, offset: 0, gamma: 1 });
  });
});

// Real `doc.inspect` read-back payloads captured from photocraft-cli 0.6.0. Before the fix these
// were read as params, so the editor showed defaults and the next commit wiped the values.
describe('engine read-back (regression: values were reset to defaults)', () => {
  it('Levels: master + per_channel, normalised snake_case', () => {
    const spec = specForKind('Levels')!;
    const flat = { gamma: 1, in_black: 0, in_white: 1, out_black: 0, out_white: 1 };
    const v = valuesFrom(spec, {
      master: { ...flat, in_black: 0.03921568766236305 },
      per_channel: [{ ...flat, gamma: 1.5, in_black: 0.11764705926179886 }, flat, flat],
      space: 'Rgb',
    });
    expect(v.inBlack).toBe(10);
    expect(v['red.inBlack']).toBe(30);
    expect(v['red.gamma']).toBe(1.5);
    expect(v['green.inBlack']).toBe(0);
    const p = paramsFrom(spec, v) as Record<string, any>;
    expect(p.inBlack).toBe(10);
    expect(p.red).toEqual({ inBlack: 30, gamma: 1.5, inWhite: 255, outBlack: 0, outWhite: 255 });
  });

  it('Curves: master/per_channel {input,output} 0..1', () => {
    const spec = specForKind('Curves')!;
    const ident = [{ input: 0, output: 0 }, { input: 1, output: 1 }];
    const v = valuesFrom(spec, {
      master: [
        { input: 0, output: 0 }, { input: 0.250980406999588, output: 0.1568627506494522 },
        { input: 0.501960813999176, output: 0.501960813999176 }, { input: 0.7529411911964417, output: 0.8627451062202454 }, { input: 1, output: 1 },
      ],
      per_channel: [[{ input: 0, output: 0 }, { input: 0.501960813999176, output: 0.6274510025978088 }, { input: 1, output: 1 }], ident, ident],
    });
    expect([v.shadow, v.mid, v.highlight]).toEqual([40, 128, 220]);
    expect(v['red.mid']).toBe(160);
    expect(v['green.mid']).toBe(128);
    const p = paramsFrom(spec, v) as Record<string, any>;
    expect(p.points).toEqual([[0, 0], [64, 40], [128, 128], [192, 220], [255, 255]]);
    expect(p.red[2]).toEqual([128, 160]);
  });

  it('Curves: param form (points) still reads back', () => {
    const spec = specForKind('Curves')!;
    expect(valuesFrom(spec, { points: [[0, 0], [128, 148], [255, 255]] }).mid).toBe(148);
  });

  it('BlackWhite: weights array', () => {
    const v = valuesFrom(specForKind('BlackWhite')!, { tint: null, weights: [10, 20, 30, 40, 50, 60] });
    expect(v).toEqual({ reds: 10, yellows: 20, greens: 30, cyans: 40, blues: 50, magentas: 60 });
  });

  it('HueSaturation: per-range values and colorize', () => {
    const spec = specForKind('HueSaturation')!;
    const v = valuesFrom(spec, {
      colorize: false, hue: 10, lightness: 0, saturation: 0,
      ranges: [{ bounds: [-45, -15, 15, 45], hue: 20, lightness: 0, saturation: -30 }, ...Array(5).fill({ hue: 0, lightness: 0, saturation: 0 })],
    });
    expect(v.hue).toBe(10);
    expect(v['reds.hue']).toBe(20);
    expect(v['reds.saturation']).toBe(-30);
    expect(v.colorize).toBe(0);
    const p = paramsFrom(spec, v) as Record<string, any>;
    expect(p.reds).toEqual({ hue: 20, saturation: -30, lightness: 0 });
    expect(p.colorize).toBe(false);
  });

  it('HueSaturation colorize sends an absolute hue and non-negative saturation', () => {
    const spec = specForKind('HueSaturation')!;
    const p = paramsFrom(spec, { ...valuesFrom(spec, {}), colorize: 1, hue: -90, saturation: -20 }) as Record<string, any>;
    expect(p).toMatchObject({ colorize: true, hue: 270, saturation: 0 });
    expect(valuesFrom(spec, { colorize: true, hue: 270, saturation: 40 }).hue).toBe(-90);
  });
});

describe('groups and presets', () => {
  it('filters fields per channel', () => {
    const spec = specForKind('Levels')!;
    expect(fieldsForGroup(spec, '').map((f) => f.key)).toEqual(['inBlack', 'gamma', 'inWhite', 'outBlack', 'outWhite']);
    expect(fieldsForGroup(spec, 'blue').every((f) => f.key.startsWith('blue.'))).toBe(true);
  });
  it('writes a preset into the selected channel only', () => {
    const spec = specForKind('Curves')!;
    const v = applyPreset(valuesFrom(spec, {}), spec.presets![1].values, 'red');
    expect([v['red.shadow'], v['red.highlight']]).toEqual([48, 208]);
    expect(v.shadow).toBe(64);
  });
  it('curveAt interpolates both point forms', () => {
    expect(curveAt([[0, 0], [255, 255]], 64)).toBe(64);
    expect(curveAt([{ input: 0, output: 0 }, { input: 1, output: 0.5 }], 255)).toBeCloseTo(127.5);
    expect(curveAt([], 10)).toBeUndefined();
  });
});
