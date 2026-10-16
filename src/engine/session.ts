// Per-document session: wraps the engine Worker client with tjm/0 semantics
// (revision tracking, atomic batch, optimistic-concurrency conflict handling, save).
import { EngineClient, envelope } from './client';
import { batchFonts, defaultFontBytes, ensureFont, registerClient, unregisterClient } from './fonts';
import { CMD, type DocEvents, type DocInspect, type LayerProps, type OpenReply, type PaintTarget, type Rect, type RequestReply, type SelectMode } from './protocol';

export class EngineError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message);
    this.name = 'EngineError';
  }
}

export type Batch = { cmd: string; params?: object }[];

/** `image.imageSize` resampling (engine 0.6.0). `none` changes the resolution only. */
export type Resample = 'bicubic' | 'bilinear' | 'nearest' | 'lanczos' | 'preserveDetails' | 'none';
/** `image.canvasSize` anchor: which edge/corner stays put. */
export type Anchor = 'topLeft' | 'top' | 'topRight' | 'left' | 'center' | 'right' | 'bottomLeft' | 'bottom' | 'bottomRight';

/** Brush/pencil/eraser options. `pencil` picks the hard-edged command; `erase` wipes to transparency. */
export interface BrushOpts {
  size: number;
  hardness: number;
  opacity: number;
  flow: number;
  color?: string;
  pencil?: boolean;
  erase?: boolean;
  /** Engine brush preset (`brush.presets.list` name); explicit size/hardness still override it. */
  preset?: string;
}

/** Extra selection-tool options (options bar). */
export interface SelectExtra { feather?: number; antiAlias?: boolean }

function selectExtra(e: SelectExtra): Record<string, unknown> {
  const p: Record<string, unknown> = {};
  if (e.feather && e.feather > 0) p.feather = e.feather;
  if (e.antiAlias === false) p.antiAlias = false;
  return p;
}

export interface ShapeInfo {
  layer: number; name: string; kind: string; bounds: [number, number, number, number];
  live: { kind: string; rect?: [number, number, number, number]; from?: [number, number]; to?: [number, number]; radii?: number[]; sides?: number; star_ratio?: number } | null;
  path: unknown; fill: unknown; stroke: unknown;
}

function brushParams(o: BrushOpts): Record<string, unknown> {
  const p: Record<string, unknown> = { size: o.size, opacity: o.opacity, erase: o.erase ?? false };
  if (!o.pencil) { p.hardness = o.hardness; p.flow = o.flow; }
  if (o.color) p.color = o.color;
  if (o.preset) p.preset = o.preset;
  return p;
}

/** The engine reports errors as `{code, message, at}`; flatten that to text + code. */
export function engineError(e: unknown): { message: string; code?: string } {
  if (typeof e === 'string') return { message: e };
  if (e && typeof e === 'object') {
    const o = e as { code?: unknown; message?: unknown; at?: unknown };
    const message = typeof o.message === 'string' ? o.message : JSON.stringify(e);
    const code = typeof o.code === 'string' ? o.code : undefined;
    return { message: o.at != null ? `${message}（第 ${Number(o.at) + 1} 步）` : message, code };
  }
  return { message: String(e) };
}

/**
 * Damage rectangles for incremental redraw.
 *
 * The engine reports damage as `[x0, y0, x1, y1]` in document pixels (exclusive right/bottom
 * edges), not as `{x, y, w, h}` — getting this wrong silently disables every dirty-region
 * repaint, so the shape is parsed defensively and verified by unit tests.
 */
export function toRects(damage: unknown): Rect[] {
  if (damage == null) return [];
  const isEdges = (v: unknown): v is number[] =>
    Array.isArray(v) && v.length === 4 && v.every((n) => typeof n === 'number');
  const one = (v: unknown): Rect | undefined => {
    if (isEdges(v)) {
      const [x0, y0, x1, y1] = v;
      const w = x1 - x0;
      const h = y1 - y0;
      return w > 0 && h > 0 ? { x: x0, y: y0, w, h } : undefined;
    }
    if (v && typeof v === 'object') {
      const o = v as Partial<Rect>;
      if (typeof o.x === 'number' && typeof o.y === 'number' && typeof o.w === 'number' && typeof o.h === 'number') {
        return o.w > 0 && o.h > 0 ? { x: o.x, y: o.y, w: o.w, h: o.h } : undefined;
      }
    }
    return undefined;
  };
  if (isEdges(damage)) {
    const r = one(damage);
    return r ? [r] : [];
  }
  if (Array.isArray(damage)) return damage.map(one).filter((r): r is Rect => !!r);
  const r = one(damage);
  return r ? [r] : [];
}

/** Builds a batch that sets the engine selection to exactly `ids` (replace first, add the rest). */
export function selectBatch(ids: number[]): Batch {
  return ids.map((id, i) => ({ cmd: 'layer.select', params: { layer: id, mode: i === 0 ? 'replace' : 'add' } }));
}

