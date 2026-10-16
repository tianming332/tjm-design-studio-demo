import { describe, expect, it } from 'vitest';
import { hexToRgb, rgbToHex, rgb01ToHex, rgbToHsb, hsbToRgb, hexToHsb, hsbToHex } from './color';

describe('hex <-> rgb', () => {
  it('parses and formats', () => {
    expect(hexToRgb('#ff8000')).toEqual({ r: 255, g: 128, b: 0 });
    expect(hexToRgb('ff8000')).toEqual({ r: 255, g: 128, b: 0 });
    expect(rgbToHex({ r: 255, g: 128, b: 0 })).toBe('#ff8000');
    expect(rgbToHex({ r: 0, g: 0, b: 0 })).toBe('#000000');
  });
  it('clamps and falls back on bad input', () => {
    expect(hexToRgb('nope')).toEqual({ r: 0, g: 0, b: 0 });
    expect(rgbToHex({ r: 300, g: -5, b: 255 })).toBe('#ff00ff');
  });
});

describe('engine 0..1 pixel -> hex', () => {
  it('converts a read-back pixel', () => {
    expect(rgb01ToHex([1, 0, 0, 1])).toBe('#ff0000');
    expect(rgb01ToHex([0, 0.5019607843, 1, 1])).toBe('#0080ff');
    expect(rgb01ToHex([])).toBe('#000000');
  });
});

describe('rgb <-> hsb', () => {
  it('maps the primaries', () => {
    expect(rgbToHsb({ r: 255, g: 0, b: 0 })).toEqual({ h: 0, s: 100, b: 100 });
    expect(rgbToHsb({ r: 0, g: 255, b: 0 })).toEqual({ h: 120, s: 100, b: 100 });
    expect(rgbToHsb({ r: 0, g: 0, b: 255 })).toEqual({ h: 240, s: 100, b: 100 });
    expect(rgbToHsb({ r: 255, g: 255, b: 255 })).toEqual({ h: 0, s: 0, b: 100 });
    expect(rgbToHsb({ r: 0, g: 0, b: 0 })).toEqual({ h: 0, s: 0, b: 0 });
  });
  it('inverts back to rgb', () => {
    expect(hsbToRgb({ h: 0, s: 100, b: 100 })).toEqual({ r: 255, g: 0, b: 0 });
    expect(hsbToRgb({ h: 120, s: 100, b: 100 })).toEqual({ r: 0, g: 255, b: 0 });
    expect(hsbToRgb({ h: 240, s: 100, b: 100 })).toEqual({ r: 0, g: 0, b: 255 });
    expect(hsbToRgb({ h: 0, s: 0, b: 50 })).toEqual({ r: 128, g: 128, b: 128 });
  });
  it('round-trips representative colours within 1/255', () => {
    for (const hex of ['#ff8000', '#3366cc', '#12ab7f', '#777777', '#010203']) {
      const back = hsbToHex(hexToHsb(hex));
      const a = hexToRgb(hex);
      const b = hexToRgb(back);
      expect(Math.abs(a.r - b.r), hex).toBeLessThanOrEqual(1);
      expect(Math.abs(a.g - b.g), hex).toBeLessThanOrEqual(1);
      expect(Math.abs(a.b - b.b), hex).toBeLessThanOrEqual(1);
    }
  });
  it('wraps hue and clamps out-of-range input', () => {
    expect(hsbToRgb({ h: 360, s: 100, b: 100 })).toEqual({ r: 255, g: 0, b: 0 });
    expect(hsbToRgb({ h: -120, s: 100, b: 100 })).toEqual({ r: 0, g: 0, b: 255 });
    expect(hsbToRgb({ h: 0, s: 200, b: 200 })).toEqual({ r: 255, g: 0, b: 0 });
  });
});
