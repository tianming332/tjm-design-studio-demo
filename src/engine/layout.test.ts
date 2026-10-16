import { describe, expect, it } from 'vitest';
import { alignDelta, contrastRatio, lintDoc, relBox, textContrast } from './layout';
import { captureRect } from './region';
import { FILTERS, filterId } from './filters';
import { EDIT_BATCH } from '../ai/tools';
// @ts-expect-error plain JS module outside this TS project
import { FILTER_IDS, validateCall } from '../local/backend/workbench/tools.js';

const text = (id: number, bounds: [number, number, number, number], t = '标题') => ({ id, name: t, kind: 'Type', blend: 'normal', fill: 1, bounds, text: { text: t, font: 'Noto', sizePt: 40 } });

describe('layout helpers', () => {
  it('relative boxes and alignment', () => {
    expect(relBox([0.1, 0.2, 0.5, 0.25], 1000, 800)).toEqual([100, 160, 500, 200]);
    expect(alignDelta([0, 0, 100, 50], [100, 100, 300, 100], 'center', 'middle')).toEqual([200, 125]);
    expect(alignDelta([0, 0, 100, 50], [100, 100, 300, 100], 'right', 'bottom')).toEqual([300, 150]);
  });
  it('lint finds overflow, overlap, edge, tiny and empty text', () => {
    const info = { width: 1000, height: 1000, layers: [text(1, [950, 100, 200, 60]), text(2, [100, 100, 300, 60]), text(3, [120, 110, 300, 60]), text(4, [10, 500, 100, 12]), { ...text(5, [400, 400, 50, 50]), text: { text: ' ', font: 'x', sizePt: 10 } }, { ...text(6, [400, 600, 100, 50]), name: '立体-厚度 1' }] } as never;
    const codes = lintDoc(info).map((i) => `${i.code}:${i.layer}`);
    expect(codes).toContain('OUT_OF_CANVAS:1');
    expect(codes).toContain('TEXT_OVERLAP:3');
    expect(codes).toContain('EDGE_MARGIN:4');
    expect(codes).toContain('SMALL_TEXT:4');
    expect(codes).toContain('EMPTY_TEXT:5');
    expect(codes.some((c) => c.endsWith(':6'))).toBe(false);
  });
  it('contrast from pixels: dark text on dark background is flagged, white on dark is not', () => {
    const W = 100, H = 60, px = new Uint8Array(W * H * 4);
    const paint = (glyph: number) => { for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 4; const g = x >= 30 && x < 70 && y >= 20 && y < 40 && (x + y) % 3 === 0; px.set(g ? [glyph, glyph, glyph, 255] : [20, 20, 30, 255], i); } };
    paint(40);
    expect(textContrast({ width: W, height: H, pixels: px.buffer }, 1, [30, 20, 40, 20])!).toBeLessThan(3);
    paint(250);
    expect(textContrast({ width: W, height: H, pixels: px.buffer }, 1, [30, 20, 40, 20])!).toBeGreaterThan(7);
    expect(contrastRatio(1, 0)).toBe(21);
  });
  it('capture rect pads, snaps to a supported ratio and stays in the canvas', () => {
    const c = captureRect({ x: 380, y: 280, w: 100, h: 100 }, 800, 600);
    expect(c.aspectRatio).toBe('1:1');
    expect(c.rect).toEqual([355, 255, 150, 150]);
    const edge = captureRect({ x: 700, y: 0, w: 100, h: 300 }, 800, 600);
    expect(edge.rect[0] + edge.rect[2]).toBeLessThanOrEqual(800);
    expect(edge.rect[1]).toBeGreaterThanOrEqual(0);
    expect(['1:1', '2:3', '3:4', '9:16']).toContain(edge.aspectRatio);
  });
  it('filter catalog matches the editor table; values are clamped', () => {
    expect(Object.keys(FILTER_IDS).sort()).toEqual(FILTERS.map(filterId).sort());
    const batch = EDIT_BATCH.filter_apply({ filter: 'filter.blur.radialBlur#zoom', layer: 2, values: { amount: 900 } });
    expect(batch[1]).toEqual({ cmd: 'filter.blur.radialBlur', params: { amount: 100, method: 'zoom', quality: 'good' } });
    expect(validateCall('layout_apply', { items: [{ layer: 1, box: [0.1, 0.1, 0.8, 0.2], align: 'center' }] }).ok).toBe(true);
    expect(validateCall('layout_apply', { items: [{ layer: 1, box: [0.1, 0.1, 1.8, 0.2] }] }).ok).toBe(false);
  });
});
