// Layout helpers for the agent: fit a text layer into a box (text_fit / layout_apply) and the
// deterministic checks behind doc_lint. Pixels come from a real render of the current revision.
import type { DocInspect, LayerNode } from './protocol';
import type { DocSession } from './session';
import { EngineError } from './session';
import { EXTRUDE_COPY, findLayer } from './textfx';

export type Box = [number, number, number, number];
export type HAlign = 'left' | 'center' | 'right';
export type VAlign = 'top' | 'middle' | 'bottom';

/** Box in 0..1 canvas units → document pixels. */
export const relBox = (b: Box, W: number, H: number): Box => [Math.round(b[0] * W), Math.round(b[1] * H), Math.round(b[2] * W), Math.round(b[3] * H)];

/** Offset that puts `b` at the chosen edge / centre of `box`. */
export function alignDelta(b: Box, box: Box, align: HAlign = 'center', valign: VAlign = 'middle'): [number, number] {
  const dx = align === 'left' ? box[0] - b[0] : align === 'right' ? box[0] + box[2] - (b[0] + b[2]) : box[0] + box[2] / 2 - (b[0] + b[2] / 2);
  const dy = valign === 'top' ? box[1] - b[1] : valign === 'bottom' ? box[1] + box[3] - (b[1] + b[3]) : box[1] + box[3] / 2 - (b[1] + b[3] / 2);
  return [Math.round(dx), Math.round(dy)];
}

/**
 * Scales a type layer so it fits `box` (shrinks always, grows only with `grow`), then aligns it.
 * Two requests: the new size changes the bounds the alignment depends on.
 */
export async function fitText(session: DocSession, layer: number, box: Box, o: { align?: HAlign; valign?: VAlign; grow?: boolean; key?: string; baseRevision?: number } = {}) {
  let info = await session.inspect();
  const l = findLayer(info.layers ?? [], layer);
  if (!l || l.kind !== 'Type' || !l.text || !l.bounds) throw new EngineError(`图层 ${layer} 不是有内容的文字图层`);
  let base = o.baseRevision ?? session.currentRevision;
  const k = Math.min(box[2] / Math.max(1, l.bounds[2]), box[3] / Math.max(1, l.bounds[3]));
  const scale = k < 1 ? k * 0.98 : o.grow ? Math.min(k * 0.98, 6) : 1;
  let size = l.text.sizePt;
  if (Math.abs(scale - 1) > 0.01) {
    size = Math.max(1, Math.round(l.text.sizePt * scale * 10) / 10);
    await session.request([{ cmd: 'type.setStyle', params: { layer, size } }], o.key && `${o.key}:size`, { baseRevision: base });
    base = session.currentRevision;
    info = await session.inspect();
  }
  const b = findLayer(info.layers ?? [], layer)!.bounds!;
  const [dx, dy] = alignDelta(b, box, o.align, o.valign);
  if (dx || dy) await session.request([{ cmd: 'layer.translate', params: { layer, dx, dy } }], o.key && `${o.key}:move`, { baseRevision: base });
  const after = findLayer((await session.inspect()).layers ?? [], layer)!.bounds!;
  return { layer, size, bounds: after, fits: after[2] <= box[2] + 2 && after[3] <= box[3] + 2 };
}

// --- doc_lint ----------------------------------------------------------------------------------

export interface LintIssue { code: string; severity: 'error' | 'warn'; layer?: number; message: string }
export interface Pixels { width: number; height: number; pixels: ArrayBuffer }

