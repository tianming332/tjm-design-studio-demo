// Table-driven adjustment specs. Ranges and defaults are copied from the engine's params docs
// (photocraft crates/engine/src/commands.rs › ADJ), so sliders can never produce a value the
// bridge's strict validation rejects.
//
// `kind` matches the key the engine serialises in `doc.inspect` → layer.adjustment,
// e.g. `{ "BrightnessContrast": { "brightness": 10 } }` (PascalCase enum variant).
//
// IMPORTANT: the read-back is the engine's *internal* form, which for several kinds differs from
// the command params (verified with photocraft-cli 0.6.0):
//   Levels        → { master:{in_black,gamma,in_white,out_black,out_white} (0..1), per_channel:[r,g,b] }
//   Curves        → { master:[{input,output}] (0..1), per_channel:[[…],[…],[…]] }
//   BlackWhite    → { weights:[reds,yellows,greens,cyans,blues,magentas] }
//   HueSaturation → { hue,saturation,lightness,colorize, ranges:[{hue,saturation,lightness,bounds}]×6 }
// Reading those as if they were params silently showed defaults and — worse — the next commit
// wrote the defaults back, wiping every value the user had not just touched. `fromParams`
// therefore understands both forms.

export interface AdjustField {
  key: string;
  label: string;
  min: number;
  max: number;
  step?: number;
  default: number;
  /** Channel / colour-range group this field belongs to (undefined = composite / master). */
  group?: string;
  /** Rendered as a checkbox (value 0/1). */
  bool?: boolean;
}

export interface AdjustSpec {
  cmd: string;
  kind: string;
  label: string;
  fields: AdjustField[];
  /** Selectable channel / range groups; the first entry (key '') is the composite. */
  groups?: { key: string; label: string }[];
  /** One-click value sets, written into the selected group. */
  presets?: { label: string; values: Record<string, number> }[];
  /** Maps slider values to engine params (default: identity). */
  toParams?: (values: Record<string, number>) => Record<string, unknown>;
  /** Reads slider values back from engine params or inspect read-back (default: pick by key). */
  fromParams?: (params: Record<string, unknown>) => Record<string, number>;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const obj = (v: unknown): Record<string, unknown> | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined);
const k = (group: string, key: string) => (group ? `${group}.${key}` : key);

const RGB = [{ key: '', label: '复合 RGB' }, { key: 'red', label: '红' }, { key: 'green', label: '绿' }, { key: 'blue', label: '蓝' }];
// --- Levels -------------------------------------------------------------------------------
const LEVEL_KEYS: [string, string, number, number, number, number?][] = [
  ['inBlack', '输入黑场', 0, 253, 0], ['gamma', '灰度系数', 0.01, 9.99, 1, 0.01], ['inWhite', '输入白场', 2, 255, 255],
  ['outBlack', '输出黑场', 0, 255, 0], ['outWhite', '输出白场', 0, 255, 255],
];
const levelFields: AdjustField[] = RGB.flatMap((g) =>
  LEVEL_KEYS.map(([key, label, min, max, def, step]) => ({ key: k(g.key, key), label, min, max, default: def, step, group: g.key || undefined })),
);
function levelsGroup(v: Record<string, number>, g: string) {
  return Object.fromEntries(LEVEL_KEYS.map(([key, , , , def]) => [key, v[k(g, key)] ?? def]));
}
/** Read-back level struct (snake_case, 0..1) or params (camelCase, 0..255) -> slider values. */
function levelsFrom(src: Record<string, unknown> | undefined, g: string, out: Record<string, number>) {
  if (!src) return;
  const snake = 'in_black' in src || 'out_white' in src;
  const pick = (camel: string, snakeKey: string, scale: boolean) => {
    const v = num(src[snake ? snakeKey : camel]);
    if (v != null) out[k(g, camel)] = snake && scale ? Math.round(v * 255) : Math.round(v * 100) / 100;
  };
  pick('inBlack', 'in_black', true); pick('inWhite', 'in_white', true);
  pick('outBlack', 'out_black', true); pick('outWhite', 'out_white', true);
  pick('gamma', 'gamma', false);
}