/** Normalises the cross-document fields of a reply; `undefined` when nothing happened elsewhere. */
export function docEvents(body: Partial<DocEvents> | undefined): DocEvents | undefined {
  const ev: DocEvents = {
    openedDocs: Array.isArray(body?.openedDocs) ? body!.openedDocs : [],
    closedDocs: Array.isArray(body?.closedDocs) ? body!.closedDocs : [],
    touchedDocs: Array.isArray(body?.touchedDocs) ? body!.touchedDocs : [],
  };
  return ev.openedDocs.length || ev.closedDocs.length || ev.touchedDocs.length ? ev : undefined;
}

export class DocSession {
  private revision = 0;
  /** Serialises requests: `baseRevision` is optimistic concurrency, so two in-flight batches
   *  would make the second one conflict against a revision the first has already moved. */
  private queue: Promise<unknown> = Promise.resolve();
  /** Cross-document side effects (opened/closed/touched docs) are reported here. */
  onEvents?: (ev: DocEvents, from: DocSession) => void;

  /** `owner` sessions own the Worker; attached ones (documents opened inside the same engine,
   *  e.g. Edit Contents) share it and must not terminate it. */
  private constructor(readonly client: EngineClient, readonly docId: string, public warnings: string[], readonly owner = true) {}

  /** A session for another document already open in `client`'s engine (multi-document bridge). */
  static attach(client: EngineClient, docId: string, revision = 0): DocSession {
    const s = new DocSession(client, docId, [], false);
    s.revision = revision;
    return s;
  }

  /** The bridge bumped this document's revision from another document's batch (a smart-object
   *  commit into its parent): realign so the next request is not a spurious conflict. */
  syncRevision(revision: number) { this.revision = revision; }

  static async open(file: File): Promise<DocSession> {
    const client = new EngineClient();
    try {
    // Fonts first: text layers are laid out when the document opens.
    const font = await defaultFontBytes();
    if (font) await client.addFont(font.slice(0));
    await registerClient(client);
    const bytes = await file.arrayBuffer();
    const r = await client.open(file.name, bytes);
    if (!r.ok) { unregisterClient(client); client.terminate(); throw new EngineError(r.error ?? 'open failed'); }
    const body = r.data as OpenReply;
    if (body.status !== 'ok' || !body.result) {
      client.terminate();
      throw new EngineError(body.error ?? 'open rejected', body.status);
    }
    const warnings = [...(body.result.warnings ?? []), ...(body.result.document?.warnings ?? [])];
    const s = new DocSession(client, body.result.docId, warnings);
    s.revision = body.result.revision ?? 0;
    await s.loadMissingFonts();
    return s;
    } catch (e) { unregisterClient(client); client.terminate(); throw e; }
  }

  /** Fonts the document uses but the engine lacks: load those the library has. Registering a
   *  font makes the engine lay out every open text layer again, so no further step is needed. */
  async loadMissingFonts(): Promise<string[]> {
    try {
      const r = await this.request([{ cmd: 'type.resolveMissingFonts' }]);
      const v = r.results[0]?.value as { missing?: string[]; families?: string[] } | string[] | undefined;
      const missing = Array.isArray(v) ? v : v?.missing ?? v?.families ?? [];
      const found = (await Promise.all(missing.map(async (f) => ((await ensureFont(f)) ? f : '')))).filter(Boolean);
      return found;
    } catch { return []; }
  }

  /** Opens another document in an existing engine (multi-document tabs share one Worker). */
  static async openIn(client: EngineClient, file: File): Promise<DocSession> {
    const r = await client.open(file.name, await file.arrayBuffer());
    if (!r.ok) throw new EngineError(r.error ?? 'open failed');
    const body = r.data as OpenReply;
    if (body.status !== 'ok' || !body.result) throw new EngineError(body.error ?? 'open rejected', body.status);
    const s = new DocSession(client, body.result.docId, [...(body.result.warnings ?? []), ...(body.result.document?.warnings ?? [])], false);
    s.revision = body.result.revision ?? 0;
    await s.loadMissingFonts();
    return s;
  }

  /** File › New in this engine (`file.new`): the bridge registers the new document and reports
   *  it in `openedDocs`; returns its docId. */
  async newDocumentCmd(p: { width: number; height: number; resolution?: number; mode?: string; depth?: number; background?: string; name?: string }): Promise<string | undefined> {
    const r = await this.request([{ cmd: 'file.new', params: p }]);
    return r.openedDocs?.[0]?.docId;
  }

  get currentRevision() { return this.revision; }

