// tjm/0 protocol: command names (verified against PhotoCraft 0.6.0 registry) and shared types.

/** Command ids used by the MVP edit slice. Verified via `photocraft-cli commands`. */
export const CMD = {
  docInspect: 'doc.inspect',
  layerSetProps: 'layer.setProps',
  layerTranslate: 'layer.translate',
  layerSelect: 'layer.select',
  typeCreate: 'type.create',
  typeEdit: 'type.edit',
  shapeCreate: 'shape.create',
  typeResolveMissingFonts: 'type.resolveMissingFonts',
  editUndo: 'edit.undo',
  editRedo: 'edit.redo',
  imageCrop: 'image.crop',
  imageSize: 'image.imageSize',
  canvasSize: 'image.canvasSize',
  layerSetAdjustment: 'layer.setAdjustment',
  // Layer tree ops
  layerNew: 'layer.new.layer',
  layerDuplicate: 'layer.duplicate',
  layerDelete: 'layer.delete',
  layerFromBackground: 'layer.new.layerFromBackground',
  layerGroup: 'layer.groupLayers',
  layerLock: 'layer.lockLayers',
  layerMergeDown: 'layer.mergeDown',
  layerMergeVisible: 'layer.mergeVisible',
  layerFlatten: 'layer.flattenImage',
  fillSolid: 'layer.newFillLayer.solidColor',
  fillGradient: 'layer.newFillLayer.gradient',
  layerStyleClear: 'layer.layerStyle.clear',
  // Clipping mask / selection store / stroke
  layerClip: 'layer.createClippingMask',
  layerUnclip: 'layer.releaseClippingMask',
  selectSave: 'select.saveSelection',
  selectLoad: 'select.loadSelection',
  editStroke: 'edit.stroke',
  // Shape / path
  shapeEdit: 'shape.edit',
  pathSet: 'path.set',
  pathList: 'path.list',
  pathToSelection: 'path.toSelection',
  selectToWorkPath: 'select.toWorkPath',
  pathFill: 'path.fill',
  pathStroke: 'path.stroke',
  pathMoveAnchors: 'path.moveAnchors',
  pathConvertPoint: 'path.convertPoint',
  pathInfo: 'path.info',
  shapeInfo: 'shape.info',
  layerPickAt: 'layer.pickAt',
  brushPresetsList: 'brush.presets.list',
  // Channels / guides / warp
  channelNew: 'channel.new',
  channelDup: 'channel.duplicate',
  channelDelete: 'channel.delete',
  viewNewGuide: 'view.newGuide',
  viewClearGuides: 'view.clearGuides',
  editWarp: 'edit.transform.warp',
  // Type
  typeInfo: 'type.info',
  typeFonts: 'type.fonts',
  typeSetStyle: 'type.setStyle',
  docPixel: 'document.pixel',
  // Vector mask
  vmFromPath: 'layer.vectorMask.fromPath',
  vmDelete: 'layer.vectorMask.delete',
  vmEnabled: 'layer.vectorMask.enabled',
  vmInfo: 'layer.vectorMask.info',
  // Selection tools
  selectRect: 'select.rect',
  selectLasso: 'select.lasso',
  selectMagicWand: 'select.magicWand',
  // Select menu
  selectAll: 'select.all',
  selectDeselect: 'select.deselect',
  selectInverse: 'select.inverse',
  selectReselect: 'select.reselect',
  selectGrow: 'select.grow',
  selectSimilar: 'select.similar',
  // Selection-driven edits
  editFill: 'edit.fill',
  editClear: 'edit.clear',
  layerMaskFromSelection: 'layer.layerMask.revealSelection',
  // Paint
  paintStroke: 'paint.stroke',
  paintPencil: 'paint.pencil',
  paintBucket: 'paint.bucket',
  paintGradient: 'paint.gradient',
  // Colors
  toolsSetColors: 'tools.setColors',
  toolsSwapColors: 'tools.swapColors',
  toolsDefaultColors: 'tools.defaultColors',
  // Transform
  editTransform: 'edit.transform',
  transformSelection: 'select.transformSelection',
  // Retouch
  paintSpotHealing: 'paint.spotHealing',
  paintHealingBrush: 'paint.healingBrush',
  paintCloneStamp: 'paint.cloneStamp',
  editContentAwareFill: 'edit.contentAwareFill',
  // Smart objects
  soConvert: 'layer.smartObjects.convertToSmartObject',
  soViaCopy: 'layer.smartObjects.newSmartObjectViaCopy',
  soRasterize: 'layer.smartObjects.rasterize',
  soToLayers: 'layer.smartObjects.convertToLayers',
} as const;

