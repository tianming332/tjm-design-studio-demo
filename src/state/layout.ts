// Workspace layout (A30): dockable / floating panels, lock, saved workspaces.
// The reducers are pure (unit-tested); the store persists to localStorage.
import { create } from 'zustand';

export type PanelId = 'properties' | 'task' | 'adjustments' | 'more' | 'history' | 'layers' | 'agent' | 'generate' | 'assets';
export const PANEL_TITLES: Record<PanelId, string> = {
  properties: '属性', task: '场景工具', adjustments: '调整与效果', more: '选区与路径', history: '历史', layers: '图层', agent: 'AI 制图', generate: '生成素材', assets: '素材库',
};
export const ALL_PANELS: PanelId[] = ['properties', 'task', 'adjustments', 'more', 'history', 'layers', 'agent', 'generate', 'assets'];
export const PANEL_DESCRIPTIONS: Record<PanelId, string> = {
  properties: '文档、当前图层和工具参数', task: '海报排版或照片处理的快捷工具',
  adjustments: '滤镜、调整图层与图层样式', more: '选区、路径、通道与参考线',
  history: '查看编辑记录并撤销', layers: '管理文字、图片和形状图层',
  agent: '理解需求，在文档中完成可编辑设计', generate: '生成图片素材，再放入画布',
  assets: '上传、浏览和复用图片素材',
};

export interface PanelGroup { id: string; panels: PanelId[]; active: PanelId; collapsed?: boolean; size?: number }
export interface FloatGroup extends PanelGroup { x: number; y: number; w: number; h: number }
export interface Layout {
  dock: PanelGroup[];
  floating: FloatGroup[];
  toolbarSide: 'left' | 'right';
  dockSide: 'left' | 'right';
}

let seq = 0;
const gid = () => `g${Date.now().toString(36)}${(seq++).toString(36)}`;

export const PRESETS: Record<string, Layout> = {
  基本功能: {
    dock: [
      { id: 'g-main', panels: ['properties', 'task', 'adjustments', 'more', 'agent', 'generate', 'assets'], active: 'properties' },
      { id: 'g-layers', panels: ['layers', 'history'], active: 'layers' },
    ],
    floating: [], toolbarSide: 'left', dockSide: 'right',
  },
  绘画: {
    dock: [
      { id: 'g-adj', panels: ['adjustments', 'history'], active: 'adjustments' },
      { id: 'g-layers', panels: ['layers', 'properties'], active: 'layers' },
    ],
    floating: [], toolbarSide: 'left', dockSide: 'right',
  },
  排版与设计: {
    dock: [
      { id: 'g-props', panels: ['properties', 'more'], active: 'properties' },
      { id: 'g-layers', panels: ['layers', 'history'], active: 'layers' },
    ],
    floating: [{ id: 'g-adj', panels: ['adjustments'], active: 'adjustments', x: 80, y: 120, w: 300, h: 420 }],
    toolbarSide: 'left', dockSide: 'right',
  },
};
export const DEFAULT_WORKSPACE = '基本功能';

const clone = (l: Layout): Layout => JSON.parse(JSON.stringify(l));

/** Removes a panel from wherever it is; empty groups disappear. */
export function detach(l: Layout, p: PanelId): Layout {
  const strip = <G extends PanelGroup>(gs: G[]) => gs
    .map((g) => {
      if (!g.panels.includes(p)) return g;
      const panels = g.panels.filter((x) => x !== p);
      return { ...g, panels, active: g.active === p ? panels[0] : g.active };
    })
    .filter((g) => g.panels.length > 0);
  return { ...l, dock: strip(l.dock), floating: strip(l.floating) };
}

/** Where a dragged panel tab can land. */
export type DropTarget =
  | { kind: 'group'; group: string }              // into an existing group's tab bar
  | { kind: 'dock'; index: number }               // a new docked group at this index
  | { kind: 'float'; x: number; y: number };      // a new floating window

