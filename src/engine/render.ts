// Canvas rendering for a document: GPU-first (engine wgpu Compositor) with CPU fallback,
// plus dirty-region incremental redraw. View zoom/pan is applied as a CSS transform by the caller.
import type { EngineClient } from './client';
import type { DocSession } from './session';
import type { Rect } from './protocol';

const backendOf = new WeakMap<EngineClient, 'gpu' | 'cpu'>();

// The live document canvas, registered by CanvasView so other layers can snapshot it.
let currentCanvas: HTMLCanvasElement | null = null;
export function registerCanvas(c: HTMLCanvasElement | null) { currentCanvas = c; }
export function snapshotDataUrl(): string | undefined {
  try { return currentCanvas?.toDataURL('image/png'); } catch { return undefined; }
}

/** Initialises GPU once per client; returns the chosen backend. */
export async function ensureBackend(client: EngineClient): Promise<'gpu' | 'cpu'> {
  const cached = backendOf.get(client);
  if (cached) return cached;
  let backend: 'gpu' | 'cpu' = 'cpu';
  try {
    const r = await client.initGpu();
    backend = r.ok && r.data?.ok ? 'gpu' : 'cpu';
  } catch { backend = 'cpu'; }
  backendOf.set(client, backend);
  return backend;
}

function putImage(canvas: HTMLCanvasElement, px: ArrayBuffer, w: number, h: number, at?: Rect) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const img = new ImageData(new Uint8ClampedArray(px), w, h);
  if (at) ctx.putImageData(img, at.x, at.y);
  else {
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    ctx.putImageData(img, 0, 0);
  }
}

/** Full-document redraw. Returns the backend actually used. */
export async function renderFull(session: DocSession, canvas: HTMLCanvasElement): Promise<'gpu' | 'cpu'> {
  const client = session.client;
  const backend = await ensureBackend(client);
  if (backend === 'gpu') {
    const g = await client.renderGpu(session.docId);
    if (g.ok && g.data?.pixels) { putImage(canvas, g.data.pixels, g.data.width, g.data.height); return 'gpu'; }
  }
  const c = await client.render(session.docId, 0); // 0 = natural size
  if (c.ok && c.data?.pixels) putImage(canvas, c.data.pixels, c.data.width, c.data.height);
  return 'cpu';
}

/**
 * Clips a damage rect to the canvas. The bridge clips region renders the same way and returns
 * pixels starting at the *clipped* origin, so drawing them at an unclipped negative x/y would
 * shift the patch up/left — an edit reaching past the top-left edge (big brush, smart-object
 * commit, filter) then appeared not to repaint at all. Returns null when nothing is visible.
 */
export function clipDamage(r: Rect, width: number, height: number): Rect | null {
  const x0 = Math.max(0, r.x);
  const y0 = Math.max(0, r.y);
  const x1 = Math.min(width, r.x + r.w);
  const y1 = Math.min(height, r.y + r.h);
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

/** Dirty-region redraw: repaints only the given rects (CPU region path). */
export async function renderDamage(session: DocSession, canvas: HTMLCanvasElement, rects: Rect[]): Promise<void> {
  const client = session.client;
  for (const raw of rects) {
    const r = clipDamage(raw, canvas.width, canvas.height);
    if (!r) continue;
    const out = await client.renderRegion(session.docId, r.x, r.y, r.w, r.h);
    if (out.ok && out.data?.pixels && out.data.width > 0) {
      putImage(canvas, out.data.pixels, out.data.width, out.data.height, { x: r.x, y: r.y, w: out.data.width, h: out.data.height });
    }
  }
}
