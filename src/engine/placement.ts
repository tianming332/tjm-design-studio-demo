export type AssetRole = 'background' | 'subject' | 'decoration';
export type AssetFit = 'cover' | 'contain' | 'native';
export interface PlacementOptions {
  role?: AssetRole; fit?: AssetFit; rect?: [number, number, number, number]; centerX?: number; centerY?: number; name?: string;
}
/** Role is explicit when available. Only exact background-like names are a legacy fallback. */
export function placementRole(p: PlacementOptions): AssetRole {
  if (p.role) return p.role;
  return /^(?:ai[\s_-]*)?(?:background|bg|背景|底图)(?:$|[\s_（(.-])/i.test(p.name?.trim() ?? '') ? 'background' : 'subject';
}
export function assetPlacement(p: PlacementOptions, canvas: { width: number; height: number }, source: [number, number, number, number]) {
  const [x, y, width, height] = source;
  if (![x,y,width,height,canvas.width,canvas.height].every(Number.isFinite) || width <= 0 || height <= 0 || canvas.width <= 0 || canvas.height <= 0) throw new Error('素材或画布尺寸无效');
  const role = placementRole(p);
  const fit = p.fit ?? (role === 'background' ? 'cover' : role === 'subject' || p.rect ? 'contain' : 'native');
  const target = p.rect ?? [0, 0, canvas.width, canvas.height];
  if (!target.every(Number.isFinite) || target[2] <= 0 || target[3] <= 0) throw new Error('目标区域无效');
  const scale = fit === 'native' ? 1 : fit === 'cover'
    ? Math.max(target[2] / width, target[3] / height) : Math.min(target[2] / width, target[3] / height);
  const cx = p.centerX ?? target[0] + target[2] / 2, cy = p.centerY ?? target[1] + target[3] / 2;
  const left = cx - width * scale / 2, top = cy - height * scale / 2;
  return { role, fit, target, matrix: [scale, 0, 0, scale, left - x * scale, top - y * scale], bounds: [left, top, width * scale, height * scale], scale };
}
/** A newly generated background belongs above the immutable base background, below design layers. */
export function backgroundBaseCount(layers: { id: number; name: string; kind: string; bounds?: number[] }[], layer: number, width: number, height: number) {
  let count = 0;
  for (const l of [...layers].reverse()) {
    if (l.id === layer) continue;
    const namedBase = /^(background|背景)$/i.test(l.name);
    const fullCanvasFill = /fill|shape/i.test(l.kind) && l.bounds && coversCanvas(l.bounds, width, height);
    if ((namedBase && /pixel|fill/i.test(l.kind) && (!l.bounds || coversCanvas(l.bounds, width, height))) || fullCanvasFill) count++;
    else break;
  }
  return count;
}
export function coversCanvas(bounds: number[], width: number, height: number, tolerance = 2) {
  return bounds.length === 4 && bounds[0] <= tolerance && bounds[1] <= tolerance
    && bounds[0] + bounds[2] >= width - tolerance && bounds[1] + bounds[3] >= height - tolerance;
}
