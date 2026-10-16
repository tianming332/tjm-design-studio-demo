import { create } from 'zustand';

export const COLOR_PALETTES = [
  { name: '精选', colors: ['#151b28', '#384b63', '#6488ae', '#b8ccdc', '#eff3f6', '#f9f6f0', '#cbb89e', '#947e67', '#345b53', '#93b4a5', '#d9e6df', '#dba68c'] },
  { name: '科技', colors: ['#0f172a', '#1e293b', '#334155', '#64748b', '#cbd5e1', '#f1f5f9', '#245cdd', '#668cf0', '#b7c9ff', '#16686d', '#45a7af', '#c3ebee'] },
  { name: '自然', colors: ['#223b32', '#456452', '#75917b', '#afc1a6', '#e5eadb', '#f6f3e8', '#705744', '#ac8962', '#d1b78f', '#665d78', '#a69cb1', '#e5dce9'] },
  { name: '暖调', colors: ['#552b31', '#8b4249', '#bc7472', '#e6b0a0', '#f6d9c9', '#fff4e6', '#794b30', '#b87848', '#d8a363', '#e5c791', '#a69a74', '#e8e0cc'] },
  { name: '基础', colors: ['#000000', '#333333', '#666666', '#999999', '#cccccc', '#ffffff', '#e5484d', '#f28c38', '#eac54f', '#46a76c', '#3b82f6', '#9464d9'] },
] as const;
const KEY = 'tjm.color-palettes.v1';
export function validColors(value: unknown, limit: number): string[] {
  return Array.isArray(value) ? [...new Set(value.filter((c): c is string => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c)).map((c) => c.toLowerCase()))].slice(0, limit) : [];
}
function load() {
  try { const p = JSON.parse(localStorage.getItem(KEY) ?? '{}'); return { favorites: validColors(p.favorites, 24), recent: validColors(p.recent, 12) }; }
  catch { return { favorites: [], recent: [] }; }
}
interface PaletteState { favorites: string[]; recent: string[]; error?: string; remember(hex: string): void; toggleFavorite(hex: string): void }
export const usePalette = create<PaletteState>((set, get) => {
  const save = (patch: Partial<Pick<PaletteState, 'favorites' | 'recent'>>) => {
    const state = { favorites: get().favorites, recent: get().recent, ...patch };
    try { localStorage.setItem(KEY, JSON.stringify(state)); set({ ...state, error: undefined }); }
    catch { set({ ...state, error: '颜色可继续使用，本次色板记录未能保存到本地。' }); }
  };
  return { ...load(),
    remember(hex) { const [color] = validColors([hex], 1); if (color) save({ recent: validColors([color, ...get().recent], 12) }); },
    toggleFavorite(hex) {
      const [color] = validColors([hex], 1); if (!color) return;
      if (get().favorites.includes(color)) save({ favorites: get().favorites.filter((c) => c !== color) });
      else if (get().favorites.length < 24) save({ favorites: [...get().favorites, color] });
      else set({ error: '最多收藏 24 个颜色，请先取消一个收藏。' });
    },
  };
});
