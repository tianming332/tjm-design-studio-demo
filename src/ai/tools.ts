// Editor-side half of the tool catalog: how each client tool becomes an atomic engine batch.
// Names, schemas and risk live in the Admin catalog (workbench/tools.js); a test keeps the two
// in step. The server has already validated the arguments before a step reaches the editor.
import { adjustBatch, regionApplyBatch, regionRefineBatch, regionSelectBatch, type AdjustArgs, type RegionOp, type RegionSelectArgs } from '../engine/region';
import { FILTERS, filterId, filterParams } from '../engine/filters';

type Args = Record<string, any>;
type Batch = { cmd: string; params?: object }[];

const pick = (a: Args, keys: string[]) => Object.fromEntries(keys.filter((k) => a[k] !== undefined).map((k) => [k, a[k]]));
const select = (ids: number[]) => ids.map((id, i) => ({ cmd: 'layer.select', params: { layer: id, mode: i === 0 ? 'replace' : 'add' } }));

/** Edit tools → engine commands. Read tools (doc_read / doc_preview) and asset_import are handled by the bridge. */
export const EDIT_BATCH: Record<string, (a: Args) => Batch> = {
  text_create: (a) => [{ cmd: 'type.create', params: { size: 64, color: '#000000', ...pick(a, ['text', 'x', 'y', 'size', 'color', 'font', 'box', 'align']) } }],
  text_edit: (a) => [{ cmd: 'type.edit', params: { layer: a.layer, text: a.text } }],
  text_style: (a) => [{ cmd: 'type.setStyle', params: { layer: a.layer, ...pick(a, ['size', 'color', 'font', 'align', 'tracking', 'leading']) } }],
  layer_move: (a) => [{ cmd: 'layer.translate', params: { layer: a.layer, dx: a.dx, dy: a.dy } }],
  layer_props: (a) => [{ cmd: 'layer.setProps', params: { layer: a.layer, ...pick(a, ['visible', 'opacity', 'name', 'blend']) } }],
  layer_arrange: (a) => [{ cmd: `layer.arrange.${a.direction}`, params: { layer: a.layer } }],
  layer_align: (a) => [...select(a.layers), { cmd: `layer.align.${a.edge}`, ...(a.to ? { params: { to: a.to } } : {}) }],
  shape_create: (a) => [{ cmd: 'shape.create', params: pick(a, ['kind', 'rect', 'fill', 'name']) }],
  fill_solid: (a) => [{ cmd: 'layer.newFillLayer.solidColor', params: { color: a.color } }],
  layer_group: (a) => [...select(a.layers), { cmd: 'layer.groupLayers', ...(a.name ? { params: { name: a.name } } : {}) }],
  layer_delete: (a) => [{ cmd: 'layer.delete', params: { layer: a.layer } }],
  region_select: (a) => regionSelectBatch(a as RegionSelectArgs),
  region_refine: (a) => regionRefineBatch(a),
  region_apply: (a) => regionApplyBatch(a as { op: RegionOp; layer: number; edge?: number }),
  adjust_apply: (a) => adjustBatch(a as AdjustArgs),
  filter_apply: (a) => filterBatch(a),
};

/** filter_apply: the catalog id (cmd or cmd#variant) → the engine command with clamped params. */
function filterBatch(a: Args): Batch {
  const spec = FILTERS.find((f) => filterId(f) === a.filter);
  if (!spec) throw new Error(`没有滤镜 ${a.filter}`);
  const values = Object.fromEntries(spec.fields.map((f) => [f.key, Math.min(f.max, Math.max(f.min, Number(a.values?.[f.key] ?? f.default)))]));
  return [{ cmd: 'layer.select', params: { layer: a.layer, mode: 'replace' } }, { cmd: spec.cmd, params: filterParams(spec, values) }];
}

/** Edit tools whose batch depends on the document (sizes from the layer, rebuilt groups); run by the bridge. */
export const DOC_TOOLS = ['text_fx_apply', 'text_fx_clear', 'text_extrude', 'layout_apply', 'text_fit', 'region_mask'];
/** Client tools that read the document (or capture from it) without editing it. */
export const READ_TOOLS = ['doc_read', 'doc_preview', 'doc_lint', 'region_capture', 'font_list'];

/** Every tool the editor executes. */
export const CLIENT_TOOLS = [...READ_TOOLS, 'asset_import', 'layer_fit', ...DOC_TOOLS, ...Object.keys(EDIT_BATCH)];

export function targetLayers(args: Args): number[] {
  const ids: number[] = [];
  if (typeof args.layer === 'number') ids.push(args.layer);
  if (Array.isArray(args.layers)) for (const x of args.layers) if (typeof x === 'number') ids.push(x);
  if (Array.isArray(args.items)) for (const it of args.items) if (typeof it?.layer === 'number') ids.push(it.layer);
  return ids;
}
