// Layer-style (effects) table. Params verified against PhotoCraft 0.6.0 registry.
// Kept lean: each effect takes a colour (default foreground) and a size; the panel
// supplies both and this builds the engine params. `kind` matches the read-back
// `effects.items[].kind` so the panel can mark which effects are applied.

export interface FxSpec {
  cmd: string;
  label: string;
  /** The `effects.items[].kind` the engine reports once this style is applied. */
  kind: string;
  /** Whether the size slider / colour swatch is meaningful (purely for UI hinting). */
  usesSize: boolean;
  usesColor: boolean;
  build: (o: { color: string; size: number; bg: string }) => Record<string, unknown>;
}

export const EFFECTS: FxSpec[] = [
  { cmd: 'layer.layerStyle.stroke', label: '描边', kind: 'Stroke', usesSize: true, usesColor: true,
    build: (o) => ({ size: o.size, color: o.color, position: 'outside' }) },
  { cmd: 'layer.layerStyle.dropShadow', label: '投影', kind: 'Drop Shadow', usesSize: true, usesColor: true,
    build: (o) => ({ color: o.color, distance: o.size, size: o.size }) },
  { cmd: 'layer.layerStyle.innerShadow', label: '内阴影', kind: 'Inner Shadow', usesSize: true, usesColor: true,
    build: (o) => ({ color: o.color, distance: o.size, size: o.size }) },
  { cmd: 'layer.layerStyle.outerGlow', label: '外发光', kind: 'Outer Glow', usesSize: true, usesColor: true,
    build: (o) => ({ color: o.color, size: o.size }) },
  { cmd: 'layer.layerStyle.innerGlow', label: '内发光', kind: 'Inner Glow', usesSize: true, usesColor: true,
    build: (o) => ({ color: o.color, size: o.size }) },
  { cmd: 'layer.layerStyle.colorOverlay', label: '颜色叠加', kind: 'Color Overlay', usesSize: false, usesColor: true,
    build: (o) => ({ color: o.color, opacity: 100 }) },
  { cmd: 'layer.layerStyle.gradientOverlay', label: '渐变叠加', kind: 'Gradient Overlay', usesSize: false, usesColor: false,
    build: (o) => ({ from: o.color, to: o.bg }) },
  { cmd: 'layer.layerStyle.bevelEmboss', label: '斜面和浮雕', kind: 'Bevel Emboss', usesSize: true, usesColor: false,
    build: (o) => ({ style: 'inner', technique: 'smooth', depth: 150, size: o.size, direction: 'up' }) },
  { cmd: 'layer.layerStyle.satin', label: '光泽', kind: 'Satin', usesSize: true, usesColor: true,
    build: (o) => ({ color: o.color, opacity: 50, distance: o.size, size: o.size * 2 }) },
];

export const fxByCmd = (cmd: string) => EFFECTS.find((e) => e.cmd === cmd);