// --- Curves -------------------------------------------------------------------------------
// Three movable points (shadows 64, midtones 128, highlights 192) per channel; endpoints fixed.
const CURVE_X = [64, 128, 192] as const;
const CURVE_KEYS = ['shadow', 'mid', 'highlight'] as const;
const curveFields: AdjustField[] = RGB.flatMap((g) =>
  CURVE_KEYS.map((key, i) => ({ key: k(g.key, key), label: ['暗部(64)', '中间调(128)', '亮部(192)'][i], min: 0, max: 255, default: CURVE_X[i], group: g.key || undefined })),
);
function curvePoints(v: Record<string, number>, g: string): [number, number][] {
  return [[0, 0], ...CURVE_X.map((x, i) => [x, Math.round(clamp(v[k(g, CURVE_KEYS[i])] ?? x, 0, 255))] as [number, number]), [255, 255]];
}
/** Output of a piecewise-linear curve at `x` (0..255). Accepts [[x,y]] (0..255) or [{input,output}] (0..1). */
export function curveAt(points: unknown, x: number): number | undefined {
  if (!Array.isArray(points) || points.length < 2) return undefined;
  const pts = points
    .map((p) => (Array.isArray(p) ? [num(p[0]), num(p[1])] : [num((p as { input?: unknown })?.input), num((p as { output?: unknown })?.output)]))
    .filter((p): p is [number, number] => p[0] != null && p[1] != null);
  if (pts.length < 2) return undefined;
  const normalised = !Array.isArray(points[0]);
  const scaled = (normalised ? pts.map(([a, b]) => [a * 255, b * 255]) : pts).sort((a, b) => a[0] - b[0]) as [number, number][];
  if (x <= scaled[0][0]) return scaled[0][1];
  for (let i = 1; i < scaled.length; i++) {
    const [x0, y0] = scaled[i - 1];
    const [x1, y1] = scaled[i];
    if (x <= x1) return x1 === x0 ? y1 : y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
  }
  return scaled[scaled.length - 1][1];
}
function curvesFrom(points: unknown, g: string, out: Record<string, number>) {
  CURVE_X.forEach((x, i) => {
    const y = curveAt(points, x);
    if (y != null) out[k(g, CURVE_KEYS[i])] = Math.round(y);
  });
}
// --- Hue / Saturation ---------------------------------------------------------------------
const HUE_RANGES = [
  { key: 'reds', label: '红色' }, { key: 'yellows', label: '黄色' }, { key: 'greens', label: '绿色' },
  { key: 'cyans', label: '青色' }, { key: 'blues', label: '蓝色' }, { key: 'magentas', label: '洋红' },
];
const HSL = ['hue', 'saturation', 'lightness'] as const;
const hueFields: AdjustField[] = [
  { key: 'hue', label: '色相', min: -180, max: 180, default: 0 },
  { key: 'saturation', label: '饱和度', min: -100, max: 100, default: 0 },
  { key: 'lightness', label: '明度', min: -100, max: 100, default: 0 },
  { key: 'colorize', label: '着色', min: 0, max: 1, default: 0, bool: true },
  ...HUE_RANGES.flatMap((r) => [
    { key: k(r.key, 'hue'), label: '色相', min: -180, max: 180, default: 0, group: r.key },
    { key: k(r.key, 'saturation'), label: '饱和度', min: -100, max: 100, default: 0, group: r.key },
    { key: k(r.key, 'lightness'), label: '明度', min: -100, max: 100, default: 0, group: r.key },
  ]),
];
function hueToParams(v: Record<string, number>): Record<string, unknown> {
  const colorize = (v.colorize ?? 0) >= 0.5;
  const hue = v.hue ?? 0;
  const p: Record<string, unknown> = {
    // Colorize takes an absolute hue 0..360 and saturation 0..100.
    hue: colorize ? ((hue % 360) + 360) % 360 : hue,
    saturation: colorize ? clamp(v.saturation ?? 0, 0, 100) : (v.saturation ?? 0),
    lightness: v.lightness ?? 0,
    colorize,
  };
  for (const r of HUE_RANGES) p[r.key] = Object.fromEntries(HSL.map((key) => [key, v[k(r.key, key)] ?? 0]));
  return p;
}
function hueFrom(p: Record<string, unknown>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const key of HSL) { const v = num(p[key]); if (v != null) out[key] = v; }
  if (typeof p.colorize === 'boolean') out.colorize = p.colorize ? 1 : 0;
  if (out.colorize === 1 && out.hue != null && out.hue > 180) out.hue -= 360; // 0..360 shown on the -180..180 slider
  const ranges = Array.isArray(p.ranges) ? p.ranges : undefined;
  HUE_RANGES.forEach((r, i) => {
    const src = ranges ? obj(ranges[i]) : obj(p[r.key]);
    if (!src) return;
    for (const key of HSL) { const v = num(src[key]); if (v != null) out[k(r.key, key)] = v; }
  });
  return out;
}

