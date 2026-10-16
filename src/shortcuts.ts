// Application keyboard shortcuts (Photoshop layout) and the browser-conflict policy.
// Pure: the table, matching and blocking decisions are unit-tested; App.tsx dispatches.

/** Store actions a shortcut can run (resolved in App.tsx). */
export type ShortcutAction =
  | 'undo' | 'redo' | 'freeTransform'
  | 'layerViaCopy' | 'layerViaCut' | 'copy' | 'copyMerged' | 'cut' | 'paste' | 'pasteInPlace' | 'pasteInto'
  | 'selectAll' | 'deselect' | 'reselect' | 'inverse'
  | 'group' | 'mergeDown' | 'mergeVisible' | 'newLayer'
  | 'save' | 'open' | 'zoomIn' | 'zoomOut' | 'fitView' | 'actualPixels'
  | 'bringForward' | 'sendBackward' | 'bringToFront' | 'sendToBack'
  | 'toggleRulers' | 'fillForeground' | 'fillBackground' | 'search';

export interface Shortcut { key: string; mod?: boolean; shift?: boolean; alt?: boolean; action: ShortcutAction; label: string }

/** `mod` = Cmd on macOS or Ctrl anywhere (both are accepted, so Ctrl+T works on a Mac without
 *  the browser grabbing it). Keys are `KeyboardEvent.code` values, so layouts and Shift don't
 *  change them. */
export const SHORTCUTS: Shortcut[] = [
  { key: 'KeyZ', mod: true, action: 'undo', label: '还原' },
  { key: 'KeyZ', mod: true, shift: true, action: 'redo', label: '重做' },
  { key: 'KeyT', mod: true, action: 'freeTransform', label: '自由变换' },
  { key: 'KeyJ', mod: true, action: 'layerViaCopy', label: '通过拷贝的图层' },
  { key: 'KeyJ', mod: true, shift: true, action: 'layerViaCut', label: '通过剪切的图层' },
  { key: 'KeyC', mod: true, action: 'copy', label: '拷贝' },
  { key: 'KeyC', mod: true, shift: true, action: 'copyMerged', label: '合并拷贝' },
  { key: 'KeyX', mod: true, action: 'cut', label: '剪切' },
  { key: 'KeyV', mod: true, action: 'paste', label: '粘贴' },
  { key: 'KeyV', mod: true, shift: true, action: 'pasteInPlace', label: '原位粘贴' },
  { key: 'KeyV', mod: true, shift: true, alt: true, action: 'pasteInto', label: '贴入' },
  { key: 'KeyA', mod: true, action: 'selectAll', label: '全选' },
  { key: 'KeyD', mod: true, action: 'deselect', label: '取消选择' },
  { key: 'KeyD', mod: true, shift: true, action: 'reselect', label: '重新选择' },
  { key: 'KeyI', mod: true, shift: true, action: 'inverse', label: '反选' },
  { key: 'KeyG', mod: true, action: 'group', label: '图层编组' },
  { key: 'KeyE', mod: true, action: 'mergeDown', label: '向下合并' },
  { key: 'KeyE', mod: true, shift: true, action: 'mergeVisible', label: '合并可见图层' },
  { key: 'KeyN', mod: true, shift: true, action: 'newLayer', label: '新建图层' },
  // Chrome keeps Ctrl+Shift+N (incognito); Photoshop's "new layer without dialog" works everywhere.
  { key: 'KeyN', mod: true, shift: true, alt: true, action: 'newLayer', label: '新建图层' },
  { key: 'KeyF', mod: true, action: 'search', label: '搜索功能' },
  { key: 'KeyS', mod: true, action: 'save', label: '存储' },
  { key: 'KeyO', mod: true, action: 'open', label: '打开' },
  { key: 'Equal', mod: true, action: 'zoomIn', label: '放大' },
  { key: 'Minus', mod: true, action: 'zoomOut', label: '缩小' },
  { key: 'Digit0', mod: true, action: 'fitView', label: '按屏幕大小缩放' },
  { key: 'Digit1', mod: true, action: 'actualPixels', label: '100%' },
  { key: 'BracketRight', mod: true, action: 'bringForward', label: '前移一层' },
  { key: 'BracketLeft', mod: true, action: 'sendBackward', label: '后移一层' },
  { key: 'BracketRight', mod: true, shift: true, action: 'bringToFront', label: '置为顶层' },
  { key: 'BracketLeft', mod: true, shift: true, action: 'sendToBack', label: '置为底层' },
  { key: 'KeyR', mod: true, action: 'toggleRulers', label: '标尺' },
  { key: 'Backspace', alt: true, action: 'fillForeground', label: '填充前景色' },
  { key: 'Delete', alt: true, action: 'fillForeground', label: '填充前景色' },
  { key: 'Backspace', mod: true, action: 'fillBackground', label: '填充背景色' },
  { key: 'Delete', mod: true, action: 'fillBackground', label: '填充背景色' },
];

export interface KeyLike { code: string; key?: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }

export function matchShortcut(e: KeyLike, table: Shortcut[] = SHORTCUTS): Shortcut | undefined {
  const mod = e.metaKey || e.ctrlKey;
  return table.find((s) => s.key === e.code && !!s.mod === mod && !!s.shift === e.shiftKey && !!s.alt === e.altKey);
}

/** Chrome keeps these for itself: a page never sees them unless Keyboard Lock is active
 *  (fullscreen + `navigator.keyboard.lock()`). */
const RESERVED = new Set(['KeyT', 'KeyW', 'KeyN', 'Tab']);
export function isBrowserReserved(e: KeyLike, mac = isMacLike()): boolean {
  // On macOS Chrome reserves ⌘+T/W/N, not Ctrl+…; elsewhere it is Ctrl.
  const primary = mac ? e.metaKey : e.ctrlKey;
  return primary && RESERVED.has(e.code);
}

/** Keys the browser must keep even inside the app: developer tools, quitting/hiding the app,
 *  fullscreen toggles. */
function isEscapeHatch(e: KeyLike): boolean {
  if (e.code === 'F12') return true;
  if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.code === 'KeyI' && e.altKey)) return true;
  if ((e.metaKey || e.ctrlKey) && e.altKey && e.code === 'KeyI') return true; // DevTools (macOS)
  if (e.metaKey && (e.code === 'KeyQ' || e.code === 'KeyH' || e.code === 'KeyM')) return true;
  return false;
}

/**
 * Should the browser's default for this key be suppressed? Every Ctrl/Cmd combination outside a
 * text field belongs to the editor (Ctrl+S must not "save page", Ctrl+R must not reload, Ctrl+P
 * must not print …), plus Backspace / Alt+Backspace fills. Text fields keep native editing.
 */
export function shouldBlockBrowser(e: KeyLike, typing: boolean): boolean {
  if (typing || isEscapeHatch(e)) return false;
  if (matchShortcut(e)) return true;
  return e.metaKey || e.ctrlKey;
}

export function isMacLike(): boolean {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent);
}

/** Human-readable combo for tooltips: ⌘ on macOS, Ctrl elsewhere. */
export function comboLabel(s: Shortcut, mac = isMacLike()): string {
  const key = s.key.replace(/^Key|^Digit/, '').replace('Equal', '+').replace('Minus', '−').replace('BracketLeft', '[').replace('BracketRight', ']');
  return [s.mod ? (mac ? '⌘' : 'Ctrl') : '', s.shift ? 'Shift' : '', s.alt ? (mac ? '⌥' : 'Alt') : '', key].filter(Boolean).join('+');
}
