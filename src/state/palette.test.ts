import { afterEach, describe, expect, it, vi } from 'vitest';
import { COLOR_PALETTES, usePalette, validColors } from './palette';
afterEach(() => vi.unstubAllGlobals());
describe('color library', () => {
  it('ships valid curated colors and drops corrupt/duplicate stored values', () => {
    for (const palette of COLOR_PALETTES) expect(validColors(palette.colors, 20)).toHaveLength(12);
    expect(validColors(['#AABBCC', '#aabbcc', 'red', null, '#112233'], 12)).toEqual(['#aabbcc', '#112233']);
    expect(validColors(null, 12)).toEqual([]);
  });
  it('keeps most recent colors first without duplicate entries', () => {
    vi.stubGlobal('localStorage', { setItem: vi.fn() });
    usePalette.setState({ recent: [], favorites: [], error: undefined });
    for (let i = 0; i < 20; i++) usePalette.getState().remember(`#${i.toString(16).padStart(6, '0')}`);
    usePalette.getState().remember('#00000A');
    expect(usePalette.getState().recent).toHaveLength(12);
    expect(usePalette.getState().recent[0]).toBe('#00000a');
    expect(localStorage.setItem).toHaveBeenCalled();
  });
  it('toggles a favorite and caps it without evicting existing saved colors', () => {
    vi.stubGlobal('localStorage', { setItem: vi.fn() });
    usePalette.setState({ favorites: [], error: undefined });
    usePalette.getState().toggleFavorite('#ABCDEF');
    expect(usePalette.getState().favorites).toEqual(['#abcdef']);
    usePalette.getState().toggleFavorite('#abcdef');
    expect(usePalette.getState().favorites).toEqual([]);
    for (let i = 0; i < 25; i++) usePalette.getState().toggleFavorite(`#${i.toString(16).padStart(6, '0')}`);
    expect(usePalette.getState().favorites).toHaveLength(24);
    expect(usePalette.getState().error).toContain('24');
  });
  it('keeps colors usable and reports a storage failure', () => {
    vi.stubGlobal('localStorage', { setItem: () => { throw new Error('quota'); } });
    usePalette.setState({ favorites: [], error: undefined });
    usePalette.getState().toggleFavorite('#112233');
    expect(usePalette.getState().favorites).toEqual(['#112233']);
    expect(usePalette.getState().error).toContain('未能保存');
  });
});