/** Where a paint command writes: layer pixels, the active layer's mask, or a specific channel. */
export type PaintTarget = 'pixels' | 'mask' | 'quickMask' | { channel: number };

/** How a new selection combines with the existing one (PS modifier keys). */
export type SelectMode = 'replace' | 'add' | 'subtract' | 'intersect';

/** Decoded `selection_mask` payload: content bounds plus one coverage byte per pixel. */
export interface SelectionMask {
  x: number;
  y: number;
  width: number;
  height: number;
  coverage: Uint8Array;
}

/** Decodes the bridge's 16-byte header + `w*h` coverage bytes. Empty payload → undefined. */
export function unpackSelectionMask(bytes: ArrayBuffer | undefined): SelectionMask | undefined {
  if (!bytes || bytes.byteLength < 16) return undefined;
  const dv = new DataView(bytes);
  const x = dv.getInt32(0, true);
  const y = dv.getInt32(4, true);
  const width = dv.getUint32(8, true);
  const height = dv.getUint32(12, true);
  if (width === 0 || height === 0) return undefined;
  const coverage = new Uint8Array(bytes, 16, Math.min(width * height, bytes.byteLength - 16));
  return { x, y, width, height, coverage };
}

export interface Rect { x: number; y: number; w: number; h: number }

export interface LayerLocks { transparency: boolean; pixels: boolean; position: boolean; artboard?: boolean; all: boolean }

export interface LayerNode {
  id: number;
  name: string;
  kind: string; // Pixel | Type | Shape | Group | Adjustment | Fill | Smart Object ...
  blend: string;
  fill: number; // 0..1 fill opacity
  opacity?: number; // 0..1
  visible?: boolean;
  clipped?: boolean;
  hasMask?: boolean;
  /** Type layers: plain text summary from inspect. */
  text?: { text: string; font: string; sizePt: number };
  /** Lock flags (added by the bridge's inspect; the engine JSON omits them). */
  locks?: LayerLocks;
  bounds?: [number, number, number, number]; // x, y, w, h
  /** Present on adjustment layers: `{ "<Kind>": { ...params } }`, e.g. `{ BrightnessContrast: { brightness: 10 } }`.
   *  Parameterless adjustments (e.g. Invert) serialise as a bare string `"Invert"`. */
  adjustment?: Record<string, Record<string, unknown>> | string;
  /** Applied layer styles (read-back is kind + enabled only, not full params). */
  effects?: { enabled: boolean; items: { kind: string; enabled: boolean }[] };
  children?: LayerNode[];
}

export interface DocInspect {
  width: number;
  height: number;
  depth?: number;
  /** Pixels per inch (drives ruler units). */
  resolution?: number;
  layers: LayerNode[];
  /** Alpha channels (stored/loaded selections); colour channels omitted here. */
  channels?: { alpha?: { name: string; index: number }[] };
  /** Undo stack labels, truncated at the current state (the last entry is "now"). */
  history?: string[];
  canUndo?: boolean;
  canRedo?: boolean;
}

/** A single command result inside a tjm/0 reply. */
export interface CmdResult<T = unknown> { status?: string; value?: T; error?: string }

/** Parsed body of an `op:'request'` reply (one atomic batch).
 *  `error` is the engine's ProtoError object `{code, message, at}` (or a bare string).
 *  `damage` is `[x0, y0, x1, y1]` in document pixels — see `toRects`. */
export interface RequestReply {
  status: 'ok' | 'error' | 'conflict' | string;
  revision: number;
  results: CmdResult[];
  damage?: unknown;
  error?: unknown;
  /** Documents the batch opened (e.g. Edit Contents), closed, or changed besides the target. */
  openedDocs?: OpenedDoc[];
  closedDocs?: string[];
  touchedDocs?: { docId: string; revision: number }[];
}

/** A document opened by a command inside the shared engine (multi-document bridge). */
export interface OpenedDoc { docId: string; name: string; width: number; height: number }

/** Cross-document side effects of a request or close. */
export interface DocEvents {
  openedDocs: OpenedDoc[];
  closedDocs: string[];
  touchedDocs: { docId: string; revision: number }[];
}

/** Parsed body of an `op:'open'` reply. */
export interface OpenReply {
  status: 'ok' | 'error' | string;
  result?: {
    docId: string;
    revision?: number;
    warnings?: string[];
    document?: { warnings?: string[] } & Record<string, unknown>;
  };
  error?: string;
}

/** `layer.setProps` keys the UI edits (`fill` = fill opacity 0..1, applied before layer effects). */
export type LayerProps = { visible: boolean; opacity: number; blend: string; name: string; fill: number; locks: Partial<LayerLocks> };
