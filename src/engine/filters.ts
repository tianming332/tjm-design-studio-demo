// Table-driven filter specs. Ranges/defaults copied from the engine's params docs
// (photocraft crates/engine/src/filters.rs), so sliders can't exceed the engine's accepted range.
export interface FilterField { key: string; label: string; min: number; max: number; step?: number; default: number }
export interface FilterSpec {
  cmd: string;
  /** Distinguishes several presets of one command (e.g. radial blur spin / zoom). */
  variant?: string;
  label: string;
  group: string;
  fields: FilterField[];
  /** Fixed params merged into every call (choices the MVP doesn't expose as sliders). */
  baked?: Record<string, unknown>;
}

// 5×5 kernels for 其他 › 自定 (row-major; centre = index 12).
const k5 = (centre3: number[]) => {
  const out = Array(25).fill(0);
  [6, 7, 8, 11, 12, 13, 16, 17, 18].forEach((i, j) => { out[i] = centre3[j]; });
  return out;
};

export const FILTERS: FilterSpec[] = [
  { cmd: 'filter.blur.gaussianBlur', label: '高斯模糊', group: '模糊', fields: [{ key: 'radius', label: '半径', min: 0.1, max: 250, step: 0.1, default: 4 }] },
  { cmd: 'filter.blur.boxBlur', label: '方框模糊', group: '模糊', fields: [{ key: 'radius', label: '半径', min: 1, max: 500, default: 8 }] },
  { cmd: 'filter.blur.motionBlur', label: '动感模糊', group: '模糊', fields: [{ key: 'angle', label: '角度', min: -360, max: 360, default: 0 }, { key: 'distance', label: '距离', min: 1, max: 500, default: 20 }] },
  { cmd: 'filter.blur.surfaceBlur', label: '表面模糊', group: '模糊', fields: [{ key: 'radius', label: '半径', min: 1, max: 100, default: 5 }, { key: 'threshold', label: '阈值', min: 2, max: 255, default: 15 }] },
  { cmd: 'filter.blur.radialBlur', variant: 'spin', label: '径向模糊（旋转）', group: '模糊', fields: [{ key: 'amount', label: '数量', min: 1, max: 100, default: 10 }], baked: { method: 'spin', quality: 'good' } },
  { cmd: 'filter.blur.radialBlur', variant: 'zoom', label: '径向模糊（缩放）', group: '模糊', fields: [{ key: 'amount', label: '数量', min: 1, max: 100, default: 10 }], baked: { method: 'zoom', quality: 'good' } },
  { cmd: 'filter.blur.lensBlur', label: '镜头模糊', group: '模糊', fields: [{ key: 'radius', label: '半径', min: 0, max: 100, default: 15 }] },
  { cmd: 'filter.blur.average', label: '平均', group: '模糊', fields: [] },
  { cmd: 'filter.blur.blur', label: '模糊', group: '模糊', fields: [] },
  { cmd: 'filter.blur.blurMore', label: '进一步模糊', group: '模糊', fields: [] },
  { cmd: 'filter.sharpen.unsharpMask', label: 'USM 锐化', group: '锐化', fields: [{ key: 'amount', label: '数量', min: 1, max: 500, default: 50 }, { key: 'radius', label: '半径', min: 0.1, max: 250, step: 0.1, default: 1 }, { key: 'threshold', label: '阈值', min: 0, max: 255, default: 0 }] },
  { cmd: 'filter.sharpen.smartSharpen', label: '智能锐化', group: '锐化', fields: [{ key: 'amount', label: '数量', min: 1, max: 500, default: 100 }, { key: 'radius', label: '半径', min: 0.1, max: 64, step: 0.1, default: 1 }, { key: 'reduceNoise', label: '减少杂色', min: 0, max: 100, default: 10 }] },
  { cmd: 'filter.sharpen.sharpen', label: '锐化', group: '锐化', fields: [] },
  { cmd: 'filter.sharpen.sharpenMore', label: '进一步锐化', group: '锐化', fields: [] },
  { cmd: 'filter.sharpen.sharpenEdges', label: '锐化边缘', group: '锐化', fields: [] },
  {
    cmd: 'filter.noise.addNoise', label: '添加杂色', group: '杂色',
    fields: [{ key: 'amount', label: '数量', min: 0.1, max: 400, step: 0.1, default: 12.5 }, { key: 'seed', label: '随机种子', min: 0, max: 9999, default: 0 }],
    baked: { distribution: 'gaussian', monochromatic: true },
  },
  {
    cmd: 'filter.noise.reduceNoise', label: '减少杂色', group: '杂色',
    fields: [
      { key: 'strength', label: '强度', min: 0, max: 10, default: 6 }, { key: 'preserveDetails', label: '保留细节', min: 0, max: 100, default: 60 },
      { key: 'reduceColorNoise', label: '减少彩色杂色', min: 0, max: 100, default: 45 }, { key: 'sharpenDetails', label: '锐化细节', min: 0, max: 100, default: 25 },
    ],
  },
  { cmd: 'filter.noise.dustAndScratches', label: '蒙尘与划痕', group: '杂色', fields: [{ key: 'radius', label: '半径', min: 1, max: 100, default: 1 }, { key: 'threshold', label: '阈值', min: 0, max: 255, default: 0 }] },
  { cmd: 'filter.noise.median', label: '中间值', group: '杂色', fields: [{ key: 'radius', label: '半径', min: 1, max: 100, default: 2 }] },
  { cmd: 'filter.noise.despeckle', label: '去斑', group: '杂色', fields: [] },
  { cmd: 'filter.other.highPass', label: '高反差保留', group: '其他', fields: [{ key: 'radius', label: '半径', min: 0.1, max: 250, step: 0.1, default: 10 }] },
  {
    cmd: 'filter.other.offset', label: '位移', group: '其他',
    fields: [{ key: 'horizontal', label: '水平', min: -2000, max: 2000, default: 50 }, { key: 'vertical', label: '垂直', min: -2000, max: 2000, default: 50 }],
    baked: { undefinedAreas: 'wrap' },
  },
  { cmd: 'filter.other.maximum', label: '最大值', group: '其他', fields: [{ key: 'radius', label: '半径', min: 0.2, max: 100, step: 0.1, default: 1 }], baked: { preserve: 'squareness' } },
  { cmd: 'filter.other.minimum', label: '最小值', group: '其他', fields: [{ key: 'radius', label: '半径', min: 0.2, max: 100, step: 0.1, default: 1 }], baked: { preserve: 'squareness' } },
  { cmd: 'filter.other.custom', variant: 'sharpen', label: '自定（锐化核）', group: '其他', fields: [], baked: { kernel: k5([0, -1, 0, -1, 5, -1, 0, -1, 0]), scale: 1, offset: 0 } },
  { cmd: 'filter.other.custom', variant: 'emboss', label: '自定（浮雕核）', group: '其他', fields: [], baked: { kernel: k5([-2, -1, 0, -1, 1, 1, 0, 1, 2]), scale: 1, offset: 0 } },
  { cmd: 'filter.stylize.findEdges', label: '查找边缘', group: '风格化', fields: [] },
  { cmd: 'filter.stylize.emboss', label: '浮雕', group: '风格化', fields: [{ key: 'angle', label: '角度', min: -180, max: 180, default: 135 }, { key: 'height', label: '高度', min: 1, max: 100, default: 3 }, { key: 'amount', label: '数量', min: 1, max: 500, default: 100 }] },
  { cmd: 'filter.pixelate.mosaic', label: '马赛克', group: '像素化', fields: [{ key: 'cellSize', label: '单元格', min: 2, max: 200, default: 10 }] },
];

/** Stable id of a spec: the command, plus the variant when one command has several presets. */
export const filterId = (f: FilterSpec) => (f.variant ? `${f.cmd}#${f.variant}` : f.cmd);

export function filterByCmd(cmd: string): FilterSpec | undefined {
  return FILTERS.find((f) => filterId(f) === cmd) ?? FILTERS.find((f) => f.cmd === cmd);
}

/** Default slider values for a filter spec. */
export function defaultValues(spec: FilterSpec): Record<string, number> {
  return Object.fromEntries(spec.fields.map((f) => [f.key, f.default]));
}

/** Engine params for a filter from slider values plus any baked choices. */
export function filterParams(spec: FilterSpec, values: Record<string, number>): Record<string, unknown> {
  return { ...values, ...(spec.baked ?? {}) };
}
