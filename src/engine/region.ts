// Selection-scoped work (智能选区 + AI 操作): smart selection, edge refinement, and the
// non-generative operations that act only inside the selection. Shared by the agent tools
// (region_select / region_refine / region_apply / adjust_apply) and the selection action bar.
import { unpackSelectionMask } from './protocol';
import type { DocSession } from './session';
import { EngineError } from './session';

type Batch = { cmd: string; params?: object }[];
type Mode = 'replace' | 'add' | 'subtract' | 'intersect';

export interface RegionSelectArgs {
  method: 'subject' | 'object' | 'focus' | 'rect' | 'ellipse' | 'all' | 'none' | 'inverse';
  /** [x, y, w, h]: required for object / rect / ellipse. */
  rect?: [number, number, number, number];
  /** Sample only this layer (default: all visible layers). */
  layer?: number;
  mode?: Mode;
  feather?: number;
}

export function regionSelectBatch(a: RegionSelectArgs): Batch {
  const pre: Batch = a.layer != null ? [{ cmd: 'layer.select', params: { layer: a.layer, mode: 'replace' } }] : [];
  const sampleAllLayers = a.layer == null, mode = a.mode ?? 'replace';
  const needRect = () => { if (!a.rect) throw new EngineError(`${a.method} 选区需要 rect=[x,y,w,h]`); return a.rect.map(Math.round) as [number, number, number, number]; };
  switch (a.method) {
    case 'subject': return [...pre, { cmd: 'select.subject', params: { sampleAllLayers, mode } }];
    case 'focus': return [...pre, { cmd: 'select.focusArea', params: { sampleAllLayers, mode } }];
    case 'object': return [...pre, { cmd: 'select.object', params: { rect: needRect(), sampleAllLayers, mode } }];
    case 'rect': case 'ellipse': {
      const [x, y, width, height] = needRect();
      return [{ cmd: 'select.rect', params: { x, y, width, height, mode, ellipse: a.method === 'ellipse', feather: a.feather ?? 0 } }];
    }
    case 'all': return [{ cmd: 'select.all' }];
    case 'none': return [{ cmd: 'select.deselect' }];
    case 'inverse': return [{ cmd: 'select.inverse' }];
  }
}

export interface RegionRefineArgs { radius?: number; smooth?: number; feather?: number; contrast?: number; shiftEdge?: number }
export const regionRefineBatch = (a: RegionRefineArgs): Batch => [{ cmd: 'select.refineEdge', params: { ...a, output: 'selection' } }];

export type RegionOp = 'cutout' | 'remove';
/** cutout: the selected pixels of `layer` become a new masked layer; remove: content-aware fill into a new layer. Originals are untouched. */
export function regionApplyBatch(a: { op: RegionOp; layer: number; edge?: number }): Batch {
  const pre: Batch = [{ cmd: 'layer.select', params: { layer: a.layer, mode: 'replace' } }];
  // Output to a layer drops the selection; bring it back so the next op keeps the same scope.
  if (a.op === 'cutout') return [...pre, { cmd: 'select.refineEdge', params: { radius: a.edge ?? 2, output: 'newLayerWithMask' } }, { cmd: 'select.reselect' }];
  return [...pre, { cmd: 'edit.contentAwareFill', params: { output: 'new', sampling: 'auto', colorAdaptation: 'high' } }];
}

/** Adjustments the agent may add; with a selection the new layer's mask is that selection. */
export const ADJUST_KEYS: Record<string, string[]> = {
  brightnessContrast: ['brightness', 'contrast'],
  hueSaturation: ['hue', 'saturation', 'lightness', 'colorize'],
  vibrance: ['vibrance', 'saturation'],
  exposure: ['exposure', 'gamma'],
  colorBalance: ['shadows', 'midtones', 'highlights'],
  photoFilter: ['filter', 'color', 'density'],
  blackWhite: [],
  colorLookup: ['lut'],
  gradientMap: [],
  invert: [],
};

export interface AdjustArgs { kind: string; gradient?: { from: string; to: string }; [k: string]: unknown }

export function adjustBatch(a: AdjustArgs): Batch {
  const keys = ADJUST_KEYS[a.kind];
  if (!keys) throw new EngineError(`不支持的调整 ${a.kind}`);
  const params: Record<string, unknown> = Object.fromEntries(keys.filter((k) => a[k] !== undefined).map((k) => [k, a[k]]));
  if (a.kind === 'gradientMap') {
    const g = a.gradient ?? { from: '#000000', to: '#ffffff' };
    params.stops = [[0, g.from], [1, g.to]];
  }
  return [{ cmd: `layer.newAdjustmentLayer.${a.kind}`, params }];
}

/** Current selection bounds (document pixels) and how much of that box is selected, or null. */
export async function selectionInfo(session: DocSession) {
  let r;
  try { r = await session.selectionMask(); } catch { return null; }
  const m = r?.ok ? unpackSelectionMask(r.data?.bytes) : undefined;
  if (!m) return null;
  let sum = 0;
  for (let i = 0; i < m.coverage.length; i++) sum += m.coverage[i];
  const coverage = sum / (255 * Math.max(1, m.coverage.length));
  return coverage > 0 ? { x: m.x, y: m.y, w: m.width, h: m.height, coverage: Math.round(coverage * 100) / 100 } : null;
}

// --- generative region edits: capture → image_generate (reference) → asset_import(rect) → region_mask

/** Aspect ratios the image backend accepts (service.js ASPECT_RATIOS). */
export const CAPTURE_RATIOS: [string, number][] = [['1:1', 1], ['2:3', 2 / 3], ['3:2', 3 / 2], ['3:4', 3 / 4], ['4:3', 4 / 3], ['9:16', 9 / 16], ['16:9', 16 / 9]];

/**
 * The box sent to the image model: the selection plus `pad` context on each side, grown to the
 * nearest supported aspect ratio and kept inside the canvas, so the result can be placed back
 * with fit=cover at exactly this rect.
 */
export function captureRect(sel: { x: number; y: number; w: number; h: number }, W: number, H: number, pad = 0.25) {
  let w = sel.w * (1 + 2 * pad), h = sel.h * (1 + 2 * pad);
  const [ratio, r] = CAPTURE_RATIOS.reduce((best, c) => (Math.abs(Math.log(c[1] / (w / h))) < Math.abs(Math.log(best[1] / (w / h))) ? c : best));
  if (w / h < r) w = h * r; else h = w / r;
  const k = Math.min(1, W / w, H / h); // never larger than the canvas; keeps the ratio
  w = Math.round(w * k); h = Math.round(h * k);
  const cx = sel.x + sel.w / 2, cy = sel.y + sel.h / 2;
  const x = Math.round(Math.min(Math.max(0, cx - w / 2), W - w)), y = Math.round(Math.min(Math.max(0, cy - h / 2), H - h));
  return { rect: [x, y, w, h] as [number, number, number, number], aspectRatio: ratio };
}

/** Limit `layer` to the current selection (a generated patch placed over the original). */
export const regionMaskBatch = (a: { layer: number }): Batch => [{ cmd: 'layer.select', params: { layer: a.layer, mode: 'replace' } }, { cmd: 'layer.layerMask.revealSelection', params: { layer: a.layer } }];
