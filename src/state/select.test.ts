import { describe, expect, it } from 'vitest';
import { multiSelect } from './store';

describe('multiSelect', () => {
  it('replaces selection when not additive', () => {
    expect(multiSelect([1, 2, 3], 5, false)).toEqual([5]);
    expect(multiSelect([], 5, false)).toEqual([5]);
  });
  it('adds when additive and not present', () => {
    expect(multiSelect([1, 2], 3, true)).toEqual([1, 2, 3]);
  });
  it('toggles off when additive and present', () => {
    expect(multiSelect([1, 2, 3], 2, true)).toEqual([1, 3]);
  });
});