  /** Runs an atomic batch with the current baseRevision. Throws EngineError('…','CONFLICT') on revision conflict.
   *  `opts.baseRevision` pins the revision the caller *observed* (AI steps): the engine checks it
   *  when the batch actually runs inside this queue, so an edit made in between is a conflict
   *  instead of the stale plan silently running against the newer document. */
  async request(batch: Batch, idempotencyKey?: string, opts: { baseRevision?: number } = {}): Promise<RequestReply> {
    // Library fonts load on first use (UI, agent or script alike) before the engine lays the text out.
    const fonts = batchFonts(batch);
    if (fonts.length) await Promise.all(fonts.map(ensureFont));
    const run = async (): Promise<RequestReply> => {
      const r = await this.client.request(envelope(this.docId, batch, { baseRevision: opts.baseRevision ?? this.revision, idempotencyKey }));
      if (!r.ok) throw new EngineError(r.error ?? 'request failed');
      const body = r.data as RequestReply & { replayed?: boolean };
      if (body.status === 'conflict') {
        if (!body.replayed) this.revision = body.revision ?? this.revision; // realign so the caller can retry
        throw new EngineError('revision conflict', 'CONFLICT');
      }
      if (body.status !== 'ok') {
        const { message, code } = engineError(body.error);
        throw new EngineError(message, code ?? body.status);
      }
      // A replayed (idempotent) reply carries the revision of the original run, not the current one.
      if (!body.replayed) this.revision = body.revision ?? this.revision;
      const ev = docEvents(body);
      if (ev) this.onEvents?.(ev, this);
      return body;
    };
    const next = this.queue.then(run, run); // a failed predecessor must not block the queue
    this.queue = next.then(() => undefined, () => undefined);
    return next;
  }

  async inspect(): Promise<DocInspect> {
    const reply = await this.request([{ cmd: CMD.docInspect }]);
    return reply.results[0].value as DocInspect;
  }

  setLayerProps(id: number, props: Partial<LayerProps>) {
    return this.request([{ cmd: CMD.layerSetProps, params: { layer: id, ...props } }]);
  }
  moveLayer(id: number, dx: number, dy: number) {
    return this.request([{ cmd: CMD.layerTranslate, params: { layer: id, dx, dy } }]);
  }
  selectLayer(id: number) {
    return this.request([{ cmd: CMD.layerSelect, params: { layer: id } }]);
  }
  editText(id: number, text: string) {
    return this.request([{ cmd: CMD.typeEdit, params: { layer: id, text } }]);
  }
  resolveMissingFonts() {
    return this.request([{ cmd: CMD.typeResolveMissingFonts }]);
  }
  undo() { return this.request([{ cmd: CMD.editUndo }]); }
  redo() { return this.request([{ cmd: CMD.editRedo }]); }

  // --- Poster workspace ops ---
  addText(text: string, x: number, y: number, size = 64, color = '#000000', o: { font?: string; box?: [number, number, number, number]; align?: string; orientation?: 'horizontal' | 'vertical' } = {}) {
    return this.request([{ cmd: CMD.typeCreate, params: { text, x, y, size, color, ...(o.font ? { font: o.font } : {}), ...(o.box ? { box: o.box } : {}), ...(o.align ? { align: o.align } : {}), ...(o.orientation && o.orientation !== 'horizontal' ? { orientation: o.orientation } : {}) } }]);
  }
  /** Type tool: the type layer under a document point, if any (engine hit test, Type-tool order). */
  async typeHit(x: number, y: number): Promise<number | undefined> {
    try {
      const r = await this.request([{ cmd: 'type.hitTest', params: { x: Math.round(x), y: Math.round(y) } }]);
      const v = r.results[0]?.value as { layer?: number; inside?: boolean } | undefined;
      return v?.inside === false ? undefined : v?.layer;
    } catch { return undefined; }
  }
  addShape(kind: 'rect' | 'ellipse', rect: [number, number, number, number], fill: string) {
    return this.request([{ cmd: CMD.shapeCreate, params: { kind, rect, fill } }]);
  }
  /** align/distribute act on the engine's current selection, so select the ids first (one atomic batch). */
  align(ids: number[], edge: string, to?: 'layers' | 'selection' | 'canvas') {
    return this.request([...selectBatch(ids), { cmd: `layer.align.${edge}`, ...(to ? { params: { to } } : {}) }]);
  }
  distribute(ids: number[], mode: string) {
    return this.request([...selectBatch(ids), { cmd: `layer.distribute.${mode}` }]);
  }
  arrange(id: number, dir: 'bringForward' | 'sendBackward' | 'bringToFront' | 'sendToBack') {
    return this.request([{ cmd: `layer.arrange.${dir}`, params: { layer: id } }]);
  }

