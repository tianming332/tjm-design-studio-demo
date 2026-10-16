// Text effects shared by the agent tools and the panel: named presets → one
// `layer.layerStyle.replace`, warp, and the extruded 立体字 group. Preset names and their
// one-line descriptions live in the Admin tool catalog (text_fx_apply); a test keeps both in step.
import type { DocInspect, LayerNode } from './protocol';
import type { DocSession } from './session';
import { EngineError } from './session';

export type FxKind = 'dropShadow' | 'innerShadow' | 'outerGlow' | 'innerGlow' | 'stroke' | 'colorOverlay' | 'gradientOverlay' | 'satin' | 'bevelEmboss';
export interface FxEffect { kind: FxKind; params: Record<string, unknown> }
/** u = the text's size in document pixels; colours are #RRGGBB. */
export interface FxContext { u: number; color?: string; accent?: string }
type Batch = { cmd: string; params?: object }[];

const r = (v: number) => Math.max(1, Math.round(v));
const hex = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
/** f < 0 darkens toward black, f > 0 lightens toward white. */
export function shade(color: string, f: number): string {
  const c = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
  return `#${c.map((v) => hex(f < 0 ? v * (1 + f) : v + (255 - v) * f)).join('')}`;
}

export const TEXT_FX_PRESETS: Record<string, { label: string; build: (c: FxContext) => FxEffect[] }> = {
  outline: { label: '粗描边', build: (c) => [{ kind: 'stroke', params: { size: r(c.u * 0.08), position: 'outside', color: c.accent ?? '#ffffff' } }] },
  'double-outline': { label: '双层描边', build: (c) => [
    { kind: 'stroke', params: { size: r(c.u * 0.06), position: 'outside', color: c.accent ?? '#ffffff' } },
    { kind: 'outerGlow', params: { color: c.color ?? '#111111', opacity: 100, blend: 'normal', technique: 'precise', spread: 100, size: r(c.u * 0.13) } }] },
  shadow: { label: '柔和投影', build: (c) => [{ kind: 'dropShadow', params: { color: c.accent ?? '#000000', opacity: 45, angle: 120, distance: r(c.u * 0.05), size: r(c.u * 0.12) } }] },
  'long-shadow': { label: '硬投影', build: (c) => [{ kind: 'dropShadow', params: { color: c.accent ?? '#000000', opacity: 100, blend: 'normal', angle: 135, distance: r(c.u * 0.12), spread: 100, size: 0 } }] },
  neon: { label: '霓虹', build: (c) => {
    const glow = c.accent ?? c.color ?? '#ff2bd6';
    return [
      { kind: 'colorOverlay', params: { color: shade(glow, 0.75), opacity: 100 } },
      { kind: 'innerGlow', params: { color: glow, opacity: 85, size: r(c.u * 0.08) } },
      { kind: 'outerGlow', params: { color: glow, opacity: 90, spread: 12, size: r(c.u * 0.35) } }];
  } },
  glow: { label: '外发光', build: (c) => [{ kind: 'outerGlow', params: { color: c.accent ?? '#ffd54a', opacity: 80, technique: 'softer', size: r(c.u * 0.25) } }] },
  metal: { label: '金属', build: (c) => [
    { kind: 'gradientOverlay', params: { from: '#f4f6f8', to: '#7b828a', style: 'linear', angle: 90 } },
    { kind: 'bevelEmboss', params: { style: 'inner', technique: 'smooth', depth: 200, size: r(c.u * 0.06), direction: 'up' } },
    { kind: 'stroke', params: { size: r(c.u * 0.03), position: 'outside', color: c.accent ?? '#3a3f45' } },
    { kind: 'dropShadow', params: { color: '#000000', opacity: 50, angle: 120, distance: r(c.u * 0.04), size: r(c.u * 0.08) } }] },
  gold: { label: '金色', build: (c) => [
    { kind: 'gradientOverlay', params: { from: '#fff3b0', to: '#b07d10', style: 'linear', angle: 90 } },
    { kind: 'bevelEmboss', params: { style: 'inner', technique: 'smooth', depth: 250, size: r(c.u * 0.07), direction: 'up' } },
    { kind: 'stroke', params: { size: r(c.u * 0.03), position: 'outside', color: c.accent ?? '#5a3d00' } },
    { kind: 'dropShadow', params: { color: '#000000', opacity: 45, angle: 120, distance: r(c.u * 0.04), size: r(c.u * 0.08) } }] },
  emboss: { label: '浮雕', build: (c) => [
    { kind: 'bevelEmboss', params: { style: 'emboss', technique: 'smooth', depth: 150, size: r(c.u * 0.06), direction: 'up' } },
    { kind: 'innerShadow', params: { color: '#000000', opacity: 30, angle: 120, distance: r(c.u * 0.02), size: r(c.u * 0.04) } }] },
  candy: { label: '糖果', build: (c) => {
    const base = c.color ?? '#ff6fa8';
    return [
      { kind: 'gradientOverlay', params: { from: shade(base, 0.35), to: shade(base, -0.2), style: 'linear', angle: 90 } },
      { kind: 'innerGlow', params: { color: '#ffffff', opacity: 60, source: 'center', size: r(c.u * 0.08) } },
      { kind: 'stroke', params: { size: r(c.u * 0.07), position: 'outside', color: c.accent ?? '#ffffff' } },
      { kind: 'dropShadow', params: { color: shade(base, -0.6), opacity: 35, angle: 120, distance: r(c.u * 0.05), size: r(c.u * 0.08) } }];
  } },
  sticker: { label: '贴纸', build: (c) => [
    { kind: 'stroke', params: { size: r(c.u * 0.1), position: 'outside', color: c.accent ?? '#ffffff' } },
    { kind: 'dropShadow', params: { color: '#000000', opacity: 35, angle: 120, distance: r(c.u * 0.04), size: r(c.u * 0.08) } }] },
  gradient: { label: '渐变', build: (c) => [{ kind: 'gradientOverlay', params: { from: c.color ?? '#ff7a18', to: c.accent ?? '#af002d', style: 'linear', angle: 90 } }] },
};