const BW_KEYS = ['reds', 'yellows', 'greens', 'cyans', 'blues', 'magentas'] as const;
export const ADJUSTMENTS: AdjustSpec[] = [
  {
    cmd: 'layer.newAdjustmentLayer.brightnessContrast', kind: 'BrightnessContrast', label: '亮度/对比度',
    fields: [
      { key: 'brightness', label: '亮度', min: -150, max: 150, default: 0 },
      { key: 'contrast', label: '对比度', min: -50, max: 100, default: 0 },
    ],
  },
  {
    cmd: 'layer.newAdjustmentLayer.levels', kind: 'Levels', label: '色阶', groups: RGB, fields: levelFields,
    toParams: (v) => ({ ...levelsGroup(v, ''), red: levelsGroup(v, 'red'), green: levelsGroup(v, 'green'), blue: levelsGroup(v, 'blue') }),
    fromParams: (p) => {
      const out: Record<string, number> = {};
      levelsFrom(obj(p.master) ?? p, '', out);
      const per = Array.isArray(p.per_channel) ? p.per_channel : undefined;
      ['red', 'green', 'blue'].forEach((g, i) => levelsFrom(per ? obj(per[i]) : obj(p[g]), g, out));
      return out;
    },
  },
  {
    cmd: 'layer.newAdjustmentLayer.curves', kind: 'Curves', label: '曲线', groups: RGB, fields: curveFields,
    presets: [
      { label: '线性', values: { shadow: 64, mid: 128, highlight: 192 } },
      { label: '增加对比度', values: { shadow: 48, mid: 128, highlight: 208 } },
      { label: '变亮', values: { shadow: 84, mid: 154, highlight: 212 } },
      { label: '变暗', values: { shadow: 44, mid: 102, highlight: 172 } },
    ],
    toParams: (v) => ({ points: curvePoints(v, ''), red: curvePoints(v, 'red'), green: curvePoints(v, 'green'), blue: curvePoints(v, 'blue') }),
    fromParams: (p) => {
      const out: Record<string, number> = {};
      curvesFrom(p.master ?? p.points, '', out);
      const per = Array.isArray(p.per_channel) ? p.per_channel : undefined;
      ['red', 'green', 'blue'].forEach((g, i) => curvesFrom(per ? per[i] : p[g], g, out));
      return out;
    },
  },
  {
    cmd: 'layer.newAdjustmentLayer.exposure', kind: 'Exposure', label: '曝光',
    fields: [
      { key: 'exposure', label: '曝光', min: -20, max: 20, step: 0.1, default: 0 },
      { key: 'offset', label: '偏移', min: -0.5, max: 0.5, step: 0.01, default: 0 },
      { key: 'gamma', label: '灰度系数', min: 0.01, max: 9.99, step: 0.01, default: 1 },
    ],
  },
  {
    cmd: 'layer.newAdjustmentLayer.vibrance', kind: 'Vibrance', label: '自然饱和度',
    fields: [
      { key: 'vibrance', label: '自然饱和度', min: -100, max: 100, default: 0 },
      { key: 'saturation', label: '饱和度', min: -100, max: 100, default: 0 },
    ],
  },
  {
    cmd: 'layer.newAdjustmentLayer.hueSaturation', kind: 'HueSaturation', label: '色相/饱和度',
    groups: [{ key: '', label: '全图' }, ...HUE_RANGES], fields: hueFields, toParams: hueToParams, fromParams: hueFrom,
  },
  {
    cmd: 'layer.newAdjustmentLayer.blackWhite', kind: 'BlackWhite', label: '黑白',
    fields: [
      { key: 'reds', label: '红', min: -200, max: 300, default: 40 },
      { key: 'yellows', label: '黄', min: -200, max: 300, default: 60 },
      { key: 'greens', label: '绿', min: -200, max: 300, default: 40 },
      { key: 'cyans', label: '青', min: -200, max: 300, default: 60 },
      { key: 'blues', label: '蓝', min: -200, max: 300, default: 20 },
      { key: 'magentas', label: '洋红', min: -200, max: 300, default: 80 },
    ],
    fromParams: (p) => {
      const w = Array.isArray(p.weights) ? p.weights : undefined;
      const out: Record<string, number> = {};
      BW_KEYS.forEach((key, i) => { const v = num(w ? w[i] : p[key]); if (v != null) out[key] = v; });
      return out;
    },
  },
  {
    cmd: 'layer.newAdjustmentLayer.colorBalance', kind: 'ColorBalance', label: '色彩平衡（中间调）',
    fields: [
      { key: 'cr', label: '青—红', min: -100, max: 100, default: 0 },
      { key: 'mg', label: '洋红—绿', min: -100, max: 100, default: 0 },
      { key: 'yb', label: '黄—蓝', min: -100, max: 100, default: 0 },
    ],
    toParams: (v) => ({ midtones: [v.cr ?? 0, v.mg ?? 0, v.yb ?? 0] }),
    fromParams: (p) => {
      const m = p.midtones as number[] | undefined;
      return { cr: m?.[0] ?? 0, mg: m?.[1] ?? 0, yb: m?.[2] ?? 0 };
    },
  },
  {
    cmd: 'layer.newAdjustmentLayer.posterize', kind: 'Posterize', label: '色调分离',
    fields: [{ key: 'levels', label: '色阶数', min: 2, max: 255, default: 4 }],
  },
  {
    cmd: 'layer.newAdjustmentLayer.threshold', kind: 'Threshold', label: '阈值',
    fields: [{ key: 'level', label: '阈值', min: 1, max: 255, default: 128 }],
    toParams: (v) => ({ level: v.level }),
    // Engine stores threshold normalised 0..1; map it back to the 1..255 slider.
    fromParams: (p) => {
      const lv = typeof p.level === 'number' ? (p.level as number) : 0.5;
      return { level: lv <= 1 ? Math.round(lv * 255) : Math.round(lv) };
    },
  },
  { cmd: 'layer.newAdjustmentLayer.invert', kind: 'Invert', label: '反相', fields: [] },
];
/** Looks up a spec by the inspect kind key (case-insensitive). */
export function specForKind(kind: string): AdjustSpec | undefined {
  const lk = kind.toLowerCase();
  return ADJUSTMENTS.find((a) => a.kind.toLowerCase() === lk);
}

