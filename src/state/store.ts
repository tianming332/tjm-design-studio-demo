import { create } from 'zustand';
import { DocSession, EngineError, toRects, selectBatch, type Anchor, type BrushOpts, type Resample, type ShapeInfo } from '../engine/session';
import { normPath, toEngine, translatePath, type PathData } from '../engine/pathgeom';
import type { BoxStyle } from '../engine/selection';
import { blankImage } from '../engine/blank';
import { snapshotDataUrl } from '../engine/render';
import { unpackSelectionMask } from '../engine/protocol';
import { compose, decompose, flipQuad, isAffine, quadPoint, rectCorners, rotateQuad, rotateScaleMatrix, warpGrid, type AffineParams, type Quad, type Rect4 } from '../engine/transform';
import { parseTypeInfo, styleParams, type TextStyleUI } from '../engine/typeinfo';
import { rgb01ToHex } from '../engine/color';
import { DEFAULT_FONT, defaultTypeSize, fontLibrary, type LibraryFont } from '../engine/fonts';
import type { Unit } from '../engine/units';
import { clearSnapshot, getSnapshot, putSnapshot, recoveryFileName } from '../engine/autosave';
import type { DocEvents, DocInspect, LayerLocks, LayerNode, LayerProps, PaintTarget, Rect, SelectMode, SelectionMask } from '../engine/protocol';
import { layerDropProblem, type LayerDropPosition } from '../engine/layerOrder';
import { extrudeText, textFxBatch, type ExtrudeArgs, type TextFxArgs } from '../engine/textfx';
import { lintDoc, type LintIssue } from '../engine/layout';
import { adjustBatch, regionApplyBatch, regionRefineBatch, regionSelectBatch, type AdjustArgs, type RegionOp, type RegionRefineArgs } from '../engine/region';

/** Canvas tools. `hand` only pans; `move` drags the selected layer. */
export type Tool =
  | 'move' | 'marqueeRect' | 'marqueeEllipse' | 'lasso' | 'wand' | 'hand'
  | 'brush' | 'pencil' | 'eraser' | 'bucket' | 'gradient' | 'transform'
  | 'spotHeal' | 'healBrush' | 'clone' | 'eyedropper'
  | 'marqueeRow' | 'marqueeCol' | 'polyLasso' | 'shape' | 'pen' | 'pathSelect' | 'directSelect' | 'crop' | 'type';

export interface TypeOpts { font: string; size: number; align: 'left' | 'center' | 'right'; orientation: 'horizontal' | 'vertical' }
/** On-canvas text editing: a new point/paragraph text, or an existing type layer. */
export interface TypeEditing {
  layer?: number;
  /** Point text: baseline anchor. Paragraph text: `box` [x, y, w, h]. Existing layer: its bounds. */
  x: number; y: number;
  box?: [number, number, number, number];
  bounds?: [number, number, number, number];
  text: string;
  original: string;
  /** Existing layer: style when editing started (changed keys are written back on commit). */
  origStyle?: { font: string; size: number; color: string; align: TypeOpts['align']; orientation: TypeOpts['orientation'] };
  font: string; size: number; color: string; align: TypeOpts['align']; orientation: TypeOpts['orientation'];
}

/** Free Transform sub-mode (right-click menu). `free` = Photoshop's default handle semantics. */
export type TfMode = 'free' | 'scale' | 'rotate' | 'skew' | 'distort' | 'perspective' | 'warp';
export interface TransformSession {
  /** Source frame [x0,y0,x1,y1] and where its corners go (TL,TR,BR,BL). */
  rect: Rect4;
  quad: Quad;
  mode: TfMode;
  /** Reference point in frame unit coordinates (0..1). */
  ref: [number, number];
  /** Warp mode: 16 control points (one Bézier patch, row-major). */
  warp?: [number, number][];
  layer?: number;
  /** Live pixel preview is possible (no selection: the whole layer moves). */
  preview: boolean;
}

/** Crop tool: frame (document px, before rotation) and rotation in degrees about its centre. */
export interface CropSession { box: [number, number, number, number]; angle: number }
export interface CropOpts { ratio: 'free' | '1:1' | '4:3' | '16:9' | 'custom'; w: number; h: number; deletePixels: boolean }

/** Selection tools that honour the options-bar mode / feather / anti-alias. */
export const SELECT_TOOLS: Tool[] = ['marqueeRect', 'marqueeEllipse', 'marqueeRow', 'marqueeCol', 'lasso', 'polyLasso', 'wand'];
/** Tools that edit vector paths (overlay shows the active path). */
export const PATH_TOOLS: Tool[] = ['pen', 'pathSelect', 'directSelect'];

export type ShapeKind = 'rect' | 'roundedRect' | 'ellipse' | 'polygon' | 'star' | 'line';
export type PathOp = 'new' | 'combine' | 'subtract' | 'intersect' | 'exclude';
export interface ShapeOpts { kind: ShapeKind; fill: string; noFill: boolean; strokeColor: string; strokeWidth: number; radius: number; sides: number; starRatio: number; pathOp: PathOp }
export interface SelectOpts { mode: SelectMode; feather: number; antiAlias: boolean; style: BoxStyle }
/** The path the path tools act on: the selected shape layer's, else the work path. */
export interface ActivePath { source: 'work' | 'layer'; layer?: number; path: PathData }

export const PAINT_TOOLS: Tool[] = ['brush', 'pencil', 'eraser'];
/** Tools that paint along a dragged path (brush-like gesture): paint + retouch. */
export const STROKE_TOOLS: Tool[] = ['brush', 'pencil', 'eraser', 'spotHeal', 'healBrush', 'clone'];
/** Retouch tools that need an Alt-click sample source before painting. */
export const SAMPLED_TOOLS: Tool[] = ['healBrush', 'clone'];

export interface BrushState { size: number; hardness: number; opacity: number; flow: number; tolerance: number }

export interface ViewState { scale: number; tx: number; ty: number }

/** One open document in the shared engine. `parent` is set for Edit Contents documents. */
export interface DocTab {
  docId: string;
  name: string;
  session: DocSession;
  parent?: string;
  /** Smart-object layer in the parent this document edits (Edit Contents). */
  parentLayer?: number;
  /** The file a root document was opened from (Revert). */
  originalFile?: File;
}

/** File › New options (A29). */
export interface NewDocOpts {
  resolution?: number;
  mode?: 'rgb' | 'grayscale' | 'cmyk' | 'lab';
  depth?: 8 | 16 | 32;
  background?: 'white' | 'black' | 'backgroundColor' | 'transparent';
  profile?: string;
  name?: string;
}

/** Per-document view (zoom/pan) so switching tabs keeps each document where it was. */
const viewByDoc = new Map<string, ViewState>();
const CMD_IMAGE_SIZE = 'image.imageSize';
let untitled = 0;

interface RenderSignal { nonce: number; damage: Rect[] | null } // null = full redraw

interface AppState {
  session?: DocSession;
  /** Every document open in the engine (multi-document bridge); `session` is the active one's. */
  tabs: DocTab[];
  activeDocId?: string;
  switchTab(docId: string): Promise<void>;
  /** Close a document tab. Root documents ask before discarding unsaved edits unless `force`. */
  closeTab(docId: string, force?: boolean): Promise<void>;
  editSmartObject(): Promise<void>;
  saveSmartObject(): Promise<void>;
  fileName?: string;
  doc?: { width: number; height: number; resolution?: number };
  layers: LayerNode[];
  selectedId?: number;
  selectedIds: number[];
  view: ViewState;
  backend: 'gpu' | 'cpu' | 'unknown';
  warnings: string[];
  busy: boolean;
  error?: string;
  historyDepth: { canUndo: boolean; canRedo: boolean };
  render: RenderSignal;
  /** `render.nonce` of the last frame actually drawn to the canvas (repaint is async). */
  paintedNonce: number;
  activeWorkspace: string;
  baselineSnapshot?: string;
  compare: boolean;
  activeTool: Tool;
  wandTolerance: number;
  /** Magic wand: only connected pixels / sample the merged image instead of the active layer. */
  wandContiguous: boolean;
  wandSampleAll: boolean;
  setWandOptions(o: { contiguous?: boolean; sampleAll?: boolean }): void;
  /** Move tool: shift the selected layer by whole pixels (arrow keys). */
  nudgeLayer(dx: number, dy: number): Promise<void>;
  selection?: SelectionMask;
  foreground: string;
  background: string;
  brush: BrushState;
  channels: { name: string; index: number }[];
  guides: { orientation: 'horizontal' | 'vertical'; position: number }[];
  textInfo?: TextStyleUI;
  fontFamilies: string[];
  /** Downloadable font library (labels, tags, licences) — see engine/fonts.ts. */
  fontLibrary: LibraryFont[];
  /** Undo-stack labels (last entry = current state). */
  history: string[];
  /** The file the document was opened from, kept so Revert can re-open it. */
  originalFile?: File;
  /** Vector mask of the selected layer (read back via layer.vectorMask.info). */
  vectorMask?: { enabled: boolean; subpaths: number };
  maskEditing: boolean;
  transformSession?: TransformSession;
  setTransformMode(m: TfMode): Promise<void>;
  /** Right-click menu quarter turns / flips, applied inside the session. */
  transformSessionOp(op: 'rotate180' | 'rotate90Cw' | 'rotate90Ccw' | 'flipH' | 'flipV'): void;
  setTransformRef(uv: [number, number]): void;
  /** Options-bar numbers (affine frames only). */
  setTransformNumeric(p: Partial<AffineParams>): void;
  updateTransformWarp(points: [number, number][]): void;
  warpPresetCommit(style: string, bend: number): Promise<void>;
  transformSel: boolean;
  cloneSource?: [number, number];
  // Interactive tools (A25)
  selectOpts: SelectOpts;
  setSelectOpts(p: Partial<SelectOpts>): void;
  moveSelection(dx: number, dy: number): Promise<void>;
  shapeOpts: ShapeOpts;
  setShapeOpts(p: Partial<ShapeOpts>): void;
  /** Creates a shape layer from a dragged box (or line endpoints). */
  drawShape(box: { x: number; y: number; width: number; height: number }, line?: { from: [number, number]; to: [number, number] }): Promise<void>;
  /** Live-shape readback of the selected shape layer (handles overlay). */
  shapeInfo?: ShapeInfo;
  refreshShapeInfo(): Promise<void>;
  editShape(params: Record<string, unknown>): Promise<void>;
  autoSelect: boolean;
  autoSelectTarget: 'layer' | 'group';
  setAutoSelect(on: boolean, target?: 'layer' | 'group'): void;
  /** Auto-Select: make the topmost layer with pixels at (x, y) the selected one. */
  pickLayerAt(x: number, y: number): Promise<number | undefined>;
  setLocks(locks: Partial<LayerLocks>): Promise<void>;
  /** Delete key: clear pixels inside the selection, else delete the selected layer. */
  deleteKey(): Promise<void>;
  brushPresets: { name: string; size: number; hardness: number; tip: string }[];
  brushPreset?: string;
  loadBrushPresets(): Promise<void>;
  setBrushPreset(name?: string): void;
  penMode: 'path' | 'shape';
  setPenMode(m: 'path' | 'shape'): void;
  activePath?: ActivePath;
  refreshActivePath(): Promise<void>;
  /** Writes an edited path back (one history step). */
  commitPath(path: PathData): Promise<void>;
  /** Pen tool finished a subpath: append to the work path, or create a shape layer (shape mode). */
  penFinish(sub: { closed: boolean; knots: PathData['subpaths'][number]['knots'] }): Promise<void>;
  /** Path selection (black arrow): move the whole active path by (dx, dy). */
  movePath(dx: number, dy: number): Promise<void>;
  /** Combine the selected shape layers into the bottom one with a path operation (A29). */
  combineShapes(op: Exclude<PathOp, 'new'>): Promise<void>;
  /** Bake a shape layer's path operations into plain outlines. */
  mergeShapeComponents(): Promise<void>;
  /** Box-select layers whose bounds intersect a document rectangle (move tool). */
  selectLayersInBox(box: [number, number, number, number], additive: boolean): void;
  // Clipboard / view / crop (A26)
  /** Short feedback line for clipboard actions (status bar). */
  notice?: string;
  /** Floating hint (shortcut feedback, eyedropper, …); `action` adds a button. */
  toast?: { text: string; action?: 'workMode'; swatch?: string; id: number };
  showToast(text: string, o?: { action?: 'workMode'; swatch?: string }): void;
  commandPaletteOpen: boolean;
  /** Eyedropper feedback ring on the canvas (new colour above, previous below). */
  sampleFlash?: { x: number; y: number; color: string; prev: string; at: number };
  /** Command palette → filter panel: preselect this filter id. */
  filterPick?: string;
  /** Command palette / menus → open the New Document dialog. */
  newDocOpen: boolean;
  /** Something was copied inside the editor since the window last lost focus: Ctrl/Cmd+V pastes
   *  that rather than an (older) image on the system clipboard. */
  internalClipFresh: boolean;
  clipboardCopy(kind: 'copy' | 'cut' | 'copyMerged'): Promise<void>;
  clipboardPaste(kind: 'paste' | 'pasteInPlace' | 'pasteInto'): Promise<void>;
  layerVia(kind: 'copy' | 'cut'): Promise<void>;
  /** An image from the system clipboard: paste it as a new layer (or open it when no document). */
  pasteExternalImage(blob: Blob): Promise<void>;
  viewport: { w: number; h: number };
  setViewport(w: number, h: number): void;
  zoomBy(factor: number): void;
  fitView(): void;
  actualPixels(): void;
  cropSession?: CropSession;
  cropOpts: CropOpts;
  setCropOpts(p: Partial<CropOpts>): void;
  startCrop(): void;
  setCrop(c: CropSession): void;
  commitCrop(): Promise<void>;
  cancelCrop(): void;
  revealAll(): Promise<void>;
  /** Keyboard Lock state (fullscreen work mode lets Ctrl+T/W/N reach the editor). */
  keyboardLocked: boolean;
  setKeyboardLocked(on: boolean): void;
  // Type tool (A28)
  typeOpts: TypeOpts;
  setTypeOpts(p: Partial<TypeOpts>): void;
  typeEditing?: TypeEditing;
  /** Type tool click (or drag `box`): edit the type layer under the point, else start new text. */
  beginType(x: number, y: number, box?: [number, number, number, number]): Promise<void>;
  setTypeText(text: string): void;
  commitType(): Promise<void>;
  cancelType(): void;

