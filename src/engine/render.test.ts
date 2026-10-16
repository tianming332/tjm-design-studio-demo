import { describe, expect, it } from 'vitest';
import { clipDamage } from './render';

describe('clipDamage', () => {
  it('keeps a rect that is fully inside', () => {
    expect(clipDamage({ x: 10, y: 20, w: 30, h: 40 }, 100, 100)).toEqual({ x: 10, y: 20, w: 30, h: 40 });
  });
  it('moves the origin to 0 when damage starts past the top-left edge', () => {
    // Engine damage [-530,-682,1587,1435] on a 1057x752 document (a smart-object commit).
    expect(clipDamage({ x: -530, y: -682, w: 2117, h: 2117 }, 1057, 752)).toEqual({ x: 0, y: 0, w: 1057, h: 752 });
  });
  it('trims the right/bottom overhang', () => {
    expect(clipDamage({ x: 90, y: 95, w: 50, h: 50 }, 100, 100)).toEqual({ x: 90, y: 95, w: 10, h: 5 });
  });
  it('returns null when nothing is on the canvas', () => {
    expect(clipDamage({ x: -50, y: 0, w: 40, h: 10 }, 100, 100)).toBeNull();
    expect(clipDamage({ x: 200, y: 0, w: 40, h: 10 }, 100, 100)).toBeNull();
    expect(clipDamage({ x: 0, y: 0, w: 0, h: 10 }, 100, 100)).toBeNull();
  });
});