  // --- Photo workspace ops ---
  crop(x: number, y: number, width: number, height: number, angle = 0, deleteCroppedPixels = true) {
    return this.request([{ cmd: CMD.imageCrop, params: { x, y, width, height, ...(angle ? { angle } : {}), ...(deleteCroppedPixels ? {} : { deleteCroppedPixels: false }) } }]);
  }
  resizeImage(width: number, height: number, resample: Resample = 'bicubic') {
    return this.request([{ cmd: CMD.imageSize, params: { width, height, resample } }]);
  }
  resizeCanvas(width: number, height: number, anchor: Anchor = 'center', extensionColor = 'background', relative = false) {
    return this.request([{ cmd: CMD.canvasSize, params: { width, height, anchor, extensionColor, relative } }]);
  }
  /** Image › Reveal All: grows the canvas to show pixels kept outside by a non-destructive crop. */
  revealAll() { return this.request([{ cmd: 'image.revealAll' }]); }
  rotate(kind: '90cw' | '90ccw' | '180' | 'flipCanvasHorizontal' | 'flipCanvasVertical') {
    return this.request([{ cmd: `image.imageRotation.${kind}` }]);
  }
  /** Auto tone/contrast/colour read the *active layer's* pixels, so a pixel layer is selected
   *  first in the same atomic batch (an adjustment layer would fail with COMMAND_DISABLED). */
  auto(kind: 'autoTone' | 'autoContrast' | 'autoColor', pixelLayer?: number) {
    const pre: Batch = pixelLayer == null ? [] : [{ cmd: CMD.layerSelect, params: { layer: pixelLayer, mode: 'replace' } }];
    return this.request([...pre, { cmd: `image.${kind}` }]);
  }
  /** Adds a non-destructive adjustment layer (`layer.newAdjustmentLayer.*`). */
  addAdjustment(cmd: string) {
    return this.request([{ cmd, params: {} }]);
  }
  /** Edits an existing adjustment layer's params; engine doc: `{"layer":id?, …params of that kind}`. */
  setAdjustment(layer: number, params: Record<string, unknown>) {
    return this.request([{ cmd: CMD.layerSetAdjustment, params: { layer, ...params } }]);
  }

  // --- Selection ---
  /** Rectangular *and* elliptical marquee: the engine has one command with an `ellipse` switch. */
  selectRect(rect: { x: number; y: number; width: number; height: number }, mode: SelectMode, ellipse = false, extra: SelectExtra = {}) {
    return this.request([{ cmd: CMD.selectRect, params: { ...rect, mode, ellipse, ...selectExtra(extra) } }]);
  }
  selectLasso(points: [number, number][], mode: SelectMode, extra: SelectExtra = {}) {
    return this.request([{ cmd: CMD.selectLasso, params: { points, mode, ...selectExtra(extra) } }]);
  }
  /** Moves the selection outline only (pixels untouched). */
  moveSelection(dx: number, dy: number) {
    return this.request([{ cmd: CMD.transformSelection, params: { dx, dy } }]);
  }
  /** Move tool › Auto-Select: the topmost layer (or group) with pixels under the point becomes active. */
  async pickAt(x: number, y: number, target: 'layer' | 'group' = 'layer'): Promise<number | undefined> {
    const r = await this.request([{ cmd: CMD.layerPickAt, params: { x: Math.round(x), y: Math.round(y), target, select: true } }]);
    const v = r.results[0]?.value as { layer?: number } | undefined;
    return typeof v?.layer === 'number' ? v.layer : undefined;
  }
  magicWand(x: number, y: number, tolerance: number, mode: SelectMode, contiguous = true, sampleAllLayers = false) {
    return this.request([{ cmd: CMD.selectMagicWand, params: { x, y, tolerance, mode, contiguous, sampleAllLayers } }]);
  }
  selectMenu(kind: 'all' | 'deselect' | 'inverse' | 'reselect' | 'grow' | 'similar') {
    return this.request([{ cmd: `select.${kind}` }]);
  }
  /** All of border/smooth/expand/contract/feather take `{radius}`. */
  selectModify(kind: 'border' | 'smooth' | 'expand' | 'contract' | 'feather', radius: number) {
    return this.request([{ cmd: `select.modify.${kind}`, params: { radius } }]);
  }

  /** `edit.fill` / `edit.clear` act on the active layer, so a pixel layer is selected first. */
  fillSelection(color: string, pixelLayer?: number) {
    return this.request([...this.pixelFirst(pixelLayer), { cmd: CMD.editFill, params: { color } }]);
  }
  clearPixels(pixelLayer?: number) {
    return this.request([...this.pixelFirst(pixelLayer), { cmd: CMD.editClear }]);
  }
  selectionToMask(layer?: number) {
    return this.request([{ cmd: CMD.layerMaskFromSelection, ...(layer == null ? {} : { params: { layer } }) }]);
  }
  /** Raw coverage read-back for the marching-ants overlay. */
  selectionMask() {
    return this.client.selectionMask(this.docId);
  }

  private pixelFirst(layer?: number): Batch {
    return layer == null ? [] : [{ cmd: CMD.layerSelect, params: { layer, mode: 'replace' } }];
  }