  openFile(file: File): Promise<void>;
  newDocument(width: number, height: number, opts?: NewDocOpts): Promise<void>;
  /** Drop / place an image file into the active document as a new layer (PS: Place). */
  placeImage(file: File): Promise<void>;
  /** Image › Mode / bit depth / profile / resolution (A29). */
  imageMode(mode: 'rgb' | 'grayscale' | 'cmyk' | 'lab' | 'bits8' | 'bits16' | 'bits32'): Promise<void>;
  imageProfile(kind: 'assign' | 'convert', profile: string): Promise<void>;
  setResolution(ppi: number, resample: boolean): Promise<void>;
  docInfo?: { mode: string; depth: number; profile?: string };
  refreshDocInfo(): Promise<void>;
  /** AI bridge: sync layers / history / canvas after an agent edit of `docId` (no-op for background tabs). */
  aiAfterEdit(docId: string, damage: unknown): Promise<void>;
  selectLayer(id: number, additive?: boolean): void;
  setProps(id: number, props: Partial<LayerProps>): Promise<void>;
  moveLayer(id: number, dx: number, dy: number): Promise<void>;
  editText(id: number, text: string): Promise<void>;
  addText(text: string): Promise<void>;
  addShape(kind: 'rect' | 'ellipse', fill: string): Promise<void>;
  align(edge: string): Promise<void>;
  distribute(mode: string): Promise<void>;
  arrange(dir: 'bringForward' | 'sendBackward' | 'bringToFront' | 'sendToBack'): Promise<void>;
  reorderLayers(ids: number[], target: number, position: LayerDropPosition, docId: string, revision: number): Promise<void>;
  editTextContent(layer: number, text: string, original: string, docId: string): Promise<boolean>;
  undo(): Promise<void>;
  redo(): Promise<void>;
  crop(rect: { x: number; y: number; width: number; height: number }): Promise<void>;
  resizeImage(width: number, height: number, resample?: Resample): Promise<void>;
  resizeCanvas(width: number, height: number, opts?: { anchor?: Anchor; extensionColor?: string; relative?: boolean }): Promise<void>;
  rotate(kind: '90cw' | '90ccw' | '180' | 'flipCanvasHorizontal' | 'flipCanvasVertical'): Promise<void>;
  auto(kind: 'autoTone' | 'autoContrast' | 'autoColor'): Promise<void>;
  addAdjustment(cmd: string): Promise<void>;
  setAdjustment(layerId: number, params: Record<string, unknown>): Promise<void>;
  save(): Promise<void>;
  exportAs(format: 'png' | 'jpeg' | 'psd' | 'pcraft'): Promise<void>;
  // Rulers
  rulerUnit: Unit;
  // Autosave & crash recovery (HIS-003)
  /** A snapshot left by a previous session, offered for restore at startup. */
  recovery?: { name: string; savedAt: number };
  autosaveAt?: number;
  /** Root-document revision covered by the latest snapshot (or explicit save). */
  autosavedRevision: number | null;
  autosaveNow(): Promise<void>;
  checkRecovery(): Promise<void>;
  recoverAutosave(): Promise<void>;
  discardRecovery(): Promise<void>;
  showRulers: boolean;
  setRulerUnit(u: Unit): void;
  setShowRulers(on: boolean): void;
  setView(partial: Partial<ViewState>): void;
  setBackend(b: 'gpu' | 'cpu'): void;
  markPainted(nonce: number): void;
  requestFullRedraw(): void;
  setWorkspace(id: string): void;
  captureBaselineIfNeeded(): void;
  setCompare(on: boolean): void;
  setTool(t: Tool): void;
  setWandTolerance(v: number): void;
  refreshSelection(): Promise<void>;
  marquee(box: { x: number; y: number; width: number; height: number }, mode: SelectMode, ellipse: boolean): Promise<void>;
  lasso(points: [number, number][], mode: SelectMode): Promise<void>;
  magicWand(x: number, y: number, mode: SelectMode): Promise<void>;
  selectMenu(kind: 'all' | 'deselect' | 'inverse' | 'reselect' | 'grow' | 'similar'): Promise<void>;
  /** 智能选区: subject / focus over the document; object = recognise the object inside the current selection box. */
  smartSelect(method: 'subject' | 'focus' | 'object'): Promise<void>;
  refineSelection(a: RegionRefineArgs): Promise<void>;
  /** Selection AI operation on the active pixel layer; the result is a new layer. */
  regionOp(op: RegionOp): Promise<void>;
  /** Adjustment layer masked by the selection (or global without one). */
  regionAdjust(a: AdjustArgs): Promise<void>;
  /** doc_lint on the active document (same checks the agent runs before delivering). */
  lintDocument(): Promise<LintIssue[]>;
  selectModify(kind: 'border' | 'smooth' | 'expand' | 'contract' | 'feather', radius: number): Promise<void>;
  fillSelection(color: string): Promise<void>;
  clearPixels(): Promise<void>;
  cropToSelection(): Promise<void>;
  selectionToMask(): Promise<void>;
  // Paint & colour
  setForeground(hex: string): void;
  setBackground(hex: string): void;
  swapColors(): Promise<void>;
  defaultColors(): Promise<void>;
  setBrush(partial: Partial<BrushState>): void;
  paintStroke(points: ([number, number] | [number, number, number])[]): Promise<void>;
  paintBucket(x: number, y: number): Promise<void>;
  paintGradient(from: [number, number], to: [number, number], style?: string): Promise<void>;
  // Mask
  addMask(kind: 'revealAll' | 'hideAll' | 'revealSelection' | 'hideSelection'): Promise<void>;
  deleteMask(): Promise<void>;
  applyMask(): Promise<void>;
  setMaskEditing(on: boolean): void;
  // Transform
  enterTransform(): void;
  updateTransform(quad: Quad): void;
  commitTransform(): Promise<void>;
  cancelTransform(): void;
  transformNumeric(deg: number, scalePct: number): Promise<void>;
  transformPreset(kind: 'rotate90Cw' | 'rotate90Ccw' | 'rotate180' | 'flipHorizontal' | 'flipVertical'): Promise<void>;
  setTransformSel(on: boolean): void;
  // Retouch
  setCloneSource(pt: [number, number]): void;
  retouchStroke(points: [number, number][]): Promise<void>;
  contentAwareFill(): Promise<void>;
  // Filters
  applyFilter(cmd: string, params: Record<string, unknown>): Promise<void>;
  // Smart objects
  convertToSmartObject(): Promise<void>;
  soViaCopy(): Promise<void>;
  rasterizeSmartObject(): Promise<void>;
  soToLayers(): Promise<void>;
  // Layer tree ops
  newLayer(): Promise<void>;
  duplicateLayer(): Promise<void>;
  deleteLayer(): Promise<void>;
  layerFromBackground(): Promise<void>;
  groupLayers(): Promise<void>;
  lockLayer(kind: 'all' | 'transparency'): Promise<void>;
  mergeDown(): Promise<void>;
  mergeVisible(): Promise<void>;
  flattenImage(): Promise<void>;
  newFillLayer(kind: 'solid' | 'gradient'): Promise<void>;
  // Layer styles
  applyLayerStyle(cmd: string, params: Record<string, unknown>): Promise<void>;
  clearLayerStyle(): Promise<void>;
  /** Text-effect preset / warp on the selected layer (same batches the agent's text_fx_apply runs). */
  applyTextFx(a: Omit<TextFxArgs, 'layer'>): Promise<void>;
  /** 立体字 on the selected layer (rebuilds when it is already extruded). */
  extrudeSelected(a: Omit<ExtrudeArgs, 'layer'>): Promise<void>;
  // Clipping mask / selection store / stroke
  createClippingMask(): Promise<void>;
  releaseClippingMask(): Promise<void>;
  saveSelection(): Promise<void>;
  loadSelection(): Promise<void>;
  strokeSelection(color: string, width: number): Promise<void>;
  // Shape / path
  addShapeStyled(kind: string, fill: string, stroke?: object): Promise<void>;
  selToWorkPath(): Promise<void>;
  workPathToSelection(): Promise<void>;
  fillWorkPath(color: string): Promise<void>;
  strokeWorkPath(color: string, width: number): Promise<void>;
  pathBooleanFromSelection(op: 'combine' | 'subtract' | 'intersect' | 'exclude'): Promise<void>;
  setWorkPathRect(rect: [number, number, number, number]): Promise<void>;
  moveAnchor(anchors: [number, number][], move: [number, number]): Promise<void>;
  convertAnchor(subpath: number, knot: number, out: [number, number]): Promise<void>;
  pathSubpaths(): Promise<number>;
  // Channels / guides / warp
  newChannel(): Promise<void>;
  duplicateChannel(index: number): Promise<void>;
  deleteChannel(index: number): Promise<void>;
  addGuide(orientation: 'horizontal' | 'vertical', position: number): Promise<void>;
  clearGuides(): Promise<void>;
  warp(style: string, bend: number): Promise<void>;
  // Type (character / paragraph)
  refreshTextInfo(): Promise<void>;
  applyTextStyle(ui: TextStyleUI): Promise<void>;
  setTextOrientation(dir: 'horizontal' | 'vertical'): Promise<void>;
  loadFonts(): Promise<void>;
  // Eyedropper / history / revert
  sampleColor(x: number, y: number): Promise<void>;
  jumpHistory(index: number): Promise<void>;
  revertDocument(): Promise<void>;
  // Vector mask
  refreshVectorMask(): Promise<void>;
  addVectorMaskFromPath(): Promise<void>;
  deleteVectorMask(): Promise<void>;
  setVectorMaskEnabled(on: boolean): Promise<void>;
}

function flatten(nodes: LayerNode[], out: LayerNode[] = []): LayerNode[] {
  for (const n of nodes) { out.push(n); if (n.children) flatten(n.children, out); }
  return out;
}

/** Pure selection reducer: replace (non-additive) or toggle (additive, for Shift/Cmd click). */
export function multiSelect(current: number[], id: number, additive: boolean): number[] {
  if (!additive) return [id];
  return current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
}