/** The text's size in document pixels: from the type size, else the box height. */
export function fontPx(layer: LayerNode, resolution = 72): number {
  if (layer.text?.sizePt) return layer.text.sizePt * resolution / 72;
  return Math.max(8, layer.bounds?.[3] ?? 48);
}

export function findLayer(layers: LayerNode[], id: number): LayerNode | undefined {
  for (const l of layers) {
    if (l.id === id) return l;
    const c = l.children && findLayer(l.children, id);
    if (c) return c;
  }
  return undefined;
}

export function parentOf(layers: LayerNode[], id: number, parent?: LayerNode): LayerNode | undefined {
  for (const l of layers) {
    if (l.id === id) return parent;
    const p = l.children && parentOf(l.children, id, l);
    if (p) return p;
  }
  return undefined;
}

export interface TextFxArgs {
  layer: number;
  preset?: string;
  color?: string;
  accent?: string;
  /** Explicit effects; a kind given here replaces the preset's effect of that kind. */
  effects?: ({ kind: FxKind } & Record<string, unknown>)[];
  warp?: { style: string; bend?: number; horizontalDistortion?: number; verticalDistortion?: number };
}

/** Effects for a preset plus explicit overrides (one effect per kind). */
export function composeEffects(a: Omit<TextFxArgs, 'layer' | 'warp'>, u: number): FxEffect[] {
  const fromPreset = a.preset ? TEXT_FX_PRESETS[a.preset]?.build({ u, color: a.color, accent: a.accent }) ?? [] : [];
  const explicit = (a.effects ?? []).map(({ kind, ...params }) => ({ kind, params }));
  return [...fromPreset.filter((e) => !explicit.some((x) => x.kind === e.kind)), ...explicit];
}