  // --- Paint ---
  stroke(points: ([number, number] | [number, number, number])[], o: BrushOpts, target: PaintTarget, layer?: number) {
    return this.request([...this.pixelFirst(layer), { cmd: o.pencil ? CMD.paintPencil : CMD.paintStroke, params: { points, ...brushParams(o), target } }]);
  }
  bucket(x: number, y: number, o: { tolerance: number; color: string; opacity: number }, target: PaintTarget, layer?: number) {
    return this.request([...this.pixelFirst(layer), { cmd: CMD.paintBucket, params: { x, y, contiguous: true, tolerance: o.tolerance, color: o.color, opacity: o.opacity, target } }]);
  }
  gradient(from: [number, number], to: [number, number], style: string, colors: [string, string], target: PaintTarget, layer?: number) {
    return this.request([...this.pixelFirst(layer), { cmd: CMD.paintGradient, params: { from, to, style, colors, target } }]);
  }

  // --- Foreground / background colour ---
  setColors(foreground?: string, background?: string) {
    return this.request([{ cmd: CMD.toolsSetColors, params: { foreground, background } }]);
  }
  swapColors() { return this.request([{ cmd: CMD.toolsSwapColors }]); }
  defaultColors() { return this.request([{ cmd: CMD.toolsDefaultColors }]); }

  // --- Layer mask ---
  addMask(kind: 'revealAll' | 'hideAll' | 'revealSelection' | 'hideSelection', layer?: number) {
    return this.request([{ cmd: `layer.layerMask.${kind}`, ...(layer == null ? {} : { params: { layer } }) }]);
  }
  maskEnabled(layer: number, enabled: boolean) {
    return this.request([{ cmd: 'layer.layerMask.enabled', params: { layer, enabled } }]);
  }
  deleteMask(layer?: number) {
    return this.request([{ cmd: 'layer.layerMask.delete', ...(layer == null ? {} : { params: { layer } }) }]);
  }
  applyMask(layer?: number) {
    return this.request([{ cmd: 'layer.layerMask.apply', ...(layer == null ? {} : { params: { layer } }) }]);
  }

  // --- Transform ---
  /** Handle-based free transform: source frame `rect` → destination `quad` (CW from top-left). */
  transformQuad(rect: [number, number, number, number], quad: [number, number][], layer?: number) {
    return this.request([{ cmd: CMD.editTransform, params: { rect, quad, ...(layer == null ? {} : { layer }) } }]);
  }
  /** Free Transform › Warp with a custom mesh: one Bézier patch, 16 control points row-major. */
  warpMesh(rect: [number, number, number, number], points: [number, number][], layer?: number) {
    return this.request([...this.pixelFirst(layer), { cmd: 'edit.transform.warp', params: { rect, style: 'custom', mesh: { us: [0, 1], vs: [0, 1], points } } }]);
  }
  /** Warp preset (arc, flag, wave, …) over `rect`. */
  warpPreset(rect: [number, number, number, number], style: string, bend: number, layer?: number) {
    return this.request([...this.pixelFirst(layer), { cmd: 'edit.transform.warp', params: { rect, style, bend } }]);
  }
  /** Live transform preview source: the layer alone, or the document without it (RGBA8). */
  renderLayerSplit(layer: number, alone: boolean, x: number, y: number, w: number, h: number) {
    return this.client.renderLayerSplit(this.docId, layer, alone, x, y, w, h);
  }
  /** Numeric free transform via an affine matrix [a,b,c,d,e,f]. */
  transformMatrix(matrix: number[], layer?: number) {
    return this.request([{ cmd: CMD.editTransform, params: { matrix, ...(layer == null ? {} : { layer }) } }]);
  }
  transformPreset(kind: 'rotate90Cw' | 'rotate90Ccw' | 'rotate180' | 'flipHorizontal' | 'flipVertical', layer?: number) {
    return this.request([...this.pixelFirst(layer), { cmd: `edit.transform.${kind}` }]);
  }
  transformSelection(params: Record<string, unknown>) {
    return this.request([{ cmd: CMD.transformSelection, params }]);
  }

  // --- Retouch ---
  spotHealing(points: [number, number][], size: number, layer?: number) {
    return this.request([...this.pixelFirst(layer), { cmd: CMD.paintSpotHealing, params: { points, size } }]);
  }
  healingBrush(points: [number, number][], source: [number, number], size: number, layer?: number) {
    return this.request([...this.pixelFirst(layer), { cmd: CMD.paintHealingBrush, params: { points, source, size } }]);
  }
  cloneStamp(points: [number, number][], source: [number, number], size: number, hardness: number, layer?: number) {
    return this.request([...this.pixelFirst(layer), { cmd: CMD.paintCloneStamp, params: { points, source, size, hardness: Math.round(hardness * 100), aligned: true } }]);
  }
  contentAwareFill(layer?: number) {
    return this.request([...this.pixelFirst(layer), { cmd: CMD.editContentAwareFill, params: {} }]);
  }

  // --- Filters (act on the active filterable layer, respect the selection) ---
  filter(cmd: string, params: Record<string, unknown>, layer?: number) {
    return this.request([...this.pixelFirst(layer), { cmd, params }]);
  }

