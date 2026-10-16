// Touch devices (iPad / phone): device detection, pen-vs-finger input, fullscreen on first touch
// and guards that keep page gestures (pinch zoom, pull-to-refresh, long-press menus, edge swipes)
// from leaving the editor. The effective device lands on <html data-device> for touch.css.
import { create } from 'zustand';

export type Device = 'desktop' | 'tablet' | 'phone';
export type DeviceChoice = 'auto' | Device;
interface TouchPrefs {
  /** Layout chosen in 窗口 › 面板布局 or 设置; 'auto' follows the hardware. */
  device: DeviceChoice;
  /** Request fullscreen on the first touch (iPad / Android; iPhone Safari cannot). */
  autoFullscreen: boolean;
  /** Once a stylus has been used: the pen draws, a finger pans / zooms (palm rejection). */
  penDraws: boolean;
}
interface TouchState extends TouchPrefs {
  detected: Device;
  /** Last input type on the page and whether a stylus has been seen this session. */
  input: 'mouse' | 'touch' | 'pen';
  penSeen: boolean;
  setPrefs(p: Partial<TouchPrefs>): void;
}

const KEY = 'tjm.touch.v1';
const DEFAULTS: TouchPrefs = { device: 'auto', autoFullscreen: true, penDraws: true };

export function detectDevice(win: Pick<Window, 'matchMedia' | 'innerWidth' | 'innerHeight'> & { navigator: { maxTouchPoints?: number } } = window): Device {
  const coarse = !!win.matchMedia?.('(pointer: coarse)').matches;
  const touch = coarse || (win.navigator.maxTouchPoints ?? 0) > 1;
  if (!touch) return 'desktop';
  return Math.min(win.innerWidth, win.innerHeight) < 600 ? 'phone' : 'tablet';
}

function load(): TouchPrefs {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<TouchPrefs>;
    return {
      device: ['auto', 'desktop', 'tablet', 'phone'].includes(p.device as string) ? p.device as DeviceChoice : 'auto',
      autoFullscreen: p.autoFullscreen !== false,
      penDraws: p.penDraws !== false,
    };
  } catch { return DEFAULTS; }
}

export const useTouch = create<TouchState>((set, get) => ({
  ...(typeof window === 'undefined' ? DEFAULTS : load()),
  detected: typeof window === 'undefined' ? 'desktop' : detectDevice(),
  input: 'mouse',
  penSeen: false,
  setPrefs(p) {
    set(p);
    const { device, autoFullscreen, penDraws } = get();
    try { localStorage.setItem(KEY, JSON.stringify({ device, autoFullscreen, penDraws })); } catch { /* storage blocked */ }
    applyDevice();
  },
}));

export const effectiveDevice = (s: Pick<TouchState, 'device' | 'detected'> = useTouch.getState()): Device => s.device === 'auto' ? s.detected : s.device;
export const isTouchUI = () => effectiveDevice() !== 'desktop';

export function applyDevice() {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.device = effectiveDevice();
}

type FsDoc = Document & { webkitFullscreenElement?: Element; webkitExitFullscreen?: () => Promise<void> };
type FsEl = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> };
export const isFullscreen = () => !!(document.fullscreenElement || (document as FsDoc).webkitFullscreenElement);
export const fullscreenSupported = () => !!(document.documentElement.requestFullscreen || (document.documentElement as FsEl).webkitRequestFullscreen);
export async function setFullscreen(on: boolean) {
  try {
    if (on && !isFullscreen()) {
      const el = document.documentElement as FsEl;
      await (el.requestFullscreen ? el.requestFullscreen({ navigationUI: 'hide' }) : el.webkitRequestFullscreen?.());
    } else if (!on && isFullscreen()) {
      const d = document as FsDoc;
      await (d.exitFullscreen ? d.exitFullscreen() : d.webkitExitFullscreen?.());
    }
  } catch { /* the browser refused (no user gesture / unsupported) */ }
}

const editable = (t: EventTarget | null) => t instanceof HTMLElement && (['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) || t.isContentEditable);

let installed = false;
/** Global listeners; safe to call once at start-up. */
export function installTouch(onFullscreenHint?: () => void) {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  applyDevice();
  const redetect = () => { useTouch.setState({ detected: detectDevice() }); applyDevice(); };
  window.addEventListener('resize', redetect);
  window.addEventListener('orientationchange', redetect);

  let askedFullscreen = false;
  window.addEventListener('pointerdown', (e) => {
    const input = e.pointerType === 'pen' ? 'pen' : e.pointerType === 'touch' ? 'touch' : 'mouse';
    const s = useTouch.getState();
    if (s.input !== input || (input === 'pen' && !s.penSeen)) useTouch.setState({ input, ...(input === 'pen' ? { penSeen: true } : {}) });
    // Fullscreen needs a user gesture: the first touch after entering the editor provides one.
    if (input !== 'mouse' && isTouchUI() && s.autoFullscreen && !askedFullscreen && !isFullscreen()) {
      askedFullscreen = true;
      if (fullscreenSupported()) void setFullscreen(true);
      else onFullscreenHint?.();
    }
  }, { capture: true, passive: true });

  // Page pinch-zoom / double-tap zoom (iOS Safari ignores user-scalable=no).
  const stop = (e: Event) => { if (isTouchUI()) e.preventDefault(); };
  document.addEventListener('gesturestart', stop, { passive: false });
  document.addEventListener('gesturechange', stop, { passive: false });
  document.addEventListener('touchmove', (e) => {
    if (!isTouchUI()) return;
    // Two or more fingers never scroll / zoom the page; one finger only scrolls real scroll areas.
    if (e.touches.length > 1) { e.preventDefault(); return; }
    const t = e.target as HTMLElement | null;
    if (t?.closest('.canvas-wrap')) e.preventDefault();
  }, { passive: false });
  // Swipes that start at the screen edge would trigger browser back / forward on the canvas.
  document.addEventListener('touchstart', (e) => {
    if (!isTouchUI() || e.touches.length !== 1) return;
    const x = e.touches[0].clientX;
    if ((x < 24 || x > window.innerWidth - 24) && (e.target as HTMLElement | null)?.closest('.canvas-wrap')) e.preventDefault();
  }, { passive: false });
  // Long-press menus / callouts outside text fields.
  document.addEventListener('contextmenu', (e) => {
    if (isTouchUI() && useTouch.getState().input !== 'mouse' && !editable(e.target) && !(e.target as HTMLElement | null)?.closest('.canvas-wrap')) e.preventDefault();
  });
}