export function movePanel(l0: Layout, p: PanelId, t: DropTarget): Layout {
  const inGroup = [...l0.dock, ...l0.floating].find((g) => g.panels.includes(p));
  if (t.kind === 'group' && inGroup?.id === t.group && inGroup.panels.length === 1) return l0;
  let l = detach(clone(l0), p);
  if (t.kind === 'group') {
    const add = <G extends PanelGroup>(gs: G[]) => gs.map((g) => (g.id === t.group ? { ...g, panels: [...g.panels, p], active: p, collapsed: false } : g));
    const found = [...l.dock, ...l.floating].some((g) => g.id === t.group);
    if (found) return { ...l, dock: add(l.dock), floating: add(l.floating) };
    l = { ...l, dock: [...l.dock, { id: gid(), panels: [p], active: p }] };
    return l;
  }
  if (t.kind === 'dock') {
    const dock = [...l.dock];
    dock.splice(Math.max(0, Math.min(dock.length, t.index)), 0, { id: gid(), panels: [p], active: p });
    return { ...l, dock };
  }
  return { ...l, floating: [...l.floating, { id: gid(), panels: [p], active: p, x: Math.round(t.x), y: Math.round(t.y), w: 300, h: 380 }] };
}

/** Floating window → docked group (or back), keeping its tabs together. */
export function dockGroup(l: Layout, id: string, index = l.dock.length): Layout {
  const g = l.floating.find((x) => x.id === id);
  if (!g) return l;
  const dock = [...l.dock];
  dock.splice(Math.max(0, Math.min(dock.length, index)), 0, { id: g.id, panels: g.panels, active: g.active });
  return { ...l, dock, floating: l.floating.filter((x) => x.id !== id) };
}

export function floatGroup(l: Layout, id: string, x: number, y: number): Layout {
  const g = l.dock.find((d) => d.id === id);
  if (!g) return l;
  return { ...l, dock: l.dock.filter((d) => d.id !== id), floating: [...l.floating, { ...g, x, y, w: 300, h: 380 }] };
}

export function updateGroup(l: Layout, id: string, patch: Partial<FloatGroup>): Layout {
  return {
    ...l,
    dock: l.dock.map((g) => (g.id === id ? { ...g, ...patch } : g)),
    floating: l.floating.map((g) => (g.id === id ? { ...g, ...patch } : g)),
  };
}

/** Panels not shown anywhere (closed by the user); reopened from the 窗口 menu. */
export const hiddenPanels = (l: Layout): PanelId[] => ALL_PANELS.filter((p) => ![...l.dock, ...l.floating].some((g) => g.panels.includes(p)));

/** Show (or bring to front) a panel: activate it where it is, else dock it as a new group. */
export function showPanel(l: Layout, p: PanelId): Layout {
  const g = [...l.dock, ...l.floating].find((x) => x.panels.includes(p));
  if (g) return updateGroup(l, g.id, { active: p, collapsed: false });
  // Reopen utilities in the main inspector rather than creating another tiny vertical group.
  const target = l.dock.find((x) => p === 'history' ? x.panels.includes('layers') : !x.panels.includes('layers'));
  if (p !== 'layers' && target) return movePanel(l, p, { kind: 'group', group: target.id });
  return movePanel(l, p, { kind: 'dock', index: l.dock.length });
}

export function closePanel(l: Layout, p: PanelId): Layout { return detach(l, p); }

/** All editing destinations stay visible; AI has dedicated top-level surfaces. */
export function visiblePanelTabs(g: PanelGroup): PanelId[] {
  return g.panels.filter((p) => p !== 'agent' && p !== 'generate');
}