  // --- Smart objects (act on the selected layer) ---
  convertToSmartObject(layer?: number) {
    return this.request([...this.pixelFirst(layer), { cmd: CMD.soConvert }]);
  }
  soViaCopy(layer?: number) {
    return this.request([...this.pixelFirst(layer), { cmd: CMD.soViaCopy }]);
  }
  rasterizeSmartObject(layer?: number) {
    return this.request([...this.pixelFirst(layer), { cmd: CMD.soRasterize }]);
  }
  soToLayers(layer?: number) {
    return this.request([...this.pixelFirst(layer), { cmd: CMD.soToLayers }]);
  }
  /** Opens the smart object's contents as a new document in the same engine (reply.openedDocs). */
  soEditContents(layer: number) {
    return this.request([{ cmd: CMD.layerSelect, params: { layer, mode: 'replace' } }, { cmd: 'layer.smartObjects.editContents' }]);
  }
  /** In an Edit Contents document: write it back into the parent smart object. */
  soSaveContents() {
    return this.request([{ cmd: 'layer.smartObjects.saveContents' }]);
  }

  // --- Layer tree ops ---
  newLayer(name?: string) {
    return this.request([{ cmd: CMD.layerNew, ...(name == null ? {} : { params: { name } }) }]);
  }
  duplicateLayer(id?: number) {
    return this.request([{ cmd: CMD.layerDuplicate, ...(id == null ? {} : { params: { layer: id } }) }]);
  }
  deleteLayer(id?: number) {
    return this.request([{ cmd: CMD.layerDelete, ...(id == null ? {} : { params: { layer: id } }) }]);
  }
  layerFromBackground() {
    return this.request([{ cmd: CMD.layerFromBackground }]);
  }
  /** Group the given layers (select them first, in one atomic batch). */
  groupLayers(ids: number[], name?: string) {
    return this.request([...selectBatch(ids), { cmd: CMD.layerGroup, ...(name == null ? {} : { params: { name } }) }]);
  }
  /** `kind:'all'` toggles the lock-all; others set a single lock flag. */
  lockLayer(id: number, kind: 'all' | 'transparency' | 'pixels' | 'position') {
    return this.request([{ cmd: CMD.layerSelect, params: { layer: id, mode: 'replace' } }, { cmd: CMD.layerLock, params: { [kind]: true } }]);
  }
  mergeDown(id?: number) {
    return this.request([...this.pixelFirst(id), { cmd: CMD.layerMergeDown }]);
  }
  mergeVisible() { return this.request([{ cmd: CMD.layerMergeVisible }]); }
  flattenImage() { return this.request([{ cmd: CMD.layerFlatten }]); }
  /** New solid-colour or gradient fill layer. */
  newFillLayer(kind: 'solid' | 'gradient', opts: { color?: string; from?: string; to?: string }) {
    return kind === 'solid'
      ? this.request([{ cmd: CMD.fillSolid, params: { color: opts.color ?? '#000000' } }])
      : this.request([{ cmd: CMD.fillGradient, params: { from: opts.from ?? '#000000', to: opts.to ?? '#ffffff' } }]);
  }

  // --- Layer styles (effects on the selected layer) ---
  layerStyle(cmd: string, params: Record<string, unknown>, layer?: number) {
    const pre: Batch = layer == null ? [] : [{ cmd: CMD.layerSelect, params: { layer, mode: 'replace' } }];
    return this.request([...pre, { cmd, params }]);
  }
  clearStyle(layer?: number) {
    const pre: Batch = layer == null ? [] : [{ cmd: CMD.layerSelect, params: { layer, mode: 'replace' } }];
    return this.request([...pre, { cmd: CMD.layerStyleClear }]);
  }

  // --- Clipping mask / selection store / stroke ---
  createClippingMask(layer?: number) {
    const pre: Batch = layer == null ? [] : [{ cmd: CMD.layerSelect, params: { layer, mode: 'replace' } }];
    return this.request([...pre, { cmd: CMD.layerClip }]);
  }
  releaseClippingMask(layer?: number) {
    const pre: Batch = layer == null ? [] : [{ cmd: CMD.layerSelect, params: { layer, mode: 'replace' } }];
    return this.request([...pre, { cmd: CMD.layerUnclip }]);
  }
  saveSelection(name: string) {
    return this.request([{ cmd: CMD.selectSave, params: { name, channel: 'new', operation: 'replace' } }]);
  }
  loadSelection(name: string) {
    return this.request([{ cmd: CMD.selectLoad, params: { channel: name, operation: 'new' } }]);
  }
  /** Stroke the current selection edge on the active pixel layer. */
  strokeSelection(color: string, width: number, location: 'inside' | 'center' | 'outside' = 'center', pixelLayer?: number) {
    return this.request([...this.pixelFirst(pixelLayer), { cmd: CMD.editStroke, params: { width, color, location } }]);
  }

