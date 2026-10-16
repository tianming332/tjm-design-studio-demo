// Text style bridging: engine `type.info` read-back (snake_case, normalised units) <-> UI values.
// Verified against PhotoCraft 0.6.0: `horizontal_scale`/`vertical_scale` come back as 0..1 while the
// command takes percent; `align` comes back capitalised ("Center") while the command takes lowercase;
// colour comes back as `{c:[r,g,b,a], mode}` with 0..1 components.

export type Caps = 'normal' | 'small' | 'all';
export type Align = 'left' | 'center' | 'right' | 'justify';
export type Orientation = 'horizontal' | 'vertical';

export interface TextStyleUI {
  font: string;
  size: number;
  leading: number;
  tracking: number;
  hScale: number; // percent
  vScale: number; // percent
  baselineShift: number;
  color: string; // #rrggbb
  fauxBold: boolean;
  fauxItalic: boolean;
  underline: boolean;
  strikethrough: boolean;
  caps: Caps;
  align: Align;
  firstLineIndent: number;
  spaceBefore: number;
  spaceAfter: number;
  hyphenate: boolean;
  orientation: Orientation;
  text: string;
}

export const DEFAULT_TEXT_STYLE: TextStyleUI = {
  font: '', size: 12, leading: 0, tracking: 0, hScale: 100, vScale: 100, baselineShift: 0,
  color: '#000000', fauxBold: false, fauxItalic: false, underline: false, strikethrough: false,
  caps: 'normal', align: 'left', firstLineIndent: 0, spaceBefore: 0, spaceAfter: 0,
  hyphenate: false, orientation: 'horizontal', text: '',
};

const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);
const str = (v: unknown, fallback: string) => (typeof v === 'string' && v ? v : fallback);

/** `{c:[r,g,b,...]}` with 0..1 components -> `#rrggbb`. */
export function colorToHex(c: unknown, fallback = '#000000'): string {
  const arr = (c as { c?: unknown })?.c;
  if (!Array.isArray(arr) || arr.length < 3) return fallback;
  const hex = arr.slice(0, 3).map((v) => {
    const n = Math.round(Math.min(1, Math.max(0, typeof v === 'number' ? v : 0)) * 255);
    return n.toString(16).padStart(2, '0');
  });
  return `#${hex.join('')}`;
}

/** Parses an engine `type.info` / `type.setStyle` payload into UI values (missing fields -> defaults). */
export function parseTypeInfo(info: unknown): TextStyleUI {
  const o = (info ?? {}) as Record<string, unknown>;
  const run = (Array.isArray(o.runs) ? o.runs[0] : undefined) as { style?: Record<string, unknown> } | undefined;
  const para = (Array.isArray(o.paragraphs) ? o.paragraphs[0] : undefined) as { style?: Record<string, unknown> } | undefined;
  const rs = run?.style ?? {};
  const ps = para?.style ?? {};
  const d = DEFAULT_TEXT_STYLE;
  const alignRaw = str(ps.align, d.align).toLowerCase();
  const align: Align = alignRaw.startsWith('center') ? 'center'
    : alignRaw.startsWith('right') ? 'right'
      : alignRaw.startsWith('justify') ? 'justify' : 'left';
  const capsRaw = str(rs.caps, d.caps).toLowerCase();
  const caps: Caps = capsRaw.startsWith('small') ? 'small' : capsRaw.startsWith('all') ? 'all' : 'normal';
  return {
    font: str(rs.font_family, d.font),
    size: num(rs.size_pt, d.size),
    leading: num(rs.leading_pt, d.leading),
    tracking: num(rs.tracking, d.tracking),
    hScale: Math.round(num(rs.horizontal_scale, 1) * 100),
    vScale: Math.round(num(rs.vertical_scale, 1) * 100),
    baselineShift: num(rs.baseline_shift_pt, d.baselineShift),
    color: colorToHex(rs.color, d.color),
    fauxBold: bool(rs.faux_bold, d.fauxBold),
    fauxItalic: bool(rs.faux_italic, d.fauxItalic),
    underline: bool(rs.underline, d.underline),
    strikethrough: bool(rs.strikethrough, d.strikethrough),
    caps,
    align,
    firstLineIndent: num(ps.first_line_indent_pt, d.firstLineIndent),
    spaceBefore: num(ps.space_before_pt, d.spaceBefore),
    spaceAfter: num(ps.space_after_pt, d.spaceAfter),
    hyphenate: bool(ps.hyphenate, d.hyphenate),
    orientation: str(o.orientation, 'Horizontal').toLowerCase().startsWith('vert') ? 'vertical' : 'horizontal',
    text: str(o.text, d.text),
  };
}

/** UI values -> `type.setStyle` params (percent scales, lowercase align, hex colour). */
export function styleParams(ui: TextStyleUI): Record<string, unknown> {
  const p: Record<string, unknown> = {
    size: ui.size,
    tracking: ui.tracking,
    horizontalScale: ui.hScale,
    verticalScale: ui.vScale,
    baselineShift: ui.baselineShift,
    color: ui.color,
    fauxBold: ui.fauxBold,
    fauxItalic: ui.fauxItalic,
    underline: ui.underline,
    strikethrough: ui.strikethrough,
    caps: ui.caps,
    align: ui.align,
    firstLineIndent: ui.firstLineIndent,
    spaceBefore: ui.spaceBefore,
    spaceAfter: ui.spaceAfter,
    hyphenate: ui.hyphenate,
  };
  if (ui.font) p.font = ui.font;
  if (ui.leading > 0) p.leading = ui.leading; // 0 = auto leading: omit so the engine keeps "auto"
  return p;
}