/** One atomic batch: replace the layer's effects (and warp, for type layers). */
export function textFxBatch(info: DocInspect, a: TextFxArgs): Batch {
  const layer = findLayer(info.layers ?? [], a.layer);
  if (!layer) throw new EngineError(`图层 ${a.layer} 不存在（请重新 doc_read）`);
  if (a.preset && !TEXT_FX_PRESETS[a.preset]) throw new EngineError(`没有特效预设 ${a.preset}`);
  const batch: Batch = [];
  if (a.preset || a.effects?.length) {
    const effects = composeEffects(a, fontPx(layer, info.resolution ?? 72));
    batch.push({ cmd: 'layer.layerStyle.replace', params: { layer: a.layer, effects } });
  }
  if (a.warp) {
    if (layer.kind !== 'Type') throw new EngineError('变形文字只能用于文字图层');
    // warpText is gated on the active layer, whatever `layer` says.
    batch.push({ cmd: 'layer.select', params: { layer: a.layer, mode: 'replace' } }, { cmd: 'type.warpText', params: { layer: a.layer, ...a.warp } });
  }
  if (!batch.length) throw new EngineError('请给出 preset、effects 或 warp 之一');
  return batch;
}

export function textFxClearBatch(info: DocInspect, layer: number): Batch {
  const l = findLayer(info.layers ?? [], layer);
  if (!l) throw new EngineError(`图层 ${layer} 不存在（请重新 doc_read）`);
  return [{ cmd: 'layer.layerStyle.clear', params: { layer } }, ...(l.kind === 'Type' ? [{ cmd: 'layer.select', params: { layer, mode: 'replace' } }, { cmd: 'type.warpText', params: { layer, style: 'none' } }] : [])];
}

// --- 立体字 (extrusion) --------------------------------------------------------------------------

export const EXTRUDE_GROUP = '立体字';
export const EXTRUDE_COPY = '立体-厚度';

export interface ExtrudeArgs {
  layer: number;
  /** Thickness in document pixels (default 15% of the text size). */
  depth?: number;
  /** Direction the thickness extends, degrees: 0 = right, 90 = down (default 45). */
  angle?: number;
  sideColor?: string;
  /** Stroke on each slice; pass the front face's outline size so the sides match it. */
  outline?: number;
  shadow?: boolean;
}

/** Slice offsets and colours, nearest first. */
export function extrudePlan(a: ExtrudeArgs, u: number) {
  const depth = Math.max(2, Math.min(600, a.depth ?? Math.round(u * 0.15)));
  const n = Math.max(2, Math.min(24, Math.round(depth / Math.max(1, u * 0.02))));
  const rad = ((a.angle ?? 45) * Math.PI) / 180, side = a.sideColor ?? '#333333';
  return Array.from({ length: n }, (_, i) => {
    const k = (i + 1) / n;
    return { dx: Math.round(Math.cos(rad) * depth * k), dy: Math.round(Math.sin(rad) * depth * k), color: shade(side, -0.35 * k) };
  });
}

const newId = (reply: { results: { value?: unknown }[] }) => reply.results.map((x) => (x.value as { layer?: number } | undefined)?.layer).find((x) => typeof x === 'number');
const allIds = (layers: LayerNode[], out = new Set<number>()) => { for (const l of layers) { out.add(l.id); if (l.children) allIds(l.children, out); } return out; };

/**
 * Builds (or rebuilds) the extrusion: copies of the face layer stacked under it, each shifted
 * further along `angle` and filled with a darker side colour, all grouped with the face.
 * Re-running on a face already inside a 立体字 group replaces the old slices.
 */
