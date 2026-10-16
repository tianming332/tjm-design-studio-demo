/** Crop geometry helpers (pure, unit-tested; the engine takes `image.crop{x,y,width,height}`). */
export interface CropRect { x: number; y: number; width: number; height: number }

/** The largest rect of the given aspect ratio that fits in the canvas, centred. */
export function centeredRatioCrop(docW: number, docH: number, ratioW: number, ratioH: number): CropRect | null {
  if (docW <= 0 || docH <= 0 || ratioW <= 0 || ratioH <= 0) return null;
  const target = ratioW / ratioH;
  let width = docW;
  let height = Math.round(docW / target);
  if (height > docH) { height = docH; width = Math.round(docH * target); }
  width = Math.min(width, docW);
  height = Math.min(height, docH);
  if (width <= 0 || height <= 0) return null;
  return { x: Math.floor((docW - width) / 2), y: Math.floor((docH - height) / 2), width, height };
}

/** Clips a crop rect to the canvas. Returns null when the intersection is empty. */
export function intersectCanvas(rect: CropRect, docW: number, docH: number): CropRect | null {
  const x0 = Math.max(0, Math.round(rect.x));
  const y0 = Math.max(0, Math.round(rect.y));
  const x1 = Math.min(docW, Math.round(rect.x + rect.width));
  const y1 = Math.min(docH, Math.round(rect.y + rect.height));
  if (x1 <= x0 || y1 <= y0) return null;
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

export const RATIOS: [string, number, number][] = [
  ['1:1', 1, 1],
  ['4:3', 4, 3],
  ['3:2', 3, 2],
  ['16:9', 16, 9],
];