export const useStore = create<AppState>((set, get) => ({
  layers: [],
  selectedIds: [],
  view: { scale: 1, tx: 0, ty: 0 },
  backend: 'unknown',
  warnings: [],
  busy: false,
  historyDepth: { canUndo: false, canRedo: false },
  render: { nonce: 0, damage: null },
  paintedNonce: 0,
  activeWorkspace: 'edit',
  compare: false,
  activeTool: 'move',
  wandTolerance: 32,
  wandContiguous: true,
  wandSampleAll: false,
  setWandOptions(o) {
    set({ ...(o.contiguous != null ? { wandContiguous: o.contiguous } : {}), ...(o.sampleAll != null ? { wandSampleAll: o.sampleAll } : {}) });
  },
  async nudgeLayer(dx, dy) {
    const id = get().selectedId;
    if (id == null || (!dx && !dy)) return;
    await applyEdit(get, set, (s) => s.moveLayer(id, dx, dy));
  },
  foreground: '#000000',
  background: '#ffffff',
  brush: { size: 24, hardness: 0.85, opacity: 1, flow: 1, tolerance: 32 },
  maskEditing: false,
  transformSel: false,
  channels: [],
  guides: [],
  fontFamilies: [],
  fontLibrary: [],
  history: [],
  rulerUnit: 'px',
  showRulers: true,
  selectOpts: { mode: 'replace', feather: 0, antiAlias: true, style: { kind: 'normal' } },
  shapeOpts: { kind: 'rect', fill: '#3366cc', noFill: false, strokeColor: '#000000', strokeWidth: 0, radius: 12, sides: 5, starRatio: 0.5, pathOp: 'new' },
  autoSelect: true,
  autoSelectTarget: 'layer',
  brushPresets: [],
  penMode: 'path',
  viewport: { w: 0, h: 0 },
  cropOpts: { ratio: 'free', w: 1, h: 1, deletePixels: true },
  keyboardLocked: false,
  internalClipFresh: false,
  commandPaletteOpen: false,
  newDocOpen: false,
  showToast(text, o = {}) { set({ toast: { text, ...o, id: (get().toast?.id ?? 0) + 1 } }); },
  typeOpts: { font: DEFAULT_FONT, size: 36, align: 'left', orientation: 'horizontal' },
  tabs: [],
  autosavedRevision: null,

  async autosaveNow() {
    const st = get();
    const root = st.tabs.find((t) => t.docId === st.activeDocId && !t.parent) ?? st.tabs.find((t) => !t.parent);
    if (!root || st.busy) return;
    const revision = root.session.currentRevision;
    if (st.autosavedRevision === revision) return;
    try {
      const { bytes } = await root.session.save('pcraft');
      if (!bytes || bytes.byteLength === 0) return;
      await putSnapshot({ name: root.name, bytes, savedAt: Date.now(), revision });
      set({ autosaveAt: Date.now(), autosavedRevision: revision });
    } catch {
      /* best effort: a failed snapshot must never disturb editing */
    }
  },

  async checkRecovery() {
    const rec = await getSnapshot().catch(() => undefined);
    set({ recovery: rec ? { name: rec.name, savedAt: rec.savedAt } : undefined });
  },

  async recoverAutosave() {
    const rec = await getSnapshot().catch(() => undefined);
    set({ recovery: undefined });
    if (!rec) { set({ error: '没有可恢复的自动保存' }); return; }
    await get().openFile(new File([rec.bytes], recoveryFileName(rec.name), { type: 'application/octet-stream' }));
  },

  async discardRecovery() {
    await clearSnapshot().catch(() => undefined);
    set({ recovery: undefined });
  },

  async switchTab(docId) {
    if (docId === get().activeDocId) return;
    await activateTab(get, set, docId);
  },

  async closeTab(docId, force) {
    const tab = get().tabs.find((t) => t.docId === docId);
    if (!tab) return;
    if (!tab.parent) {
      const dirty = tab.session.currentRevision > 0 && !(get().activeDocId === docId && get().autosavedRevision === tab.session.currentRevision);
      if (!force && dirty && !window.confirm(`「${tab.name}」有未保存的修改，确定关闭？`)) return;
      set({ busy: true, error: undefined });
      try {
        // Children (Edit Contents) of this document close with it.
        for (const c of get().tabs.filter((t) => t.parent === docId)) await c.session.closeDoc().catch(() => undefined);
        await tab.session.closeDoc();
      } catch { /* the engine may already have dropped it */ }
      viewByDoc.delete(docId);
      const rest = get().tabs.filter((t) => t.docId !== docId && t.parent !== docId);
      set({ busy: false, tabs: rest });
      const next = get().activeDocId === docId || !get().activeDocId ? rest.find((t) => !t.parent)?.docId ?? rest[0]?.docId : get().activeDocId;
      if (next) await activateTab(get, set, next);
      else {
        set({
          session: undefined, activeDocId: undefined, doc: undefined, layers: [], selectedId: undefined, selectedIds: [], fileName: undefined,
          history: [], historyDepth: { canUndo: false, canRedo: false }, selection: undefined, transformSession: undefined, cropSession: undefined,
          typeEditing: undefined, shapeInfo: undefined, activePath: undefined, docInfo: undefined,
          render: { nonce: get().render.nonce + 1, damage: null },
        });
      }
      return;
    }
    set({ busy: true, error: undefined });
    try {
      // Closing an Edit Contents document commits it into the parent (engine behaviour);
      // the events handler drops the tab and realigns the parent's revision.
      await tab.session.closeDoc();
      // Drop the tab even if the bridge reply did not list it (older bridge builds).
      set({ busy: false, tabs: get().tabs.filter((t) => t.docId !== docId) });
      const active = get().activeDocId;
      await activateTab(get, set, active === docId || !active ? tab.parent : active);
    } catch (e) {
      set({ busy: false, error: errText(e) });
    }
  },

  async editSmartObject() {
    const { session, selectedId, layers } = get();
    if (!session || selectedId == null) return;
    const layer = flatten(layers).find((l) => l.id === selectedId);
    if (!layer || !/smart.?object/i.test(layer.kind)) { set({ error: '请先选中一个智能对象图层' }); return; }
    set({ busy: true, error: undefined });
    try {
      const body = await session.soEditContents(selectedId);
      set({ busy: false });
      const opened = body.openedDocs?.[0]?.docId;
      if (opened) {
        set({ tabs: get().tabs.map((t) => (t.docId === opened ? { ...t, parentLayer: selectedId } : t)) });
        await activateTab(get, set, opened);
        return;
      }
      // Already open for editing: the engine switched to it; do the same.
      const existing = get().tabs.find((t) => t.parent === session.docId && t.parentLayer === selectedId);
      if (existing) await activateTab(get, set, existing.docId);
    } catch (e) {
      set({ busy: false, error: errText(e) });
    }
  },

  async saveSmartObject() {
    const tab = get().tabs.find((t) => t.docId === get().activeDocId);
    if (!tab?.parent) { set({ error: '当前文档不是智能对象的内容文档' }); return; }
    await applyEdit(get, set, (s) => s.soSaveContents());
  },

  async openFile(file) {
    // Multi-document: every opened file becomes a new tab in the same engine (one Worker).
    const host = get().tabs[0]?.session;
    if (host) {
      set({ busy: true, error: undefined });
      try {
        const s = await DocSession.openIn(host.client, file);
        s.onEvents = handleDocEvents;
        try { await s.resolveMissingFonts(); } catch { /* optional */ }
        set({ busy: false, tabs: [...get().tabs, { docId: s.docId, name: file.name, session: s, originalFile: file }] });
        await activateTab(get, set, s.docId);
        set({ warnings: s.warnings, originalFile: file, autosavedRevision: null, autosaveAt: undefined, recovery: undefined });
      } catch (e) {
        set({ busy: false, error: errText(e) });
      }
      return;
    }
    set({ busy: true, error: undefined, tabs: [], activeDocId: undefined });
    try {
      const session = await DocSession.open(file);
      session.onEvents = handleDocEvents;
      const info: DocInspect = await session.inspect();
      // Surface missing fonts as warnings (non-fatal).
      try { await session.resolveMissingFonts(); } catch { /* optional */ }
      const first = flatten(info.layers ?? [])[0]?.id;
      // Align the engine's active layer with what the UI shows as selected.
      if (first != null) await session.request(selectBatch([first])).catch(() => undefined);
      set({
        session, fileName: file.name,
        tabs: [{ docId: session.docId, name: file.name, session, originalFile: file }],
        activeDocId: session.docId,
        autosavedRevision: null,
        autosaveAt: undefined,
        recovery: undefined,
        doc: { width: info.width, height: info.height, resolution: info.resolution },
        layers: info.layers ?? [],
        selectedId: first,
        selectedIds: first == null ? [] : [first],
        typeOpts: { ...get().typeOpts, size: defaultTypeSize(info.width, info.height) },
        typeEditing: undefined,
        warnings: session.warnings,
        view: { scale: 1, tx: 0, ty: 0 },
        busy: false,
        render: { nonce: get().render.nonce + 1, damage: null },
        historyDepth: { canUndo: false, canRedo: false },
        history: info.history ?? [],
        originalFile: file,
        baselineSnapshot: undefined,
        compare: false,
        selection: undefined,
        maskEditing: false,
        transformSession: undefined,
        channels: info.channels?.alpha ?? [],
        guides: [],
      });
    } catch (e) {
      set({ busy: false, error: e instanceof EngineError ? `${e.code ?? ''} ${e.message}`.trim() : String(e) });
    }
  },

  selectLayer(id, additive) {
    const ids = multiSelect(get().selectedIds, id, !!additive);
    set({ selectedIds: ids, selectedId: ids[ids.length - 1] ?? id });
    // Push the selection into the engine too: the magic wand, fill, clear and auto-tone all act
    // on the engine's *active* layer, so a purely front-end selection would edit the wrong layer.
    // Selecting is not an undo step in the engine, so this is cheap.
    const { session } = get();
    if (session && ids.length) void session.request(selectBatch(ids)).catch(() => undefined);
  },

  async newDocument(width, height, opts = {}) {
    untitled += 1;
    const name = opts.name?.trim() || `未命名-${untitled}.psd`;
    const plain = (opts.resolution ?? 72) === 72 && (opts.mode ?? 'rgb') === 'rgb' && (opts.depth ?? 8) === 8
      && (opts.background ?? 'white') === 'white' && !opts.profile;
    const host = get().session;
    if (plain && !host) {
      // First document, default options: a flat BMP opens as a real Background layer.
      await get().openFile(new File([blankImage(width, height)], `${name}.bmp`, { type: 'image/bmp' }));
      set({ fileName: name, originalFile: undefined, tabs: get().tabs.map((t) => (t.docId === get().activeDocId ? { ...t, name, originalFile: undefined } : t)) });
      return;
    }
    // File › New in the engine (resolution, mode, depth, background). With no document open,
    // a 1×1 seed provides an engine to run it in and is closed straight away.
    let seed: DocSession | undefined;
    let runner = host;
    set({ busy: true, error: undefined });
    try {
      if (!runner) {
        seed = await DocSession.open(new File([blankImage(1, 1)], 'seed.bmp', { type: 'image/bmp' }));
        runner = seed;
      }
      const docId = await runner.newDocumentCmd({
        width, height, name,
        ...(opts.resolution ? { resolution: opts.resolution } : {}),
        ...(opts.mode ? { mode: opts.mode } : {}),
        ...(opts.depth ? { depth: opts.depth } : {}),
        ...(opts.background ? { background: opts.background } : {}),
      });
      if (!docId) throw new Error('新建文档失败');
      // handleDocEvents registered it as a child of `runner`; it is a root document.
      let tabs = get().tabs.filter((t) => t.docId !== docId);
      const s = DocSession.attach(runner.client, docId);
      s.onEvents = handleDocEvents;
      tabs = [...tabs, { docId, name, session: s }];
      set({ tabs, busy: false });
      if (seed) await seed.closeDoc().catch(() => undefined);
      set({ tabs: get().tabs.filter((t) => t.docId !== seed?.docId) });
      await activateTab(get, set, docId);
      if (opts.profile) await get().imageProfile('assign', opts.profile);
      set({ originalFile: undefined, autosavedRevision: null, autosaveAt: undefined });
    } catch (e) {
      set({ busy: false, error: errText(e) });
    }
  },
  async placeImage(file) {
    const { session } = get();
    if (!session) { await get().openFile(file); return; }
    set({ busy: true, error: undefined });
    try {
      await session.loadImageToClipboard(file.name, await file.arrayBuffer());
      set({ busy: false });
    } catch (e) { set({ busy: false, error: errText(e) }); return; }
    await get().clipboardPaste('paste');
    const id = get().selectedId;
    const name = file.name.replace(/\.[^.]+$/, '');
    if (id != null && !get().error) await get().setProps(id, { name });
  },
  async imageMode(mode) {
    const cmd = mode.startsWith('bits') ? `image.mode.${mode}` : `image.mode.${mode}`;
    await applyGeometry(get, set, (s) => s.request([{ cmd }]));
    await get().refreshDocInfo();
  },
  async imageProfile(kind, profile) {
    await applyEdit(get, set, (s) => s.request([{ cmd: kind === 'assign' ? 'edit.assignProfile' : 'edit.convertToProfile', params: { profile } }]));
    await get().refreshDocInfo();
  },
  async setResolution(ppi, resample) {
    const doc = get().doc;
    if (!doc) return;
    const k = ppi / (doc.resolution ?? 72);
    const w = resample ? Math.max(1, Math.round(doc.width * k)) : doc.width;
    const h = resample ? Math.max(1, Math.round(doc.height * k)) : doc.height;
    await applyGeometry(get, set, (s) => s.request([{ cmd: CMD_IMAGE_SIZE, params: { width: w, height: h, resolution: ppi, resample: resample ? 'bicubic' : 'none' } }]));
    await get().refreshDocInfo();
  },
  async aiAfterEdit(docId, damage) {
    const { session } = get();
    // Background tabs are re-inspected when activated; never switch tabs on the user.
    if (!session || get().activeDocId !== docId) return;
    const info = await session.inspect();
    const ids = flatten(info.layers ?? []).map((l) => l.id);
    const keep = get().selectedIds.filter((id) => ids.includes(id));
    const sel = keep.length ? keep : ids.slice(0, 1);
    set({
      layers: info.layers ?? [],
      channels: info.channels?.alpha ?? get().channels,
      history: info.history ?? get().history,
      historyDepth: { canUndo: !!info.canUndo, canRedo: !!info.canRedo },
      selectedIds: sel, selectedId: sel[sel.length - 1],
      render: { nonce: get().render.nonce + 1, damage: damage == null ? null : toRects(damage) },
    });
    // Paste / create commands move the engine's active layer: restore the user's selection.
    if (sel.length) await session.request(selectBatch(sel)).catch(() => undefined);
  },
  async refreshDocInfo() {
    const { session } = get();
    if (!session) { set({ docInfo: undefined }); return; }
    try {
      const info = (await session.inspect()) as DocInspect & { mode?: string; depth?: number };
      let profile: string | undefined;
      try {
        const r = await session.request([{ cmd: 'edit.profileInfo' }]);
        const v = r.results[0]?.value as { profile?: { description?: string } | null } | undefined;
        profile = v?.profile?.description;
      } catch { /* no profile */ }
      set({ docInfo: { mode: info.mode ?? 'Rgb', depth: info.depth ?? 8, profile } });
    } catch { /* ignore */ }
  },

  async setProps(id, props) { await applyEdit(get, set, (s) => s.setLayerProps(id, props)); },
  async moveLayer(id, dx, dy) { await applyEdit(get, set, (s) => s.moveLayer(id, dx, dy)); },
  async editText(id, text) { await applyEdit(get, set, (s) => s.editText(id, text)); },

  async addText(text) {
    const { doc, layers, foreground } = get();
    if (!doc) return;
    // Stack successive texts downwards so repeated "add text" never lands on top of the last one.
    const size = defaultTypeSize(doc.width, doc.height);
    const px = size * ((doc.resolution ?? 72) / 72);
    const n = flatten(layers).filter((l) => /type/i.test(l.kind)).length;
    const x = Math.round(doc.width * 0.08);
    const y = Math.round(Math.min(doc.height - px * 0.3, doc.height * 0.08 + px * (1 + n * 1.4)));
    await applyCreateLayer(get, set, (s) => s.addText(text, x, y, size, foreground, { font: DEFAULT_FONT }));
  },

  async addShape(kind, fill) {
    const doc = get().doc;
    if (!doc) return;
    const rect: [number, number, number, number] = [
      Math.round(doc.width * 0.3), Math.round(doc.height * 0.42),
      Math.round(doc.width * 0.4), Math.round(doc.height * 0.16),
    ];
    await applyEdit(get, set, (s) => s.addShape(kind, rect, fill));
  },

  async align(edge) {
    const ids = get().selectedIds;
    if (!ids.length) return;
    // One layer: align to the selection if there is one, else to the canvas (Photoshop).
    const to = ids.length > 1 ? undefined : get().selection ? 'selection' : 'canvas';
    await applyEdit(get, set, (s) => s.align(ids, edge, to));
  },
  async distribute(mode) {
    const ids = get().selectedIds;
    if (ids.length < 3) return;
    await applyEdit(get, set, (s) => s.distribute(ids, mode));
  },
  async arrange(dir) {
    const id = get().selectedId;
    if (id == null) return;
    await applyEdit(get, set, (s) => s.arrange(id, dir));
  },
  async reorderLayers(ids, target, position, docId, revision) {
    const st = get();
    if (st.busy || !st.session) return;
    if (st.activeDocId !== docId || st.session.currentRevision !== revision) { set({ error: '拖动期间文档已变化，请重试' }); return; }
    const problem = layerDropProblem(st.layers, ids, target, position);
    if (problem) { set({ error: problem }); return; }
    await applyEdit(get, set, (s) => s.request([{ cmd: 'layer.moveTo', params: { layers: ids, target, position } }], undefined, { baseRevision: revision }));
    if (!get().error) set({ selectedIds: ids, selectedId: ids.at(-1) });
  },
  async editTextContent(layer, text, original, docId) {
    const st = get(), selected = flatten(st.layers).find((n) => n.id === layer);
    if (st.busy || !st.session || st.activeDocId !== docId || st.selectedId !== layer) { set({ error: '目标文档或图层已变化，请重新选择' }); return false; }
    if (!selected || !/type/i.test(selected.kind) || selected.locks?.all || selected.locks?.pixels) { set({ error: '文字图层不可编辑，请先解锁' }); return false; }
    if (st.typeEditing) { set({ error: '请先完成画布中的文字输入' }); return false; }
    if ((selected.text?.text ?? '') !== original) { set({ error: '文字已被其它操作修改，请先重新载入内容' }); return false; }
    if (text === original) return true;
    await applyEdit(get, set, (s) => s.editText(layer, text));
    if (get().error) return false;
    await get().refreshTextInfo();
    return true;
  },

  async undo() { await applyEdit(get, set, (s) => s.undo()); },
  async redo() { await applyEdit(get, set, (s) => s.redo()); },

  // Geometry changes the canvas size: always a full redraw, refreshed doc size and reset view.
  async crop(rect) { await applyGeometry(get, set, (s) => s.crop(rect.x, rect.y, rect.width, rect.height)); },
  async resizeImage(width, height, resample) { await applyGeometry(get, set, (s) => s.resizeImage(width, height, resample)); },
  async resizeCanvas(width, height, opts) {
    await applyGeometry(get, set, (s) => s.resizeCanvas(width, height, opts?.anchor ?? 'center', opts?.extensionColor ?? 'background', !!opts?.relative));
  },
  async rotate(kind) { await applyGeometry(get, set, (s) => s.rotate(kind)); },

  async auto(kind) {
    const target = pixelTarget(get());
    if (target == null) { set({ error: '没有可用的像素图层，无法执行自动调整' }); return; }
    await applyEdit(get, set, (s) => s.auto(kind, target));
  },

  async addAdjustment(cmd) {
    const { session } = get();
    if (!session) return;
    set({ busy: true, error: undefined });
    try {
      const body = await session.addAdjustment(cmd);
      const newId = (body.results?.[0]?.value as { layer?: number } | undefined)?.layer;
      const info = await session.inspect();
      set({
        layers: info.layers ?? [],
        busy: false,
        ...(newId != null ? { selectedId: newId, selectedIds: [newId] } : {}),
        render: { nonce: get().render.nonce + 1, damage: null },
      });
    } catch (e) {
      set({ busy: false, error: errText(e) });
    }
  },

  async setAdjustment(layerId, params) { await applyEdit(get, set, (s) => s.setAdjustment(layerId, params)); },

  async save() { await get().exportAs('psd'); },

  async exportAs(format) {
    const { session, fileName } = get();
    if (!session) return;
    set({ busy: true, error: undefined });
    try {
      const { bytes } = await session.save(format);
      if (!bytes || (bytes as ArrayBuffer).byteLength === 0) throw new Error(`导出 ${format} 失败`);
      const ext = format === 'jpeg' ? 'jpg' : format;
      const base = fileName?.replace(/\.(psd|psb|pcraft|png|jpe?g)$/i, '') ?? 'export';
      const url = URL.createObjectURL(new Blob([bytes]));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${base}.${ext}`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      set({ busy: false });
      // An explicit document save means the work is safe: drop the crash-recovery snapshot.
      if (format === 'psd' || format === 'pcraft') {
        const root = (get().tabs.find((t) => t.docId === get().activeDocId && !t.parent) ?? get().tabs.find((t) => !t.parent))?.session;
        set({ autosavedRevision: root?.currentRevision ?? null, autosaveAt: undefined });
        await clearSnapshot().catch(() => undefined);
      }
    } catch (e) {
      set({ busy: false, error: errText(e) });
    }
  },

  setView(partial) { set({ view: { ...get().view, ...partial } }); },
  setRulerUnit(u) { set({ rulerUnit: u }); },
  setShowRulers(on) { set({ showRulers: on }); },
  setBackend(b) { set({ backend: b }); },
  markPainted(nonce) { set({ paintedNonce: nonce }); },
  requestFullRedraw() { set({ render: { nonce: get().render.nonce + 1, damage: null } }); },
  setWorkspace(id) { set({ activeWorkspace: id }); },
  captureBaselineIfNeeded() {
    if (get().baselineSnapshot) return;
    const url = snapshotDataUrl();
    if (url) set({ baselineSnapshot: url });
  },
  setCompare(on) { set({ compare: on }); },
  setTool(t) {
    if (t !== 'type' && get().typeEditing) void get().commitType();
    set({ activeTool: t, transformSession: undefined, ...(t === 'crop' ? {} : { cropSession: undefined }) });
    if (t === 'crop') get().startCrop();
    if (PATH_TOOLS.includes(t)) void get().refreshActivePath();
    if (t === 'shape' || t === 'move' || t === 'pathSelect') void get().refreshShapeInfo();
  },
  setWandTolerance(v) { set({ wandTolerance: Math.min(255, Math.max(0, Math.round(v))) }); },

  async refreshSelection() {
    const { session } = get();
    if (!session) { set({ selection: undefined }); return; }
    const r = await session.selectionMask();
    set({ selection: r.ok ? unpackSelectionMask(r.data?.bytes) : undefined });
  },

  async marquee(box, mode, ellipse) {
    const { feather, antiAlias } = get().selectOpts;
    await applySelection(get, set, (s) => s.selectRect(box, mode, ellipse, { feather, antiAlias }));
  },
  async lasso(points, mode) {
    const { feather, antiAlias } = get().selectOpts;
    await applySelection(get, set, (s) => s.selectLasso(points, mode, { feather, antiAlias }));
  },
  async magicWand(x, y, mode) {
    const { wandTolerance: tol, wandContiguous, wandSampleAll } = get();
    await applySelection(get, set, (s) => s.magicWand(x, y, tol, mode, wandContiguous, wandSampleAll));
  },
  async selectMenu(kind) { await applySelection(get, set, (s) => s.selectMenu(kind)); },
  async smartSelect(method) {
    const sel = get().selection;
    if (method === 'object' && !sel) { set({ error: '先框出大致范围，再识别框内物体' }); return; }
    const rect: [number, number, number, number] | undefined = sel ? [sel.x, sel.y, sel.width, sel.height] : undefined;
    await applySelection(get, set, (s) => s.request(regionSelectBatch({ method, rect })));
  },
  async refineSelection(a) { await applySelection(get, set, (s) => s.request(regionRefineBatch(a))); },
  async regionOp(op) {
    const target = pixelTarget(get());
    if (target == null || !get().selection) { set({ error: '需要一个选区和一个像素图层' }); return; }
    await applyCreateLayer(get, set, (s) => s.request(regionApplyBatch({ op, layer: target })));
    await get().refreshSelection();
  },
  async lintDocument() {
    const { session } = get();
    if (!session) return [];
    const info = await session.inspect();
    const r = await session.client.render(session.docId, 1024);
    return lintDoc(info, r.ok ? { px: r.data, scale: r.data.width / info.width } : undefined);
  },
  async regionAdjust(a) {
    await applyCreateLayer(get, set, (s) => s.request(adjustBatch(a)));
    await get().refreshSelection();
  },
  async selectModify(kind, radius) { await applySelection(get, set, (s) => s.selectModify(kind, radius)); },

  async fillSelection(color) {
    const target = pixelTarget(get());
    if (target == null) { set({ error: '没有可用的像素图层，无法填充' }); return; }
    await applyEdit(get, set, (s) => s.fillSelection(color, target));
    await get().refreshSelection();
  },
  async clearPixels() {
    const target = pixelTarget(get());
    if (target == null) { set({ error: '没有可用的像素图层，无法清除' }); return; }
    await applyEdit(get, set, (s) => s.clearPixels(target));
    await get().refreshSelection();
  },
  async cropToSelection() {
    const sel = get().selection;
    if (!sel) return;
    await applyGeometry(get, set, (s) => s.crop(sel.x, sel.y, sel.width, sel.height));
    await get().refreshSelection();
  },
  async selectionToMask() {
    const id = get().selectedId;
    await applyEdit(get, set, (s) => s.selectionToMask(id));
    await get().refreshSelection();
  },

  // --- Paint & colour ---
  setForeground(hex) {
    set({ foreground: hex });
    void get().session?.setColors(hex).catch(() => undefined);
  },
  setBackground(hex) {
    set({ background: hex });
    void get().session?.setColors(undefined, hex).catch(() => undefined);
  },
  async swapColors() {
    set({ foreground: get().background, background: get().foreground });
    await get().session?.swapColors().catch(() => undefined);
  },
  async defaultColors() {
    set({ foreground: '#000000', background: '#ffffff' });
    await get().session?.defaultColors().catch(() => undefined);
  },
  setBrush(partial) { set({ brush: { ...get().brush, ...partial } }); },

  async paintStroke(points) {
    const { activeTool, foreground, brush, maskEditing } = get();
    const t = paintTarget(get());
    if ('error' in t) { set({ error: t.error }); return; }
    const opts: BrushOpts = {
      size: brush.size, hardness: brush.hardness, opacity: brush.opacity, flow: brush.flow,
      color: maskEditing ? undefined : foreground,
      pencil: activeTool === 'pencil',
      erase: activeTool === 'eraser',
      preset: get().brushPreset,
    };
    await applyEdit(get, set, (s) => s.stroke(points, opts, t.target, t.layer));
  },
  async paintBucket(x, y) {
    const { foreground, brush } = get();
    const t = paintTarget(get());
    if ('error' in t) { set({ error: t.error }); return; }
    await applyEdit(get, set, (s) => s.bucket(x, y, { tolerance: brush.tolerance, color: foreground, opacity: 100 }, t.target, t.layer));
  },
  async paintGradient(from, to, style = 'linear') {
    const { foreground, background } = get();
    const t = paintTarget(get());
    if ('error' in t) { set({ error: t.error }); return; }
    await applyEdit(get, set, (s) => s.gradient(from, to, style, [foreground, background], t.target, t.layer));
  },

  // --- Mask ---
  async addMask(kind) {
    const id = get().selectedId;
    await applyEdit(get, set, (s) => s.addMask(kind, id));
  },
  async deleteMask() {
    const id = get().selectedId;
    await applyEdit(get, set, (s) => s.deleteMask(id));
    set({ maskEditing: false });
  },
  async applyMask() {
    const id = get().selectedId;
    await applyEdit(get, set, (s) => s.applyMask(id));
    set({ maskEditing: false });
  },
  setMaskEditing(on) { set({ maskEditing: on }); },

  // --- Transform ---
  enterTransform() {
    const { selectedId, layers, selection } = get();
    const layer = flatten(layers).find((l) => l.id === selectedId);
    if (!layer?.bounds || layer.bounds[2] <= 0 || layer.bounds[3] <= 0) { set({ error: '选中图层没有可变换的内容' }); return; }
    if (layer.locks?.position || layer.locks?.all) { set({ error: '图层位置已锁定，无法变换（可在图层面板解锁）' }); return; }
    const [x, y, w, h] = layer.bounds;
    let rect: Rect4 = [x, y, x + w, y + h];
    // With a selection on a pixel layer only the selected pixels transform (engine default).
    const sel = selection && /^pixel$/i.test(layer.kind) ? selection : undefined;
    if (sel) {
      const r: Rect4 = [Math.max(rect[0], sel.x), Math.max(rect[1], sel.y), Math.min(rect[2], sel.x + sel.width), Math.min(rect[3], sel.y + sel.height)];
      if (r[2] > r[0] && r[3] > r[1]) rect = r;
    }
    set({
      activeTool: 'transform',
      transformSession: { rect, quad: rectCorners(rect), mode: 'free', ref: [0.5, 0.5], layer: layer.id, preview: !sel },
    });
  },
  updateTransform(quad) {
    const t = get().transformSession;
    if (t) set({ transformSession: { ...t, quad } });
  },
  async setTransformMode(m) {
    const t = get().transformSession;
    if (!t) return;
    if (m === 'warp' && t.mode !== 'warp') {
      // Warp works on the content as it is: bake a pending affine/perspective change first.
      const base = rectCorners(t.rect);
      const moved = t.quad.some((c, i) => c[0] !== base[i][0] || c[1] !== base[i][1]);
      if (moved) {
        await get().commitTransform();
        get().enterTransform();
      }
      const t2 = get().transformSession;
      if (t2) set({ transformSession: { ...t2, mode: 'warp', warp: warpGrid(t2.quad) } });
      return;
    }
    set({ transformSession: { ...t, mode: m, ...(m === 'warp' ? {} : { warp: undefined }) } });
  },
  transformSessionOp(op) {
    const t = get().transformSession;
    if (!t || t.mode === 'warp') return;
    const c = quadPoint(t.quad, 0.5, 0.5);
    const quad = op === 'flipH' ? flipQuad(t.quad, 'h') : op === 'flipV' ? flipQuad(t.quad, 'v')
      : rotateQuad(t.quad, c, op === 'rotate180' ? 180 : op === 'rotate90Cw' ? 90 : -90);
    set({ transformSession: { ...t, quad } });
  },
  setTransformRef(uv) {
    const t = get().transformSession;
    if (t) set({ transformSession: { ...t, ref: uv } });
  },
  setTransformNumeric(p) {
    const t = get().transformSession;
    if (!t || t.mode === 'warp' || !isAffine(t.quad)) return;
    const cur = decompose(t.rect, t.quad, t.ref);
    set({ transformSession: { ...t, quad: compose(t.rect, { ...cur, ...p }, t.ref) } });
  },
  updateTransformWarp(points) {
    const t = get().transformSession;
    if (t) set({ transformSession: { ...t, warp: points } });
  },
  async warpPresetCommit(style, bend) {
    const t = get().transformSession;
    if (!t) return;
    set({ transformSession: undefined });
    await applyEdit(get, set, (s) => s.warpPreset(t.rect, style, bend, t.layer));
  },
  async commitTransform() {
    const { transformSession: t } = get();
    if (!t) return;
    const { rect, quad } = t;
    set({ transformSession: undefined });
    if (t.mode === 'warp' && t.warp) {
      const grid = warpGrid(rectCorners(rect));
      const moved = t.warp.some((p, i) => Math.abs(p[0] - grid[i][0]) > 0.01 || Math.abs(p[1] - grid[i][1]) > 0.01);
      if (moved) await applyEdit(get, set, (s) => s.warpMesh(rect, t.warp!, t.layer));
      return;
    }
    const base = rectCorners(rect);
    const moved = quad.some((c, i) => c[0] !== base[i][0] || c[1] !== base[i][1]);
    if (moved) await applyEdit(get, set, (s) => s.transformQuad(rect, quad, t.layer));
  },
  cancelTransform() { set({ transformSession: undefined }); },

  async transformNumeric(deg, scalePct) {
    const { transformSel, selectedId, layers, doc } = get();
    const scale = scalePct / 100;
    if (transformSel) {
      await applySelection(get, set, (s) => s.transformSelection({ rotate: deg, scaleX: scalePct, scaleY: scalePct }));
      return;
    }
    const layer = flatten(layers).find((l) => l.id === selectedId);
    const b = layer?.bounds;
    const cx = b ? b[0] + b[2] / 2 : (doc?.width ?? 0) / 2;
    const cy = b ? b[1] + b[3] / 2 : (doc?.height ?? 0) / 2;
    await applyEdit(get, set, (s) => s.transformMatrix(rotateScaleMatrix(cx, cy, deg, scale), selectedId));
  },
  async transformPreset(kind) {
    const { transformSel, selectedId } = get();
    if (transformSel) {
      const map: Record<string, Record<string, number>> = {
        rotate90Cw: { rotate: 90 }, rotate90Ccw: { rotate: -90 }, rotate180: { rotate: 180 },
        flipHorizontal: { scaleX: -100 }, flipVertical: { scaleY: -100 },
      };
      await applySelection(get, set, (s) => s.transformSelection(map[kind]));
      return;
    }
    await applyEdit(get, set, (s) => s.transformPreset(kind, selectedId));
  },
  setTransformSel(on) { set({ transformSel: on }); },

  // --- Retouch ---
  setCloneSource(pt) { set({ cloneSource: pt }); },
  async retouchStroke(points) {
    const { activeTool, brush, cloneSource } = get();
    const t = paintTarget(get());
    if ('error' in t) { set({ error: t.error }); return; }
    if (activeTool === 'spotHeal') {
      await applyEdit(get, set, (s) => s.spotHealing(points, brush.size, t.layer));
      return;
    }
    if (!cloneSource) { set({ error: '请先按住 Alt 点击取样源' }); return; }
    if (activeTool === 'healBrush') await applyEdit(get, set, (s) => s.healingBrush(points, cloneSource, brush.size, t.layer));
    else await applyEdit(get, set, (s) => s.cloneStamp(points, cloneSource, brush.size, brush.hardness, t.layer));
  },
  async contentAwareFill() {
    if (!get().selection) { set({ error: '内容识别填充需要先建立选区' }); return; }
    const t = paintTarget(get());
    if ('error' in t) { set({ error: t.error }); return; }
    await applyEdit(get, set, (s) => s.contentAwareFill(t.layer));
    await get().refreshSelection();
  },

  async applyFilter(cmd, params) {
    const target = pixelTarget(get());
    if (target == null) { set({ error: '没有可用的像素图层，无法应用滤镜' }); return; }
    await applyEdit(get, set, (s) => s.filter(cmd, params, target));
  },

  async convertToSmartObject() {
    const id = get().selectedId;
    if (id == null) return;
    await applyEdit(get, set, (s) => s.convertToSmartObject(id));
  },
  async soViaCopy() {
    const id = get().selectedId;
    if (id == null) return;
    await applyEdit(get, set, (s) => s.soViaCopy(id));
  },
  async rasterizeSmartObject() {
    const id = get().selectedId;
    if (id == null) return;
    await applyEdit(get, set, (s) => s.rasterizeSmartObject(id));
  },
  async soToLayers() {
    const id = get().selectedId;
    if (id == null) return;
    await applyEdit(get, set, (s) => s.soToLayers(id));
  },

  // --- Layer tree ops ---
  async newLayer() { await applyCreateLayer(get, set, (s) => s.newLayer()); },
  async duplicateLayer() { await applyCreateLayer(get, set, (s) => s.duplicateLayer(get().selectedId)); },
  async deleteLayer() {
    const id = get().selectedId;
    if (id == null) return;
    await applyStructural(get, set, (s) => s.deleteLayer(id));
  },
  async layerFromBackground() { await applyStructural(get, set, (s) => s.layerFromBackground()); },
  async groupLayers() {
    const ids = get().selectedIds;
    if (!ids.length) return;
    await applyCreateLayer(get, set, (s) => s.groupLayers(ids));
  },
  async lockLayer(kind) {
    const id = get().selectedId;
    if (id == null) return;
    await applyEdit(get, set, (s) => s.lockLayer(id, kind));
  },
  async mergeDown() {
    const id = get().selectedId;
    await applyStructural(get, set, (s) => s.mergeDown(id));
  },
  async mergeVisible() { await applyStructural(get, set, (s) => s.mergeVisible()); },
  async flattenImage() { await applyStructural(get, set, (s) => s.flattenImage()); },
  async newFillLayer(kind) {
    const { foreground, background } = get();
    await applyCreateLayer(get, set, (s) => s.newFillLayer(kind, { color: foreground, from: foreground, to: background }));
  },

  // --- Layer styles ---
  async applyLayerStyle(cmd, params) {
    const id = get().selectedId;
    if (id == null) { set({ error: '请先选择一个图层再添加样式' }); return; }
    await applyEdit(get, set, (s) => s.layerStyle(cmd, params, id));
  },
  async clearLayerStyle() {
    const id = get().selectedId;
    if (id == null) return;
    await applyEdit(get, set, (s) => s.clearStyle(id));
  },
  async applyTextFx(a) {
    const id = get().selectedId;
    if (id == null) { set({ error: '请先选择一个图层再添加特效' }); return; }
    await applyEdit(get, set, async (s) => s.request(textFxBatch(await s.inspect(), { ...a, layer: id })));
  },
  async extrudeSelected(a) {
    const id = get().selectedId;
    if (id == null) { set({ error: '请先选择一个文字图层' }); return; }
    await applyStructural(get, set, (s) => extrudeText(s, { ...a, layer: id }));
    set({ selectedId: id, selectedIds: [id] });
  },

  // --- Clipping mask / selection store / stroke ---
  async createClippingMask() {
    const id = get().selectedId;
    if (id == null) return;
    await applyEdit(get, set, (s) => s.createClippingMask(id));
  },
  async releaseClippingMask() {
    const id = get().selectedId;
    if (id == null) return;
    await applyEdit(get, set, (s) => s.releaseClippingMask(id));
  },
  async saveSelection() {
    if (!get().selection) { set({ error: '没有选区可存储' }); return; }
    await applySelection(get, set, (s) => s.saveSelection('选区1'));
  },
  async loadSelection() {
    await applySelection(get, set, (s) => s.loadSelection('选区1'));
  },
  async strokeSelection(color, width) {
    if (!get().selection) { set({ error: '描边需要先建立选区' }); return; }
    const target = pixelTarget(get());
    if (target == null) { set({ error: '没有可用的像素图层，无法描边' }); return; }
    await applyEdit(get, set, (s) => s.strokeSelection(color, width, 'center', target));
    await get().refreshSelection();
  },

  // --- Shape / path ---
  async addShapeStyled(kind, fill, stroke) {
    const doc = get().doc;
    if (!doc) return;
    const rect: [number, number, number, number] = [
      Math.round(doc.width * 0.3), Math.round(doc.height * 0.3),
      Math.round(doc.width * 0.4), Math.round(doc.height * 0.4),
    ];
    await applyCreateLayer(get, set, (s) => s.addShapeStyled({ kind, rect, fill, ...(stroke ? { stroke } : {}) }));
  },
  async selToWorkPath() {
    if (!get().selection) { set({ error: '需要先建立选区再转工作路径' }); return; }
    await applyEdit(get, set, (s) => s.selToWorkPath());
  },
  async workPathToSelection() {
    await applySelection(get, set, (s) => s.pathToSelection());
  },
  async fillWorkPath(color) {
    const target = pixelTarget(get());
    if (target == null) { set({ error: '没有可用的像素图层，无法填充路径' }); return; }
    await applyEdit(get, set, (s) => s.fillPath(color, target));
  },
  async strokeWorkPath(color, width) {
    const target = pixelTarget(get());
    if (target == null) { set({ error: '没有可用的像素图层，无法描边路径' }); return; }
    await applyEdit(get, set, (s) => s.strokePath(color, width, target));
  },
  async pathBooleanFromSelection(op) {
    const sel = get().selection;
    if (!sel) { set({ error: '路径运算需要先建立选区（作为参与运算的子路径）' }); return; }
    await applyEdit(get, set, (s) => s.pathBoolean([rectSubpath(sel.x, sel.y, sel.width, sel.height)], op));
  },
  async setWorkPathRect(rect) {
    await applyEdit(get, set, (s) => s.setWorkPath([rectSubpath(rect[0], rect[1], rect[2], rect[3])]));
  },
  async moveAnchor(anchors, move) {
    await applyEdit(get, set, (s) => s.moveAnchors(anchors, move));
  },
  async convertAnchor(subpath, knot, out) {
    await applyEdit(get, set, (s) => s.convertPoint(subpath, knot, out));
  },
  async pathSubpaths() {
    const { session } = get();
    if (!session) return 0;
    const info = await session.pathList().catch(() => ({} as { workPath?: { subpaths: number } }));
    return info.workPath?.subpaths ?? 0;
  },

  // --- Channels / guides / warp ---
  async newChannel() { await applyEdit(get, set, (s) => s.newChannel()); },
  async duplicateChannel(index) { await applyEdit(get, set, (s) => s.duplicateChannel(index)); },
  async deleteChannel(index) { await applyEdit(get, set, (s) => s.deleteChannel(index)); },
  async addGuide(orientation, position) {
    const { session } = get();
    if (!session) return;
    try {
      await session.newGuide(orientation, position);
      // Functional update: two concurrent addGuide calls must not clobber each other
      // (the state is read *after* an await, so a plain spread of a captured array would race).
      set((st) => ({ guides: [...st.guides, { orientation, position }] }));
    } catch (e) { set({ error: errText(e) }); }
  },
  async clearGuides() {
    const { session } = get();
    if (!session) return;
    try {
      await session.clearGuidesCmd();
      set({ guides: [] });
    } catch (e) { set({ error: errText(e) }); }
  },
  async warp(style, bend) {
    const target = pixelTarget(get());
    if (target == null) { set({ error: '没有可用的像素图层，无法变形' }); return; }
    await applyEdit(get, set, (s) => s.warp(style, bend, target));
  },

  // --- Type (character / paragraph) ---
  async refreshTextInfo() {
    const { session, selectedId, layers } = get();
    const layer = flatten(layers).find((l) => l.id === selectedId);
    if (!session || selectedId == null || !layer || !/type/i.test(layer.kind)) { set({ textInfo: undefined }); return; }
    try {
      const raw = await session.typeInfo(selectedId);
      if (get().session === session && get().selectedId === selectedId) set({ textInfo: parseTypeInfo(raw) });
    } catch { if (get().session === session && get().selectedId === selectedId) set({ textInfo: undefined }); }
  },
  async applyTextStyle(ui) {
    const id = get().selectedId;
    if (id == null) return;
    await applyEdit(get, set, (s) => s.setTextStyle(styleParams(ui), id));
    await get().refreshTextInfo();
  },
  async setTextOrientation(dir) {
    const id = get().selectedId;
    if (id == null) return;
    await applyEdit(get, set, (s) => s.typeOrientation(dir, id));
    await get().refreshTextInfo();
  },
  async loadFonts() {
    const { session } = get();
    if (!session || get().fontFamilies.length) return;
    const [families, library] = await Promise.all([session.typeFonts().catch(() => [] as string[]), fontLibrary()]);
    // Library fonts are listed before they are downloaded; choosing one loads it (DocSession.request).
    const known = new Set(families.map((f) => f.toLowerCase()));
    set({ fontFamilies: [...families, ...library.map((f) => f.family).filter((f) => !known.has(f.toLowerCase()))], fontLibrary: library });
  },

  // --- Eyedropper / history / revert ---
  async sampleColor(x, y) {
    const { session, doc } = get();
    if (!session || !doc) return;
    if (x < 0 || y < 0 || x >= doc.width || y >= doc.height) return;
    const px = await session.pixel(x, y).catch(() => undefined);
    if (!px) return;
    const hex = rgb01ToHex(px);
    const before = get().foreground;
    get().setForeground(hex);
    get().showToast(`已吸取前景色 ${hex.toUpperCase()}（原 ${before.toUpperCase()}）· 位置 ${Math.round(x)}, ${Math.round(y)}`, { swatch: hex });
    set({ sampleFlash: { x, y, color: hex, prev: before, at: Date.now() } });
  },
  /** History entries are truncated at the current state, so entry `i` is `len-1-i` undos back. */
  async jumpHistory(index) {
    const steps = get().history.length - 1 - index;
    if (steps <= 0) return;
    for (let i = 0; i < steps; i++) await get().undo();
  },
  async revertDocument() {
    const tab = get().tabs.find((t) => t.docId === get().activeDocId);
    if (tab?.parent) { set({ error: '内容文档不能恢复，请先关闭或存储内容' }); return; }
    const file = tab?.originalFile ?? get().originalFile;
    if (!file || !tab) { set({ error: '没有可恢复的原文件（当前文档是新建的）' }); return; }
    // Re-open the original as a fresh tab, then drop the edited one.
    await get().openFile(file);
    await get().closeTab(tab.docId, true);
  },

  // --- Vector mask (MSK-005) ---
  async refreshVectorMask() {
    const { session, selectedId } = get();
    if (!session || selectedId == null) { set({ vectorMask: undefined }); return; }
    set({ vectorMask: await session.vectorMaskInfo(selectedId) });
  },
  async addVectorMaskFromPath() {
    const id = get().selectedId;
    if (id == null) return;
    await applyEdit(get, set, (s) => s.vectorMaskFromPath(id));
    await get().refreshVectorMask();
  },
  async deleteVectorMask() {
    const id = get().selectedId;
    if (id == null) return;
    await applyEdit(get, set, (s) => s.vectorMaskDelete(id));
    await get().refreshVectorMask();
  },
  async setVectorMaskEnabled(on) {
    const id = get().selectedId;
    if (id == null) return;
    await applyEdit(get, set, (s) => s.vectorMaskEnabled(id, on));
    await get().refreshVectorMask();
  },

  // --- Interactive tools (A25) ---
  setSelectOpts(p) { set({ selectOpts: { ...get().selectOpts, ...p } }); },
  async moveSelection(dx, dy) {
    if (!get().selection || (!dx && !dy)) return;
    await applySelection(get, set, (s) => s.moveSelection(Math.round(dx), Math.round(dy)));
  },
  setShapeOpts(p) { set({ shapeOpts: { ...get().shapeOpts, ...p } }); },
  async drawShape(box, line) {
    const o = get().shapeOpts;
    const stroke = o.strokeWidth > 0 ? { width: o.strokeWidth, color: o.strokeColor, align: 'center' } : undefined;
    const fill = o.noFill && o.kind !== 'line' ? null : o.fill;
    const rect: [number, number, number, number] = [box.x, box.y, Math.max(1, box.width), Math.max(1, box.height)];
    const params: Record<string, unknown> =
      o.kind === 'line'
        ? { kind: 'line', from: line?.from ?? [box.x, box.y], to: line?.to ?? [box.x + box.width, box.y + box.height], weight: Math.max(1, o.strokeWidth || 2), fill: o.fill }
        : o.kind === 'roundedRect' ? { kind: o.kind, rect, radii: o.radius, fill }
          : o.kind === 'polygon' ? { kind: o.kind, rect, sides: o.sides, fill }
            : o.kind === 'star' ? { kind: o.kind, rect, sides: o.sides, starRatio: o.starRatio, fill }
              : { kind: o.kind, rect, fill };
    if (stroke && o.kind !== 'line') params.stroke = stroke;
    // Path operation: add to the selected shape layer (combine/subtract/intersect/exclude).
    const target = flatten(get().layers).find((l) => l.id === get().selectedId);
    if (o.pathOp !== 'new' && target && /shape/i.test(target.kind)) {
      delete params.fill; delete params.stroke;
      await applyEdit(get, set, (s) => s.addShapeStyled({ ...(params as Record<string, unknown>), addTo: target.id, op: o.pathOp } as never));
      await get().refreshShapeInfo();
      return;
    }
    await applyCreateLayer(get, set, (s) => s.addShapeStyled(params as never));
    await get().refreshShapeInfo();
  },
  async refreshShapeInfo() {
    const { session, selectedId, layers } = get();
    const layer = flatten(layers).find((l) => l.id === selectedId);
    if (!session || !layer || !/shape/i.test(layer.kind)) { set({ shapeInfo: undefined }); return; }
    const info = await session.shapeInfo(layer.id).catch(() => undefined);
    set({ shapeInfo: info });
  },
  async editShape(params) {
    const info = get().shapeInfo;
    if (!info) return;
    await applyEdit(get, set, (s) => s.shapeEdit(info.layer, params));
    await get().refreshShapeInfo();
    if (PATH_TOOLS.includes(get().activeTool)) await get().refreshActivePath();
  },
  setAutoSelect(on, target) { set({ autoSelect: on, ...(target ? { autoSelectTarget: target } : {}) }); },
  async pickLayerAt(x, y) {
    const { session, autoSelectTarget } = get();
    if (!session) return undefined;
    const id = await session.pickAt(x, y, autoSelectTarget).catch(() => undefined);
    if (id != null) {
      set({ selectedId: id, selectedIds: [id] });
      await get().refreshShapeInfo();
    }
    return id;
  },
  async setLocks(locks) {
    const id = get().selectedId;
    if (id == null) return;
    await applyEdit(get, set, (s) => s.setLayerProps(id, { locks }));
  },
  async deleteKey() {
    const st = get();
    if (!st.session || st.busy) return;
    if (st.selection) await st.clearPixels();
    else await st.deleteLayer();
  },
  async loadBrushPresets() {
    const { session, brushPresets } = get();
    if (!session || brushPresets.length) return;
    const list = await session.brushPresets().catch(() => []);
    set({ brushPresets: list });
  },
  setBrushPreset(name) {
    const p = get().brushPresets.find((x) => x.name === name);
    set({ brushPreset: name || undefined, ...(p ? { brush: { ...get().brush, size: Math.round(p.size), hardness: p.hardness } } : {}) });
  },
  setPenMode(m) { set({ penMode: m }); },
  async refreshActivePath() {
    const { session, selectedId, layers } = get();
    if (!session) { set({ activePath: undefined }); return; }
    const layer = flatten(layers).find((l) => l.id === selectedId);
    if (layer && /shape/i.test(layer.kind)) {
      const p = await session.pathInfo('layer', layer.id).catch(() => undefined);
      if (p) { set({ activePath: { source: 'layer', layer: layer.id, path: normPath(p) } }); return; }
    }
    const w = await session.pathInfo('work').catch(() => undefined);
    set({ activePath: w ? { source: 'work', path: normPath(w) } : undefined });
  },
  async commitPath(path) {
    const ap = get().activePath;
    if (!ap) return;
    set({ activePath: { ...ap, path } });
    if (ap.source === 'layer' && ap.layer != null) {
      const layer = ap.layer;
      await applyEdit(get, set, (s) => s.shapeEdit(layer, { path: toEngine(path) }));
    } else {
      await applyEdit(get, set, (s) => s.setWorkPath((toEngine(path) as { subpaths: object[] }).subpaths));
    }
    await get().refreshActivePath();
  },
  async penFinish(sub) {
    if (sub.knots.length < 2) return;
    const one = toEngine({ subpaths: [sub] }) as { subpaths: object[] };
    if (get().penMode === 'shape') {
      const op = get().shapeOpts.pathOp;
      const target = flatten(get().layers).find((l) => l.id === get().selectedId);
      if (op !== 'new' && target && /shape/i.test(target.kind)) {
        await applyEdit(get, set, (s) => s.addShapeStyled({ kind: 'path', path: one, addTo: target.id, op } as never));
        await get().refreshShapeInfo();
        await get().refreshActivePath();
        return;
      }
      await applyCreateLayer(get, set, (s) => s.addShapeStyled({ kind: 'path', path: one, fill: get().foreground } as never));
      await get().refreshShapeInfo();
    } else {
      const ap = get().activePath;
      // Like Photoshop, a new pen subpath adds to the current work path.
      if (ap?.source === 'work' && ap.path.subpaths.length) await applyEdit(get, set, (s) => s.pathBoolean(one.subpaths, 'combine'));
      else await applyEdit(get, set, (s) => s.setWorkPath(one.subpaths));
    }
    await get().refreshActivePath();
  },
  async clipboardCopy(kind) {
    const st = get();
    if (!st.session) return;
    if (kind !== 'copyMerged' && !st.selection) { set({ error: '请先建立选区再拷贝（或用 Ctrl/Cmd+A 全选）' }); return; }
    const layer = pixelTarget(st);
    if (kind === 'cut') {
      if (layer == null) { set({ error: '没有可用的像素图层，无法剪切' }); return; }
      await applyEdit(get, set, (s) => s.clipCopy('cut', layer));
      await get().refreshSelection();
      if (!get().error) set({ notice: '已剪切到剪贴板', internalClipFresh: true });
      return;
    }
    if (kind === 'copy' && layer == null) { set({ error: '当前图层不是像素图层，可用合并拷贝（Shift+Ctrl/Cmd+C）' }); return; }
    set({ busy: true, error: undefined });
    try {
      const r = await st.session.clipCopy(kind, layer);
      const b = (r.results[r.results.length - 1]?.value as { bounds?: number[] } | undefined)?.bounds;
      set({ busy: false, internalClipFresh: true, notice: `已拷贝 ${b ? `${b[2]}×${b[3]}` : ''}`.trim() });
    } catch (e) {
      set({ busy: false, error: errText(e) });
    }
  },
  async clipboardPaste(kind) {
    const { view, viewport, doc } = get();
    // Paste at the centre of what is visible; if that point is off the canvas (a small document
    // in a big window), use the canvas centre so the pixels never land off-document.
    let center: [number, number] | undefined;
    if (viewport.w && doc) {
      const cx = (viewport.w / 2 - view.tx) / view.scale, cy = (viewport.h / 2 - view.ty) / view.scale;
      const inside = cx >= 0 && cy >= 0 && cx <= doc.width && cy <= doc.height;
      center = inside ? [Math.round(cx), Math.round(cy)] : [Math.round(doc.width / 2), Math.round(doc.height / 2)];
    }
    if (kind === 'pasteInto' && !get().selection) { set({ error: '贴入需要先建立选区' }); return; }
    await applyCreateLayer(get, set, (s) => s.clipPaste(kind, center));
    await get().refreshSelection();
  },
  async layerVia(kind) {
    const layer = pixelTarget(get());
    if (layer == null) { set({ error: '没有可用的像素图层' }); return; }
    await applyCreateLayer(get, set, (s) => s.layerVia(kind, layer));
    await get().refreshSelection();
  },
  async pasteExternalImage(blob) {
    const type = blob.type || 'image/png';
    const name = `剪贴板.${type.split('/')[1]?.replace('jpeg', 'jpg') || 'png'}`;
    const { session } = get();
    if (!session) { await get().openFile(new File([blob], name, { type })); return; }
    set({ busy: true, error: undefined });
    try {
      await session.loadImageToClipboard(name, await blob.arrayBuffer());
      set({ busy: false });
    } catch (e) {
      set({ busy: false, error: errText(e) });
      return;
    }
    await get().clipboardPaste('paste');
  },
  setViewport(w, h) { set({ viewport: { w, h } }); },
  zoomBy(factor) {
    const { view, viewport } = get();
    const scale = Math.min(16, Math.max(0.05, view.scale * factor));
    // Keep the viewport centre fixed.
    const cx = viewport.w / 2, cy = viewport.h / 2;
    set({ view: { scale, tx: cx - ((cx - view.tx) / view.scale) * scale, ty: cy - ((cy - view.ty) / view.scale) * scale } });
  },
  fitView() {
    const { doc, viewport } = get();
    if (!doc || !viewport.w) return;
    const pad = 40;
    const scale = Math.min(16, Math.max(0.05, Math.min((viewport.w - pad) / doc.width, (viewport.h - pad) / doc.height)));
    set({ view: { scale, tx: Math.round((viewport.w - doc.width * scale) / 2), ty: Math.round((viewport.h - doc.height * scale) / 2) } });
  },
  actualPixels() {
    const { doc, viewport } = get();
    if (!doc) return;
    set({ view: { scale: 1, tx: Math.round((viewport.w - doc.width) / 2), ty: Math.round((viewport.h - doc.height) / 2) } });
  },
  setCropOpts(p) { set({ cropOpts: { ...get().cropOpts, ...p } }); },
  startCrop() {
    const doc = get().doc;
    if (!doc) return;
    set({ cropSession: { box: [0, 0, doc.width, doc.height], angle: 0 } });
  },
  setCrop(c) { set({ cropSession: c }); },
  async commitCrop() {
    const { cropSession: c, cropOpts, doc } = get();
    if (!c || !doc) return;
    const [x, y, w, h] = c.box.map((v) => Math.round(v));
    const unchanged = !c.angle && x === 0 && y === 0 && w === doc.width && h === doc.height;
    set({ cropSession: undefined });
    if (!unchanged && w >= 1 && h >= 1) await applyGeometry(get, set, (s) => s.crop(x, y, w, h, c.angle, cropOpts.deletePixels));
    if (get().activeTool === 'crop') get().startCrop();
  },
  cancelCrop() {
    if (get().activeTool === 'crop') get().startCrop();
    else set({ cropSession: undefined });
  },
  setKeyboardLocked(on) { set({ keyboardLocked: on }); },
  setTypeOpts(p) {
    set({ typeOpts: { ...get().typeOpts, ...p } });
    const t = get().typeEditing;
    if (t) set({ typeEditing: { ...t, ...(p.font ? { font: p.font } : {}), ...(p.size ? { size: p.size } : {}), ...(p.align ? { align: p.align } : {}), ...(p.orientation ? { orientation: p.orientation } : {}) } });
  },
  async beginType(x, y, box) {
    const st = get();
    if (!st.session || !st.doc) return;
    if (st.typeEditing) await get().commitType();
    const o = get().typeOpts;
    const color = get().foreground;
    const hit = box ? undefined : await st.session.typeHit(x, y);
    const layer = hit != null ? flatten(get().layers).find((l) => l.id === hit) : undefined;
    if (layer) {
      set({ selectedId: layer.id, selectedIds: [layer.id] });
      void st.session.request(selectBatch([layer.id])).catch(() => undefined);
      let info: TextStyleUI | undefined;
      try { info = parseTypeInfo(await st.session.typeInfo(layer.id)); } catch { /* fall back to the layer summary */ }
      const text = info?.text ?? layer.text?.text ?? layer.name;
      const b = layer.bounds ?? [x, y, 0, 0];
      const style = {
        font: info?.font || layer.text?.font || o.font, size: info?.size ?? layer.text?.sizePt ?? o.size,
        color: info?.color ?? color,
        align: (['left', 'center', 'right'].includes(info?.align ?? '') ? info!.align : 'left') as TypeOpts['align'],
        orientation: info?.orientation ?? o.orientation,
      };
      set({ typeEditing: { layer: layer.id, x: b[0], y: b[1], bounds: b, text, original: text, ...style, origStyle: style } });
      return;
    }
    set({ typeEditing: { x, y, ...(box ? { box } : {}), text: '', original: '', font: o.font, size: o.size, color, align: o.align, orientation: o.orientation } });
  },
  setTypeText(text) {
    const t = get().typeEditing;
    if (t) set({ typeEditing: { ...t, text } });
  },
  async commitType() {
    const t = get().typeEditing;
    if (!t) return;
    set({ typeEditing: undefined });
    if (t.layer == null) {
      if (!t.text.trim()) return;
      await applyCreateLayer(get, set, (s) => s.addText(t.text, Math.round(t.x), Math.round(t.y), t.size, t.color, {
        font: t.font, box: t.box, align: t.align, orientation: t.orientation,
      }));
      return;
    }
    const layer = t.layer;
    if (!t.text.trim()) { await applyStructural(get, set, (s) => s.deleteLayer(layer)); return; }
    if (t.text !== t.original) await applyEdit(get, set, (s) => s.editText(layer, t.text));
    const o = t.origStyle;
    if (o) {
      const style: Record<string, unknown> = {};
      if (t.font !== o.font) style.font = t.font;
      if (t.size !== o.size) style.size = t.size;
      if (t.color !== o.color) style.color = t.color;
      if (t.align !== o.align) style.align = t.align;
      if (Object.keys(style).length) await applyEdit(get, set, (s) => s.setTextStyle(style, layer));
      if (t.orientation !== o.orientation) await applyEdit(get, set, (s) => s.typeOrientation(t.orientation, layer));
    }
  },
  cancelType() { set({ typeEditing: undefined }); },
  async revealAll() { await applyGeometry(get, set, (s) => s.revealAll()); },
  async combineShapes(op) {
    const { session, layers, selectedIds } = get();
    if (!session) return;
    const all = flatten(layers);
    // Display order is top-first; the bottom-most selected shape is the base (PS keeps the
    // lowest layer and stacks the others onto it).
    const shapes = all.filter((l) => selectedIds.includes(l.id) && /shape/i.test(l.kind)).reverse();
    if (shapes.length < 2) { set({ error: '请在图层面板中按住 Shift 选中两个或更多形状图层' }); return; }
    const base = shapes[0];
    set({ busy: true, error: undefined });
    try {
      const pathOf = async (id: number) => normPath(await session.pathInfo('layer', id));
      const merged = await pathOf(base.id);
      for (const l of shapes.slice(1)) {
        const p = await pathOf(l.id);
        for (const sp of p.subpaths) merged.subpaths.push({ ...sp, op });
      }
      set({ busy: false });
      await applyEdit(get, set, (s) => s.request([
        { cmd: 'shape.edit', params: { layer: base.id, path: toEngine(merged) } },
        ...shapes.slice(1).map((l) => ({ cmd: 'layer.delete', params: { layer: l.id } })),
      ]));
      set({ selectedId: base.id, selectedIds: [base.id] });
      void session.request(selectBatch([base.id])).catch(() => undefined);
      await get().refreshShapeInfo();
    } catch (e) {
      set({ busy: false, error: errText(e) });
    }
  },
  async mergeShapeComponents() {
    const id = get().selectedId;
    if (id == null) return;
    await applyEdit(get, set, (s) => s.request([{ cmd: 'layer.combineShapes.mergeShapeComponents', params: { layer: id } }]));
    await get().refreshShapeInfo();
  },
  selectLayersInBox(box, additive) {
    const [bx, by, bw, bh] = box;
    const hits = flatten(get().layers).filter((l) => {
      if (!l.bounds || l.bounds[2] <= 0 || l.visible === false) return false;
      if (/^pixel$/i.test(l.kind) && l.locks?.position && /^(背景|background)$/i.test(l.name)) return false; // not the Background
      const [x, y, w, h] = l.bounds;
      return x < bx + bw && x + w > bx && y < by + bh && y + h > by;
    }).map((l) => l.id);
    const ids = additive ? [...new Set([...get().selectedIds, ...hits])] : hits;
    if (!ids.length) return;
    set({ selectedIds: ids, selectedId: ids[ids.length - 1] });
    void get().session?.request(selectBatch(ids)).catch(() => undefined);
  },
  async movePath(dx, dy) {
    const ap = get().activePath;
    if (!ap || (!dx && !dy)) return;
    if (ap.source === 'layer' && ap.layer != null) {
      const layer = ap.layer;
      await applyEdit(get, set, (s) => s.shapeEdit(layer, { move: [Math.round(dx), Math.round(dy)] }));
      await get().refreshActivePath();
      await get().refreshShapeInfo();
      return;
    }
    await get().commitPath(translatePath(ap.path, Math.round(dx), Math.round(dy)));
  },
}));

/**
 * Cross-document side effects from any session (multi-document bridge): register documents a
 * command opened (Edit Contents) as tabs sharing the same engine, drop closed ones, and realign
 * the revision of documents another batch changed (a smart-object commit into its parent) —
 * otherwise that document's next request would be a spurious revision conflict.
 */
function handleDocEvents(ev: DocEvents, from: DocSession) {
  const st = useStore.getState();
  let tabs = st.tabs.filter((t) => !ev.closedDocs.includes(t.docId));
  for (const t of ev.touchedDocs) tabs.find((x) => x.docId === t.docId)?.session.syncRevision(t.revision);
  for (const od of ev.openedDocs) {
    if (tabs.some((t) => t.docId === od.docId)) continue;
    const s = DocSession.attach(from.client, od.docId);
    s.onEvents = handleDocEvents;
    tabs = [...tabs, { docId: od.docId, name: od.name || '内容', session: s, parent: from.docId }];
  }
  useStore.setState({ tabs });
}

/** Make `docId` the active document: re-inspect it and reset per-document view state. */
async function activateTab(get: () => AppState, set: (p: Partial<AppState>) => void, docId: string) {
  const tab = get().tabs.find((t) => t.docId === docId);
  if (!tab) return;
  const cur = get().activeDocId;
  if (cur && cur !== docId) viewByDoc.set(cur, get().view);
  if (get().typeEditing) await get().commitType();
  set({ busy: true, error: undefined, transformSession: undefined, cropSession: undefined });
  try {
    const s = tab.session;
    const info = await s.inspect();
    const first = flatten(info.layers ?? [])[0]?.id;
    if (first != null) await s.request(selectBatch([first])).catch(() => undefined);
    set({
      session: s, activeDocId: docId, fileName: tab.name,
      doc: { width: info.width, height: info.height, resolution: info.resolution },
      layers: info.layers ?? [],
      selectedId: first, selectedIds: first == null ? [] : [first],
      channels: info.channels?.alpha ?? [],
      history: info.history ?? [],
      historyDepth: { canUndo: !!info.canUndo, canRedo: !!info.canRedo },
      view: viewByDoc.get(docId) ?? { scale: 1, tx: 0, ty: 0 },
      originalFile: tab.originalFile,
      typeOpts: { ...get().typeOpts, size: defaultTypeSize(info.width, info.height) },
      shapeInfo: undefined, activePath: undefined,
      selection: undefined, maskEditing: false, transformSession: undefined,
      baselineSnapshot: undefined, compare: false, guides: [], textInfo: undefined, vectorMask: undefined,
      busy: false,
      render: { nonce: get().render.nonce + 1, damage: null },
    });
    await get().refreshSelection();
  } catch (e) {
    set({ busy: false, error: errText(e) });
  }
}

/** Selection commands do not change pixels, so only the mask and the overlay need refreshing. */
async function applySelection(
  get: () => AppState,
  set: (p: Partial<AppState>) => void,
  run: (s: DocSession) => Promise<unknown>,
) {
  const { session } = get();
  if (!session) return;
  set({ busy: true, error: undefined });
  try {
    await run(session);
    set({ busy: false });
    await get().refreshSelection();
  } catch (e) {
    if (e instanceof EngineError && e.code === 'CONFLICT') {
      set({ busy: false, error: '版本冲突，已刷新，请重试' });
      await get().refreshSelection();
    } else {
      set({ busy: false, error: errText(e) });
    }
  }
}

/** Runs a session edit, then refreshes layers + schedules a dirty-region redraw. Re-inspects on CONFLICT. */
async function applyEdit(
  get: () => AppState,
  set: (p: Partial<AppState>) => void,
  run: (s: DocSession) => Promise<{ damage?: unknown }>,
) {
  const { session } = get();
  if (!session) return;
  set({ busy: true, error: undefined });
  try {
    const body = await run(session);
    const info = await session.inspect();
    set({
      layers: info.layers ?? [],
      channels: info.channels?.alpha ?? get().channels,
      history: info.history ?? get().history,
      historyDepth: { canUndo: !!info.canUndo, canRedo: !!info.canRedo },
      busy: false,
      render: { nonce: get().render.nonce + 1, damage: toRects(body.damage as never) },
    });
  } catch (e) {
    if (e instanceof EngineError && e.code === 'CONFLICT') {
      const info = await session.inspect().catch(() => undefined);
      set({ busy: false, layers: info?.layers ?? get().layers, error: '版本冲突，已刷新，请重试' });
    } else {
      set({ busy: false, error: errText(e) });
    }
  }
}

/** The pixel layer a pixel-only command should act on: the selected one, else the first available. */
function pixelTarget(s: AppState): number | undefined {
  const all = flatten(s.layers);
  const isPixel = (l?: LayerNode) => !!l && /^pixel$/i.test(l.kind);
  return isPixel(all.find((l) => l.id === s.selectedId)) ? s.selectedId : all.find(isPixel)?.id;
}

/** Runs a layer-creating op, selects the newly created layer (last result carrying a numeric `layer`). */
async function applyCreateLayer(
  get: () => AppState,
  set: (p: Partial<AppState>) => void,
  run: (s: DocSession) => Promise<{ results?: { value?: unknown }[] }>,
) {
  const { session } = get();
  if (!session) return;
  set({ busy: true, error: undefined });
  try {
    const body = await run(session);
    const ids = (body.results ?? [])
      .map((r) => (r.value as { layer?: number } | undefined)?.layer)
      .filter((x): x is number => typeof x === 'number');
    const newId = ids[ids.length - 1];
    const info = await session.inspect();
    set({
      layers: info.layers ?? [],
      channels: info.channels?.alpha ?? get().channels,
      history: info.history ?? get().history,
      historyDepth: { canUndo: !!info.canUndo, canRedo: !!info.canRedo },
      busy: false,
      ...(newId != null ? { selectedId: newId, selectedIds: [newId] } : {}),
      render: { nonce: get().render.nonce + 1, damage: null },
    });
  } catch (e) {
    if (e instanceof EngineError && e.code === 'CONFLICT') {
      const info = await session.inspect().catch(() => undefined);
      set({ busy: false, layers: info?.layers ?? get().layers, error: '版本冲突，已刷新，请重试' });
    } else {
      set({ busy: false, error: errText(e) });
    }
  }
}

/** Runs a layer-removing/structural op (delete/merge/flatten/bg-convert), then re-points the
 *  selection at a layer that still exists (the previously selected one, else the first). */
async function applyStructural(
  get: () => AppState,
  set: (p: Partial<AppState>) => void,
  run: (s: DocSession) => Promise<unknown>,
) {
  const { session } = get();
  if (!session) return;
  set({ busy: true, error: undefined });
  try {
    await run(session);
    const info = await session.inspect();
    const ids = flatten(info.layers ?? []).map((l) => l.id);
    const cur = get().selectedId;
    const sel = cur != null && ids.includes(cur) ? cur : ids[0];
    set({
      layers: info.layers ?? [],
      channels: info.channels?.alpha ?? get().channels,
      history: info.history ?? get().history,
      historyDepth: { canUndo: !!info.canUndo, canRedo: !!info.canRedo },
      busy: false,
      selectedId: sel,
      selectedIds: sel != null ? [sel] : [],
      render: { nonce: get().render.nonce + 1, damage: null },
    });
    if (sel != null) void session.request(selectBatch([sel])).catch(() => undefined);
  } catch (e) {
    if (e instanceof EngineError && e.code === 'CONFLICT') {
      const info = await session.inspect().catch(() => undefined);
      set({ busy: false, layers: info?.layers ?? get().layers, error: '版本冲突，已刷新，请重试' });
    } else {
      set({ busy: false, error: errText(e) });
    }
  }
}

/** Resolves where a paint command writes and which layer must be active. */
function paintTarget(s: AppState): { target: PaintTarget; layer: number } | { error: string } {
  if (s.maskEditing) {
    const layer = flatten(s.layers).find((l) => l.id === s.selectedId);
    if (!layer?.hasMask) return { error: '当前图层没有蒙版，无法在蒙版上绘制' };
    return { target: 'mask', layer: layer.id };
  }
  const layer = pixelTarget(s);
  if (layer == null) return { error: '没有可用的像素图层，无法绘制' };
  return { target: 'pixels', layer };
}

/** Human-readable text for an error raised by the engine layer. */
function errText(e: unknown): string {
  const raw = e instanceof EngineError ? e.message : String(e);
  if (/is locked/i.test(raw)) return '图层已锁定，无法执行该操作（可在图层面板解锁）';
  return e instanceof EngineError ? (e.code ? `${e.code}：${e.message}` : e.message) : String(e);
}

export { flatten };

/** A closed rectangular subpath for path.set (SHP boolean ops / pen base). */
function rectSubpath(x: number, y: number, w: number, h: number) {
  return { closed: true, knots: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]] as [number, number][] };
}

/** Resolves the selected layer's adjustment (kind + params) for the photo panel. */
export function findAdjustment(
  layers: LayerNode[],
  selectedId?: number,
): { layerId: number; kind: string; params: Record<string, unknown> } | undefined {
  if (selectedId == null) return undefined;
  const layer = flatten(layers).find((l) => l.id === selectedId);
  const adj = layer?.adjustment;
  if (!adj) return undefined;
  // Parameterless adjustments (e.g. Invert) serialise as a bare string.
  if (typeof adj === 'string') return { layerId: selectedId, kind: adj, params: {} };
  const kind = Object.keys(adj)[0];
  if (!kind) return undefined;
  return { layerId: selectedId, kind, params: adj[kind] ?? {} };
}

/** Like applyEdit, but for commands that resize the canvas: full redraw, new doc size, reset view,
 *  and a dropped baseline (a snapshot of the old size would no longer line up). */
async function applyGeometry(
  get: () => AppState,
  set: (p: Partial<AppState>) => void,
  run: (s: DocSession) => Promise<unknown>,
) {
  const { session } = get();
  if (!session) return;
  set({ busy: true, error: undefined });
  try {
    await run(session);
    const info = await session.inspect();
    set({
      doc: { width: info.width, height: info.height, resolution: info.resolution },
      layers: info.layers ?? [],
      channels: info.channels?.alpha ?? get().channels,
      history: info.history ?? get().history,
      historyDepth: { canUndo: !!info.canUndo, canRedo: !!info.canRedo },
      view: { scale: 1, tx: 0, ty: 0 },
      baselineSnapshot: undefined,
      compare: false,
      busy: false,
      render: { nonce: get().render.nonce + 1, damage: null },
    });
    // The canvas changed size: the engine may have migrated or dropped the selection.
    await get().refreshSelection();
  } catch (e) {
    if (e instanceof EngineError && e.code === 'CONFLICT') {
      const info = await session.inspect().catch(() => undefined);
      set({ busy: false, layers: info?.layers ?? get().layers, error: '版本冲突，已刷新，请重试' });
    } else {
      set({ busy: false, error: errText(e) });
    }
  }
}