export async function extrudeText(session: DocSession, a: ExtrudeArgs, opts: { key?: string; baseRevision?: number } = {}) {
  let info = await session.inspect();
  const face = findLayer(info.layers ?? [], a.layer);
  if (!face?.bounds) throw new EngineError(`图层 ${a.layer} 不存在或没有内容`);
  const group = parentOf(info.layers ?? [], a.layer);
  const inGroup = !!group && group.name.startsWith(EXTRUDE_GROUP);
  const key = (s: string) => (opts.key ? `${opts.key}:${s}` : undefined);
  let base = opts.baseRevision ?? session.currentRevision;
  const send = async (batch: Batch, tag: string) => { const reply = await session.request(batch, key(tag), { baseRevision: base }); base = session.currentRevision; return reply; };
  const old = inGroup ? (group!.children ?? []).filter((l) => l.id !== a.layer && l.name.startsWith(EXTRUDE_COPY)) : [];
  if (old.length) await send(old.map((l) => ({ cmd: 'layer.delete', params: { layer: l.id } })), 'clear');
  const plan = extrudePlan(a, fontPx(face, info.resolution ?? 72));
  // The face's outline makes it wider than the slices; without an explicit size, match it roughly.
  const outline = a.outline ?? (face.effects?.items.some((e) => /stroke/i.test(e.kind)) ? fontPx(face, info.resolution ?? 72) * 0.04 : 0);
  const copies: number[] = [];
  for (let i = 0; i < plan.length; i++) {
    const before = allIds((await session.inspect()).layers ?? []);
    const reply = await send([{ cmd: 'layer.duplicate', params: { layer: a.layer } }], `dup${i}`);
    let id = newId(reply);
    if (id == null || id === a.layer) id = [...allIds((await session.inspect()).layers ?? [])].find((x) => !before.has(x));
    if (id == null) throw new EngineError('复制图层没有返回新图层');
    copies.push(id);
  }
  const batch: Batch = [];
  plan.forEach((p, i) => {
    const id = copies[i];
    batch.push({ cmd: 'layer.moveTo', params: { layer: id, target: i === 0 ? a.layer : copies[i - 1], position: 'below' } });
    batch.push({ cmd: 'layer.translate', params: { layer: id, dx: p.dx, dy: p.dy } });
    batch.push({ cmd: 'layer.setProps', params: { layer: id, name: `${EXTRUDE_COPY} ${i + 1}` } });
    const effects: FxEffect[] = [{ kind: 'colorOverlay', params: { color: p.color, opacity: 100 } }];
    if (outline) effects.push({ kind: 'stroke', params: { size: r(outline), position: 'outside', color: p.color } });
    if (a.shadow !== false && i === plan.length - 1) {
      const u = fontPx(face, info.resolution ?? 72);
      effects.push({ kind: 'dropShadow', params: { color: '#000000', opacity: 40, angle: a.angle ?? 45, distance: r(u * 0.04), size: r(u * 0.1) } });
    }
    batch.push({ cmd: 'layer.layerStyle.replace', params: { layer: id, effects } });
  });
  await send(batch, 'stack');
  const name = `${EXTRUDE_GROUP}（厚度 ${Math.round(Math.hypot(plan.at(-1)!.dx, plan.at(-1)!.dy))}px）`;
  let groupId = inGroup ? group!.id : undefined;
  if (inGroup) await send([{ cmd: 'layer.setProps', params: { layer: groupId, name } }], 'name');
  else {
    const ids = [a.layer, ...copies];
    const reply = await send([...ids.map((id, i) => ({ cmd: 'layer.select', params: { layer: id, mode: i === 0 ? 'replace' : 'add' } })), { cmd: 'layer.groupLayers', params: { name } }], 'group');
    groupId = newId(reply);
  }
  info = await session.inspect();
  if (groupId == null) groupId = parentOf(info.layers ?? [], a.layer)?.id;
  return { group: groupId, face: a.layer, slices: copies, depth: Math.round(Math.hypot(plan.at(-1)!.dx, plan.at(-1)!.dy)) };
}