  // --- Clipboard (the engine clipboard is shared by every document in the session) ---
  /** copy / cut act on the active layer (selected first); copyMerged reads the composite. */
  clipCopy(kind: 'copy' | 'cut' | 'copyMerged', layer?: number) {
    const cmd = kind === 'copy' ? 'edit.copy' : kind === 'cut' ? 'edit.cut' : 'edit.copyMerged';
    return this.request([...this.pixelFirst(kind === 'copyMerged' ? undefined : layer), { cmd }]);
  }
  clipPaste(kind: 'paste' | 'pasteInPlace' | 'pasteInto', center?: [number, number]) {
    const cmd = kind === 'paste' ? 'edit.paste' : kind === 'pasteInPlace' ? 'edit.pasteSpecial.pasteInPlace' : 'edit.pasteSpecial.pasteInto';
    return this.request([{ cmd, ...(center && kind !== 'pasteInPlace' ? { params: { center } } : {}) }]);
  }
  layerVia(kind: 'copy' | 'cut', layer?: number) {
    return this.request([...this.pixelFirst(layer), { cmd: kind === 'copy' ? 'layer.new.layerViaCopy' : 'layer.new.layerViaCut' }]);
  }
  /**
   * Puts an external image (system clipboard) on the engine clipboard: open it as a scratch
   * document in the same engine, Select All + Copy Merged there, close it. The caller then pastes.
   */
  async loadImageToClipboard(name: string, bytes: ArrayBuffer): Promise<{ width: number; height: number }> {
    const r = await this.client.open(name, bytes);
    const body = r.data as OpenReply | undefined;
    if (!r.ok || body?.status !== 'ok' || !body.result) throw new EngineError(r.error ?? body?.error ?? '无法读取剪贴板图片');
    const tmp = DocSession.attach(this.client, body.result.docId, body.result.revision ?? 0);
    try {
      await tmp.request([{ cmd: 'select.all' }, { cmd: 'edit.copyMerged' }]);
    } finally {
      await this.client.close(tmp.docId);
    }
    const d = body.result.document as { width?: number; height?: number } | undefined;
    return { width: d?.width ?? 0, height: d?.height ?? 0 };
  }

  // --- Shape / path (interactive tools) ---
  async shapeInfo(layer: number): Promise<ShapeInfo> {
    const r = await this.request([{ cmd: CMD.shapeInfo, params: { layer } }]);
    return r.results[0].value as ShapeInfo;
  }
  shapeEdit(layer: number, params: Record<string, unknown>) {
    return this.request([{ cmd: CMD.shapeEdit, params: { layer, ...params } }]);
  }
  /** `name:'work'` → the work path; `name:'layer'` → the given shape layer's path (selected first). */
  async pathInfo(name: 'work' | 'layer', layer?: number): Promise<unknown> {
    const pre: Batch = name === 'layer' && layer != null ? [{ cmd: CMD.layerSelect, params: { layer, mode: 'replace' } }] : [];
    const r = await this.request([...pre, { cmd: CMD.pathInfo, params: { name } }]);
    return (r.results[r.results.length - 1]?.value as { path?: unknown } | undefined)?.path;
  }
  async brushPresets(): Promise<{ name: string; size: number; hardness: number; tip: string }[]> {
    const r = await this.request([{ cmd: CMD.brushPresetsList }]);
    return ((r.results[0]?.value as { presets?: { name: string; size: number; hardness: number; tip: string }[] })?.presets) ?? [];
  }

  // --- Shape / path ---
  addShapeStyled(opts: { kind: string; rect: [number, number, number, number]; fill: string; stroke?: object; name?: string }) {
    return this.request([{ cmd: CMD.shapeCreate, params: { ...opts } }]);
  }
  selToWorkPath(tolerance = 2) {
    return this.request([{ cmd: CMD.selectToWorkPath, params: { tolerance } }]);
  }
  pathToSelection() {
    return this.request([{ cmd: CMD.pathToSelection, params: { name: 'work' } }]);
  }
  fillPath(color: string, pixelLayer?: number) {
    return this.request([...this.pixelFirst(pixelLayer), { cmd: CMD.pathFill, params: { name: 'work', color } }]);
  }
  strokePath(color: string, size: number, pixelLayer?: number) {
    return this.request([...this.pixelFirst(pixelLayer), { cmd: CMD.pathStroke, params: { name: 'work', color, size } }]);
  }
  setWorkPath(subpaths: object[]) {
    return this.request([{ cmd: CMD.pathSet, params: { name: 'work', path: { subpaths } } }]);
  }
  pathBoolean(subpaths: object[], op: 'combine' | 'subtract' | 'intersect' | 'exclude') {
    return this.request([{ cmd: CMD.pathSet, params: { name: 'work', op, path: { subpaths } } }]);
  }
  moveAnchors(anchors: [number, number][], move: [number, number]) {
    return this.request([{ cmd: CMD.pathMoveAnchors, params: { name: 'work', anchors, move } }]);
  }
  convertPoint(subpath: number, knot: number, out: [number, number]) {
    return this.request([{ cmd: CMD.pathConvertPoint, params: { name: 'work', subpath, knot, out } }]);
  }
  async pathList(): Promise<{ workPath?: { knots: number; subpaths: number } }> {
    const reply = await this.request([{ cmd: CMD.pathList }]);
    return (reply.results[0]?.value ?? {}) as { workPath?: { knots: number; subpaths: number } };
  }

