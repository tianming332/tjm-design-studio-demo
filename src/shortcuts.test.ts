import { describe, expect, it } from 'vitest';
import { comboLabel, isBrowserReserved, matchShortcut, shouldBlockBrowser, SHORTCUTS, type KeyLike } from './shortcuts';

const k = (code: string, m: Partial<KeyLike> = {}): KeyLike => ({ code, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...m });

describe('shortcuts', () => {
  it('matches Ctrl and Cmd alike, honouring Shift/Alt exactly', () => {
    expect(matchShortcut(k('KeyJ', { ctrlKey: true }))?.action).toBe('layerViaCopy');
    expect(matchShortcut(k('KeyJ', { metaKey: true, shiftKey: true }))?.action).toBe('layerViaCut');
    expect(matchShortcut(k('KeyV', { ctrlKey: true, shiftKey: true, altKey: true }))?.action).toBe('pasteInto');
    expect(matchShortcut(k('KeyT', { ctrlKey: true }))?.action).toBe('freeTransform');
    expect(matchShortcut(k('KeyJ'))).toBeUndefined();
    expect(matchShortcut(k('Backspace', { altKey: true }))?.action).toBe('fillForeground');
  });
  it('has no duplicate combos', () => {
    const seen = new Set(SHORTCUTS.map((s) => `${s.key}|${!!s.mod}|${!!s.shift}|${!!s.alt}`));
    expect(seen.size).toBe(SHORTCUTS.length);
  });
  it('blocks browser defaults for app combos but not inside text fields or devtools', () => {
    expect(shouldBlockBrowser(k('KeyS', { ctrlKey: true }), false)).toBe(true);
    expect(shouldBlockBrowser(k('KeyP', { ctrlKey: true }), false)).toBe(true); // unmapped: still ours
    expect(shouldBlockBrowser(k('KeyC', { ctrlKey: true }), true)).toBe(false);
    expect(shouldBlockBrowser(k('F12'), false)).toBe(false);
    expect(shouldBlockBrowser(k('KeyI', { metaKey: true, altKey: true }), false)).toBe(false);
    expect(shouldBlockBrowser(k('KeyB'), false)).toBe(false);
  });
  it('knows which combos Chrome keeps (per platform)', () => {
    expect(isBrowserReserved(k('KeyT', { ctrlKey: true }), false)).toBe(true);
    expect(isBrowserReserved(k('KeyT', { ctrlKey: true }), true)).toBe(false);
    expect(isBrowserReserved(k('KeyT', { metaKey: true }), true)).toBe(true);
    expect(isBrowserReserved(k('KeyJ', { ctrlKey: true }), false)).toBe(false);
  });
  it('labels combos per platform', () => {
    const cut = SHORTCUTS.find((s) => s.action === 'layerViaCut')!;
    expect(comboLabel(cut, true)).toBe('⌘+Shift+J');
    expect(comboLabel(cut, false)).toBe('Ctrl+Shift+J');
  });
});
