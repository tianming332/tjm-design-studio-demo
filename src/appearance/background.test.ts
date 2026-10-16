import { describe, expect, it } from 'vitest';
import { displaySize, imageDimensions } from './background';

function png(w: number, h: number) {
  const b = new Uint8Array(45);
  b.set([137, 80, 78, 71, 13, 10, 26, 10]);
  const v = new DataView(b.buffer);
  v.setUint32(8, 13); b.set([73, 72, 68, 82], 12);
  v.setUint32(16, w); v.setUint32(20, h);
  return b;
}
describe('decorative background resource limits', () => {
  it('reads PNG dimensions without decoding image pixels', () => {
    expect(imageDimensions(png(4000, 3000))).toEqual({ width: 4000, height: 3000 });
  });
  it('rejects animated PNGs', () => {
    const b = png(10, 10); b.set([97, 99, 84, 76], 37);
    expect(() => imageDimensions(b)).toThrow('动态 PNG');
  });
  it('reads JPEG dimensions', () => {
    expect(imageDimensions(new Uint8Array([255,216,255,192,0,8,8,1,44,2,88,0]))).toEqual({ width: 600, height: 300 });
  });
  it('reads extended WebP and rejects animation', () => {
    const b = new Uint8Array(30);
    b.set(new TextEncoder().encode('RIFF'), 0);
    b.set(new TextEncoder().encode('WEBPVP8X'), 8);
    b[24] = 99; b[27] = 49;
    expect(imageDimensions(b)).toEqual({ width: 100, height: 50 });
    b[20] = 2;
    expect(() => imageDimensions(b)).toThrow('动态 WebP');
  });
  it.each([new Uint8Array(), new Uint8Array([255,216,255]), new TextEncoder().encode('<svg/>')])('rejects unrecognised or truncated files', (b) => {
    expect(() => imageDimensions(b)).toThrow();
  });
  it('rejects oversized decoded dimensions before decode', () => {
    expect(() => displaySize(6000, 5000)).toThrow('2400');
    expect(() => displaySize(0, 100)).toThrow();
  });
  it.each([[6000, 4000], [4000, 6000], [1000, 1000], [16000, 1000]])('bounds the display copy for %i × %i without upscaling', (w, h) => {
    const size = displaySize(w, h);
    expect(Math.max(size.width, size.height)).toBeLessThanOrEqual(2560);
    expect(size.width * size.height).toBeLessThanOrEqual(4_000_000);
    expect(size.width).toBeLessThanOrEqual(w);
    expect(size.height).toBeLessThanOrEqual(h);
  });
});
