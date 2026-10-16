// Pure brush-path helpers: point thinning while dragging, path caps, degenerate-gradient guard.
// No DOM, no engine — unit-tested.
/** A stroke sample: x, y and optional pointer pressure (0..1). */
export type Pt2 = [number, number] | [number, number, number];

/** Minimum spacing between sampled points, in document pixels (≈ a quarter of the brush size). */
export function sampleSpacing(size: number): number {
  return Math.max(1, size / 4);
}

/** Hard cap on points per stroke so a slow drag can't produce tens of thousands of samples. */
export const MAX_STROKE_POINTS = 4000;

/** Decides whether to append `p` given the last kept point and the brush spacing. */
export function shouldSample(points: Pt2[], p: Pt2, spacing: number): boolean {
  if (points.length === 0) return true;
  if (points.length >= MAX_STROKE_POINTS) return false;
  const last = points[points.length - 1];
  return Math.abs(p[0] - last[0]) >= spacing || Math.abs(p[1] - last[1]) >= spacing;
}

/** Appends a point if it clears the spacing threshold; returns the (possibly unchanged) array. */
export function addPoint(points: Pt2[], p: Pt2, size: number): Pt2[] {
  if (shouldSample(points, p, sampleSpacing(size))) points.push(p);
  return points;
}

/** A gradient drag shorter than this (document pixels) is treated as a no-op. */
export function isGradientTooShort(from: Pt2, to: Pt2, min = 2): boolean {
  return Math.hypot(to[0] - from[0], to[1] - from[1]) < min;
}
