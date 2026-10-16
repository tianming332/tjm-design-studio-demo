import { create } from 'zustand';

export type ThemeMode = 'system' | 'light' | 'dark';
export type BackgroundKind = 'default' | 'color' | 'gradient' | 'image';
export interface AppearancePreferences {
  theme: ThemeMode;
  background: BackgroundKind;
  color: string;
  colorEnd: string;
  strength: number;
  position: string;
  imageName: string;
  reducedMotion: boolean;
  lowOverhead: boolean;
  panelWidth: number;
  /** Enter work mode (fullscreen + keyboard lock) on the first canvas click. */
  autoWorkMode: boolean;
}
export const APPEARANCE_KEY = 'tjm.appearance.v1';
export const DEFAULT_APPEARANCE: AppearancePreferences = {
  theme: 'system', background: 'default', color: '#B9C9D7', colorEnd: '#E9DDD0',
  strength: 60, position: 'center', imageName: '', reducedMotion: false, lowOverhead: false, panelWidth: 300, autoWorkMode: false,
};
export function parsePreferences(raw: string | null): AppearancePreferences {
  try {
    const p = JSON.parse(raw ?? '{}');
    if (!p || typeof p !== 'object') return { ...DEFAULT_APPEARANCE };
    const hex = (s: unknown, fallback: string) => typeof s === 'string' && /^#[a-f\d]{6}$/i.test(s) ? s : fallback;
    return {
      theme: ['system', 'light', 'dark'].includes(p.theme) ? p.theme : 'system',
      background: ['default', 'color', 'gradient', 'image'].includes(p.background) ? p.background : 'default',
      color: hex(p.color, DEFAULT_APPEARANCE.color), colorEnd: hex(p.colorEnd, DEFAULT_APPEARANCE.colorEnd),
      strength: typeof p.strength === 'number' && Number.isFinite(p.strength) ? Math.max(0, Math.min(100, p.strength)) : 60,
      position: ['center', 'top', 'bottom'].includes(p.position) ? p.position : 'center',
      imageName: typeof p.imageName === 'string' ? p.imageName.slice(0, 200) : '',
      reducedMotion: p.reducedMotion === true, lowOverhead: p.lowOverhead === true,
      panelWidth: typeof p.panelWidth === 'number' && Number.isFinite(p.panelWidth) ? Math.max(260, Math.min(400, p.panelWidth)) : 300,
      autoWorkMode: p.autoWorkMode === true,
    };
  } catch { return { ...DEFAULT_APPEARANCE }; }
}
export function resolveTheme(mode: ThemeMode, dark: boolean): 'light' | 'dark' {
  return mode === 'system' ? (dark ? 'dark' : 'light') : mode;
}
let initial = { ...DEFAULT_APPEARANCE };
try { if (typeof window !== 'undefined') initial = parsePreferences(window.localStorage.getItem(APPEARANCE_KEY)); } catch { /* private/storage-restricted browsing */ }

interface AppearanceState {
  preferences: AppearancePreferences;
  resolvedTheme: 'light' | 'dark';
  imageUrl?: string;
  error?: string;
  settingsOpen: boolean;
  focus: boolean;
  drawerOpen: boolean;
  inspector: 'properties' | 'adjustments' | 'more' | 'history';
  update: (p: Partial<AppearancePreferences>) => boolean;
}
export const useAppearance = create<AppearanceState>((set, get) => ({
  preferences: initial, resolvedTheme: 'light', settingsOpen: false, focus: false, drawerOpen: false, inspector: 'properties',
  update(p) {
    const preferences = { ...get().preferences, ...p };
    // Keep the old preference on failure; never pretend that an unsaved setting was saved.
    try {
      localStorage.setItem(APPEARANCE_KEY, JSON.stringify(preferences));
      set({ preferences, error: undefined });
      return true;
    } catch {
      set({ error: '无法保存外观设置。请检查浏览器的本地存储权限后重试；文档不受影响。' });
      return false;
    }
  },
}));
