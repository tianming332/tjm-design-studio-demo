// Colour conversions for the picker (CLR-008) and the eyedropper (CLR-009).
// Pure functions so the numeric round-trips are unit-testable; the engine reports pixels as
// 0..1 components, while the UI and every engine colour param use `#rrggbb`.

export interface Rgb { r: number; g: number; b: number } // 0..255
export interface Hsb { h: number; s: number; b: number } // h 0..360, s/b 0..100

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const byte = (v: number) => clamp(Math.round(v), 0, 255);

export function hexToRgb(hex: string): Rgb {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return { r: 0, g: 0, b: 0 };
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgbToHex({ r, g, b }: Rgb): string {
  return `#${[r, g, b].map((v) => byte(v).toString(16).padStart(2, '0')).join('')}`;
}

/** Engine pixel read-back (`[r,g,b,a]` 0..1) -> `#rrggbb`. */
export function rgb01ToHex(px: readonly number[]): string {
  const [r = 0, g = 0, b = 0] = px;
  return rgbToHex({ r: clamp(r, 0, 1) * 255, g: clamp(g, 0, 1) * 255, b: clamp(b, 0, 1) * 255 });
}

export function rgbToHsb({ r, g, b }: Rgb): Hsb {
  const rn = clamp(r, 0, 255) / 255;
  const gn = clamp(g, 0, 255) / 255;
  const bn = clamp(b, 0, 255) / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h: Math.round(h), s: Math.round((max === 0 ? 0 : d / max) * 100), b: Math.round(max * 100) };
}

export function hsbToRgb({ h, s, b }: Hsb): Rgb {
  const hn = ((h % 360) + 360) % 360;
  const sn = clamp(s, 0, 100) / 100;
  const vn = clamp(b, 0, 100) / 100;
  const c = vn * sn;
  const x = c * (1 - Math.abs(((hn / 60) % 2) - 1));
  const m = vn - c;
  const seg = Math.floor(hn / 60) % 6;
  const table: [number, number, number][] = [
    [c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x],
  ];
  const [r1, g1, b1] = table[seg];
  return { r: byte((r1 + m) * 255), g: byte((g1 + m) * 255), b: byte((b1 + m) * 255) };
}

export const hexToHsb = (hex: string): Hsb => rgbToHsb(hexToRgb(hex));
export const hsbToHex = (hsb: Hsb): string => rgbToHex(hsbToRgb(hsb));
