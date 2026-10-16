import { describe, expect, it } from 'vitest';
import { detectDevice, effectiveDevice } from './touch';
import { DEVICE_LAYOUTS, PRESETS, parseLayout } from './layout';

const env = (coarse: boolean, w: number, h: number, maxTouchPoints = coarse ? 5 : 0) => ({
  matchMedia: (q: string) => ({ matches: q === '(pointer: coarse)' && coarse }) as MediaQueryList,
  innerWidth: w, innerHeight: h, navigator: { maxTouchPoints },
});

describe('touch device detection', () => {
  it('desktop, iPad (incl. desktop-mode Safari via touch points) and phone', () => {
    expect(detectDevice(env(false, 1440, 900))).toBe('desktop');
    expect(detectDevice(env(true, 1180, 820))).toBe('tablet');
    expect(detectDevice(env(false, 1180, 820, 5))).toBe('tablet');
    expect(detectDevice(env(true, 390, 844))).toBe('phone');
    expect(detectDevice(env(true, 844, 390))).toBe('phone'); // landscape phone
  });
  it('a chosen layout overrides the hardware', () => {
    expect(effectiveDevice({ device: 'auto', detected: 'tablet' })).toBe('tablet');
    expect(effectiveDevice({ device: 'phone', detected: 'desktop' })).toBe('phone');
  });
  it('iPad / 手机 layouts exist and survive the stored-layout parser', () => {
    for (const name of Object.keys(DEVICE_LAYOUTS)) {
      const l = PRESETS[name];
      expect(l).toBeTruthy();
      expect(parseLayout(JSON.parse(JSON.stringify(l))).dock.map((g) => g.panels)).toEqual(l.dock.map((g) => g.panels));
    }
    expect(PRESETS['手机布局'].dock).toHaveLength(1);
  });
});
