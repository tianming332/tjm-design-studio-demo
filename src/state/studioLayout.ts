import { create } from 'zustand';

export interface ToolWindow { x: number; y: number; width: number; height: number }
interface StudioLayout { agentShare: number; tools?: ToolWindow; propertiesShare: number; showProperties: boolean; showLayers: boolean }
const KEY = 'tjm.ai-panel-layout.v1';
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
export function parseStudioLayout(raw: unknown): StudioLayout {
  const p = raw && typeof raw === 'object' ? raw as Partial<StudioLayout> : {};
  const valid = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  const t = p.tools;
  return {
    agentShare: valid(p.agentShare) ? clamp(p.agentShare, 30, 55) : 43,
    propertiesShare: valid(p.propertiesShare) ? clamp(p.propertiesShare, 20, 65) : 42,
    // Canvas properties / layers windows are toggled from two icons in the canvas header.
    showProperties: p.showProperties !== false,
    showLayers: p.showLayers !== false,
    ...(t && [t.x, t.y, t.width, t.height].every(valid) ? { tools: { x: Math.max(0, t.x), y: Math.max(0, t.y), width: clamp(t.width, 220, 380), height: clamp(t.height, 280, 1000) } } : {}),
  };
}
function initial() { try { return parseStudioLayout(JSON.parse(localStorage.getItem(KEY) ?? 'null')); } catch { return parseStudioLayout(null); } }
export function fitToolWindow(saved: ToolWindow | undefined, w: number, h: number): ToolWindow {
  const width = Math.min(saved?.width ?? 248, Math.max(160, w - 16));
  const height = Math.min(saved?.height ?? 640, Math.max(180, h - 16));
  return { x: clamp(saved?.x ?? w - width - 8, 0, Math.max(0, w - width)), y: clamp(saved?.y ?? 8, 0, Math.max(0, h - height)), width, height };
}
export const useStudioLayout = create<StudioLayout & { error?: string; update(p: Partial<StudioLayout>): void; reset(): void }>((set, get) => ({
  ...initial(),
  update(p) {
    const next = parseStudioLayout({ ...get(), ...p });
    set(next);
    try { localStorage.setItem(KEY, JSON.stringify(next)); set({ error: undefined }); }
    catch { set({ error: '布局已调整，但未能保存到本地。' }); }
  },
  reset() { set({ ...parseStudioLayout(null), tools: undefined }); get().update({ tools: undefined }); },
}));
