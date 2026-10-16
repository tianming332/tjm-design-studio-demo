import { describe, expect, it } from 'vitest';
import { DEFAULT_APPEARANCE, parsePreferences, resolveTheme } from './appearance';

describe('appearance preferences (separate from document state)', () => {
  it('defaults to the system appearance', () => {
    expect(parsePreferences(null)).toEqual(DEFAULT_APPEARANCE);
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('system', true)).toBe('dark');
  });
  it('honours explicit light and dark overrides', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });
  it.each(['{', 'null', 'false', '"dark"', '42'])('recovers from malformed preferences: %s', (raw) => {
    expect(parsePreferences(raw)).toEqual(DEFAULT_APPEARANCE);
  });
  it('accepts only known themes, colours, and background positions', () => {
    const p = parsePreferences(JSON.stringify({ theme: 'blue', background: 'video', color: 'url(http://example.test)', colorEnd: '#c0ffee', position: 'outside' }));
    expect(p.theme).toBe('system'); expect(p.background).toBe('default');
    expect(p.color).toBe(DEFAULT_APPEARANCE.color); expect(p.colorEnd).toBe('#c0ffee'); expect(p.position).toBe('center');
  });
  it('clamps numeric settings and rejects wrong types', () => {
    const p = parsePreferences('{"panelWidth":2000,"strength":-50,"reducedMotion":"true","lowOverhead":true}');
    expect(p.panelWidth).toBe(400); expect(p.strength).toBe(0);
    expect(p.reducedMotion).toBe(false); expect(p.lowOverhead).toBe(true);
    expect(parsePreferences('{"panelWidth":"320","strength":"80"}').panelWidth).toBe(300);
  });
  it('does not preserve document fields or image data in preferences', () => {
    const p = parsePreferences('{"theme":"dark","imageName":"local.png","layers":[{}],"imageUrl":"data:image/png;base64,large"}');
    expect(p).not.toHaveProperty('layers'); expect(p).not.toHaveProperty('imageUrl'); expect(p.imageName).toBe('local.png');
  });
});