/** Validates stored JSON (unknown panels dropped, bad numbers fixed); falls back to the preset. */
export function parseLayout(raw: unknown): Layout {
  const base = clone(PRESETS[DEFAULT_WORKSPACE]);
  if (!raw || typeof raw !== 'object') return base;
  const o = raw as Partial<Layout>;
  const ok = (p: unknown): p is PanelId => typeof p === 'string' && (ALL_PANELS as string[]).includes(p);
  const seen = new Set<PanelId>();
  const group = (g: Partial<FloatGroup>): PanelGroup | undefined => {
    const panels = (Array.isArray(g.panels) ? g.panels : []).filter(ok).filter((p) => (seen.has(p) ? false : (seen.add(p), true)));
    if (!panels.length) return undefined;
    return { id: typeof g.id === 'string' ? g.id : gid(), panels, active: ok(g.active) && panels.includes(g.active) ? g.active : panels[0], collapsed: !!g.collapsed, ...(typeof g.size === 'number' ? { size: g.size } : {}) };
  };
  const num = (v: unknown, d: number, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);
  const dock = (Array.isArray(o.dock) ? o.dock : []).map(group).filter((g): g is PanelGroup => !!g);
  const floating = (Array.isArray(o.floating) ? o.floating : []).map((f) => {
    const g = group(f);
    return g ? { ...g, x: num(f.x, 80, 0, 4000), y: num(f.y, 80, 0, 3000), w: num(f.w, 300, 220, 1200), h: num(f.h, 380, 120, 1600) } : undefined;
  }).filter((g): g is FloatGroup => !!g);
  if (!dock.length && !floating.length) return base;
  return { dock, floating, toolbarSide: o.toolbarSide === 'right' ? 'right' : 'left', dockSide: o.dockSide === 'left' ? 'left' : 'right' };
}

const KEY = 'tjm.workspace.v1';
interface Persisted { current: string; locked: boolean; layout: Layout; saved: Record<string, Layout> }

function load(): Persisted {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Persisted> | null;
    const saved: Record<string, Layout> = {};
    for (const [k, v] of Object.entries(p?.saved ?? {})) saved[k.slice(0, 40)] = parseLayout(v);
    return { current: typeof p?.current === 'string' ? p.current : DEFAULT_WORKSPACE, locked: p?.locked !== false, layout: parseLayout(p?.layout), saved };
  } catch {
    return { current: DEFAULT_WORKSPACE, locked: true, layout: clone(PRESETS[DEFAULT_WORKSPACE]), saved: {} };
  }
}

interface LayoutState extends Persisted {
  /** A tab being dragged (unlocked mode) and the drop target under the pointer. */
  dragging?: { panel: PanelId; x: number; y: number; target?: DropTarget };
  set(layout: Layout): void;
  setLocked(on: boolean): void;
  saveAs(name: string): void;
  switchTo(name: string): void;
  remove(name: string): void;
  reset(): void;
}

export const useLayout = create<LayoutState>((set, get) => {
  const persist = () => {
    const { current, locked, layout, saved } = get();
    try { localStorage.setItem(KEY, JSON.stringify({ current, locked, layout, saved })); } catch { /* storage blocked */ }
  };
  const initial = typeof window === 'undefined' ? { current: DEFAULT_WORKSPACE, locked: true, layout: clone(PRESETS[DEFAULT_WORKSPACE]), saved: {} } : load();
  return {
    ...initial,
    set(layout) { set({ layout }); persist(); },
    setLocked(on) { set({ locked: on }); persist(); },
    saveAs(name) {
      const n = name.trim().slice(0, 40);
      if (!n) return;
      set({ saved: { ...get().saved, [n]: clone(get().layout) }, current: n });
      persist();
    },
    switchTo(name) {
      const l = get().saved[name] ?? PRESETS[name];
      if (!l) return;
      set({ layout: clone(l), current: name });
      persist();
    },
    remove(name) {
      const saved = { ...get().saved };
      delete saved[name];
      set({ saved, ...(get().current === name ? { current: DEFAULT_WORKSPACE } : {}) });
      persist();
    },
    reset() {
      const name = get().current;
      const l = get().saved[name] ?? PRESETS[name] ?? PRESETS[DEFAULT_WORKSPACE];
      set({ layout: clone(l) });
      persist();
    },
  };
});