  // --- Channels / guides / warp ---
  newChannel(name?: string) {
    return this.request([{ cmd: CMD.channelNew, params: { ...(name ? { name } : {}), fill: 'black' } }]);
  }
  duplicateChannel(channel: number) {
    return this.request([{ cmd: CMD.channelDup, params: { channel } }]);
  }
  deleteChannel(channel: number) {
    return this.request([{ cmd: CMD.channelDelete, params: { channel } }]);
  }
  newGuide(orientation: 'horizontal' | 'vertical', position: number) {
    return this.request([{ cmd: CMD.viewNewGuide, params: { orientation, position } }]);
  }
  clearGuidesCmd() {
    return this.request([{ cmd: CMD.viewClearGuides }]);
  }
  warp(style: string, bend: number, pixelLayer?: number) {
    return this.request([...this.pixelFirst(pixelLayer), { cmd: CMD.editWarp, params: { style, bend } }]);
  }

  // --- Vector mask (coexists with the pixel layer mask) ---
  vectorMaskFromPath(layer: number) {
    return this.request([{ cmd: CMD.vmFromPath, params: { layer, name: 'work' } }]);
  }
  vectorMaskDelete(layer: number) {
    return this.request([{ cmd: CMD.vmDelete, params: { layer } }]);
  }
  vectorMaskEnabled(layer: number, enabled: boolean) {
    return this.request([{ cmd: CMD.vmEnabled, params: { layer, enabled } }]);
  }
  /** Read-back; undefined when the layer has no vector mask (the engine rejects the query). */
  async vectorMaskInfo(layer: number): Promise<{ enabled: boolean; subpaths: number } | undefined> {
    try {
      const reply = await this.request([{ cmd: CMD.vmInfo, params: { layer } }]);
      const v = reply.results[0]?.value as { enabled?: boolean; path?: { subpaths?: unknown[] } } | undefined;
      if (!v || !v.path) return undefined;
      return { enabled: !!v.enabled, subpaths: v.path.subpaths?.length ?? 0 };
    } catch {
      return undefined;
    }
  }

  // --- Eyedropper: reads the *composite* pixel (verified against the CLI). ---
  async pixel(x: number, y: number): Promise<number[] | undefined> {
    const reply = await this.request([{ cmd: CMD.docPixel, params: { x: Math.round(x), y: Math.round(y) } }]);
    const v = reply.results[0]?.value;
    return Array.isArray(v) ? (v as number[]) : undefined;
  }

  // --- Type (character / paragraph) ---
  async typeInfo(layer?: number): Promise<unknown> {
    const reply = await this.request([{ cmd: CMD.typeInfo, ...(layer == null ? {} : { params: { layer } }) }]);
    return reply.results[0]?.value;
  }
  async typeFonts(): Promise<string[]> {
    const reply = await this.request([{ cmd: CMD.typeFonts }]);
    const v = reply.results[0]?.value as { families?: unknown } | undefined;
    return Array.isArray(v?.families) ? (v!.families as string[]) : [];
  }
  setTextStyle(params: Record<string, unknown>, layer?: number) {
    return this.request([{ cmd: CMD.typeSetStyle, params: { ...(layer == null ? {} : { layer }), ...params } }]);
  }
  /** Orientation acts on the active type layer, so select it in the same atomic batch. */
  typeOrientation(dir: 'horizontal' | 'vertical', layer?: number) {
    const pre: Batch = layer == null ? [] : [{ cmd: CMD.layerSelect, params: { layer, mode: 'replace' } }];
    return this.request([...pre, { cmd: `type.orientation.${dir}` }]);
  }

  async save(format = 'psd'): Promise<{ bytes: ArrayBuffer; info: unknown }> {
    const r = await this.client.save(this.docId, format);
    if (!r.ok) throw new EngineError(r.error ?? 'save failed');
    return { bytes: r.data.bytes, info: r.data.info };
  }

  /** Close just this document in the shared engine. Closing an Edit Contents document commits
   *  it into its parent (engine behaviour); the parent shows up in the returned `touchedDocs`. */
  async closeDoc(): Promise<DocEvents | undefined> {
    const r = await this.client.close(this.docId);
    const ev = r.ok ? docEvents(r.data) : undefined;
    if (ev) this.onEvents?.(ev, this);
    return ev;
  }

  dispose() {
    if (this.owner) void this.client.close(this.docId).finally(() => { unregisterClient(this.client); this.client.terminate(); });
    else void this.client.close(this.docId);
  }
}