/** Current slider values for a spec, falling back to each field's default. */
export function valuesFrom(spec: AdjustSpec, params: Record<string, unknown>): Record<string, number> {
  if (spec.fromParams) {
    const v = spec.fromParams(params);
    return Object.fromEntries(spec.fields.map((f) => [f.key, clamp(v[f.key] ?? f.default, f.min, f.max)]));
  }
  return Object.fromEntries(
    spec.fields.map((f) => [f.key, typeof params[f.key] === 'number' ? clamp(params[f.key] as number, f.min, f.max) : f.default]),
  );
}

/** Engine params for a spec from slider values. */
export function paramsFrom(spec: AdjustSpec, values: Record<string, number>): Record<string, unknown> {
  return spec.toParams ? spec.toParams(values) : { ...values };
}

/** Fields shown for the selected group ('' = composite / master). */
export function fieldsForGroup(spec: AdjustSpec, group: string): AdjustField[] {
  return spec.fields.filter((f) => (f.group ?? '') === group);
}

/** Writes a preset's keys into the selected group. */
export function applyPreset(values: Record<string, number>, preset: Record<string, number>, group: string): Record<string, number> {
  const next = { ...values };
  for (const [key, v] of Object.entries(preset)) next[k(group, key)] = v;
  return next;
}