const visibleText = (ls: LayerNode[], out: LayerNode[] = []) => {
  for (const l of ls) {
    if (l.visible === false) continue;
    // 立体字 slices are copies of their face: not separate text to check.
    if (l.kind === 'Type' && l.bounds && !l.name.startsWith(EXTRUDE_COPY)) out.push(l);
    if (l.children) visibleText(l.children, out);
  }
  return out;
};
const lum = (r: number, g: number, b: number) => {
  const c = [r, g, b].map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
export const contrastRatio = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

/**
 * Text contrast from pixels alone: the ring just outside the text box is the background; inside
 * the box, the pixels least like that background are the glyphs (fill, stroke or effect).
 */
export function textContrast(px: Pixels, scale: number, b: Box): number | undefined {
  const d = new Uint8Array(px.pixels), W = px.width, H = px.height;
  const x0 = Math.floor(b[0] * scale), y0 = Math.floor(b[1] * scale), x1 = Math.ceil((b[0] + b[2]) * scale), y1 = Math.ceil((b[1] + b[3]) * scale);
  const pad = Math.max(2, Math.round((y1 - y0) * 0.15));
  const at = (x: number, y: number) => { const i = (y * W + x) * 4; return lum(d[i], d[i + 1], d[i + 2]); };
  const ring: number[] = [];
  for (let y = y0 - pad; y < y1 + pad; y++) for (let x = x0 - pad; x < x1 + pad; x++) {
    if (x < 0 || y < 0 || x >= W || y >= H || (x >= x0 && x < x1 && y >= y0 && y < y1)) continue;
    ring.push(at(x, y));
  }
  const inner: number[] = [];
  for (let y = Math.max(0, y0); y < Math.min(H, y1); y++) for (let x = Math.max(0, x0); x < Math.min(W, x1); x++) inner.push(at(x, y));
  if (ring.length < 8 || inner.length < 8) return undefined;
  const bg = ring.reduce((s, v) => s + v, 0) / ring.length;
  inner.sort((p, q) => Math.abs(q - bg) - Math.abs(p - bg));
  const glyph = inner.slice(0, Math.max(1, Math.round(inner.length * 0.15)));
  return contrastRatio(bg, glyph.reduce((s, v) => s + v, 0) / glyph.length);
}

/** Deterministic layout problems (no model involved). */
export function lintDoc(info: DocInspect, render?: { px: Pixels; scale: number }): LintIssue[] {
  const W = info.width, H = info.height, margin = Math.round(Math.min(W, H) * 0.03), minPx = Math.min(W, H) / 50;
  const texts = visibleText(info.layers ?? []);
  const issues: LintIssue[] = [];
  for (const t of texts) {
    const [x, y, w, h] = t.bounds!;
    const name = `「${(t.text?.text ?? t.name).slice(0, 12)}」`;
    if (!t.text?.text.trim()) issues.push({ code: 'EMPTY_TEXT', severity: 'error', layer: t.id, message: `文字图层 ${t.name} 没有内容` });
    if (x < -2 || y < -2 || x + w > W + 2 || y + h > H + 2) issues.push({ code: 'OUT_OF_CANVAS', severity: 'error', layer: t.id, message: `${name} 越出画布（边界 [${x},${y},${w},${h}]，画布 ${W}×${H}）` });
    else if (x < margin || y < margin || x + w > W - margin || y + h > H - margin) issues.push({ code: 'EDGE_MARGIN', severity: 'warn', layer: t.id, message: `${name} 距画布边缘不足 ${margin}px` });
    const lineH = h / Math.max(1, (t.text?.text.match(/\n/g)?.length ?? 0) + 1);
    if (lineH < minPx) issues.push({ code: 'SMALL_TEXT', severity: 'warn', layer: t.id, message: `${name} 字高约 ${Math.round(lineH)}px，小于画布短边的 1/50` });
    if (render) {
      const c = textContrast(render.px, render.scale, t.bounds!);
      if (c != null && c < 3) issues.push({ code: 'LOW_CONTRAST', severity: 'warn', layer: t.id, message: `${name} 与背景对比度约 ${c.toFixed(1)}:1（建议 ≥ 3:1）` });
    }
  }
  for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++) {
    const a = texts[i].bounds!, b = texts[j].bounds!;
    const ix = Math.max(0, Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0])), iy = Math.max(0, Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]));
    if (ix * iy > 0.1 * Math.min(a[2] * a[3], b[2] * b[3])) issues.push({ code: 'TEXT_OVERLAP', severity: 'error', layer: texts[j].id, message: `文字图层 ${texts[i].id} 与 ${texts[j].id} 重叠` });
  }
  return issues;
}
