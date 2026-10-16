// Fonts. The default CJK face (Noto Sans SC, SIL OFL 1.1 — public/fonts/NotoSansSC-LICENSE.txt)
// is given to every engine Worker before its first document opens, as before. Everything else
// comes from the font library (public/fonts/manifest.json — free-for-commercial-use fonts, each
// with its licence): fetched only when a document, the user or the agent first uses the family,
// cached by the browser, and registered in every live engine plus as a CSS FontFace so the
// on-canvas text editor matches. The engine needs no rebuild to gain fonts.
import type { EngineClient } from './client';

export const DEFAULT_FONT = 'Noto Sans SC';
/** Fonts live under the app's base path (`/` locally, `/studio/` on the Worker). */
const FONTS = `${import.meta.env?.BASE_URL ?? '/'}fonts/`;
const URL_ = `${FONTS}NotoSansSC-Regular.otf`;

export interface LibraryFont {
  family: string;
  /** Display name in the font menu. */
  label: string;
  file: string;
  script: 'zh' | 'ja' | 'en';
  /** Style words the agent picks by (黑体, 宋体, 圆体, 手写, 书法, 衬线, 展示…). */
  tags: string[];
  license: string;
  licenseFile: string;
  bytes: number;
  variable?: boolean;
}

let bytes: Promise<ArrayBuffer | undefined> | undefined;

/** Font bytes, fetched once per page (same origin, no third-party request). */
export function defaultFontBytes(): Promise<ArrayBuffer | undefined> {
  bytes ??= fetch(URL_).then((r) => (r.ok ? r.arrayBuffer() : undefined)).catch(() => undefined);
  return bytes;
}

let cssFace: Promise<void> | undefined;

/** Registers the font for HTML text (the type tool's editing box). */
export function ensureCssFont(): Promise<void> {
  cssFace ??= (async () => {
    const b = await defaultFontBytes();
    if (!b || typeof FontFace === 'undefined') return;
    const face = new FontFace(DEFAULT_FONT, b.slice(0));
    await face.load();
    document.fonts.add(face);
  })().catch(() => undefined);
  return cssFace;
}

/** Default type size for a canvas: about a twelfth of the short side, 12–200 pt. */
export function defaultTypeSize(w: number, h: number): number {
  return Math.min(200, Math.max(12, Math.round(Math.min(w, h) / 12)));
}

// --- font library --------------------------------------------------------------------------------

let manifest: Promise<LibraryFont[]> | undefined;
/** The library list (empty when the manifest is unreachable — the editor still works). */
export function fontLibrary(): Promise<LibraryFont[]> {
  manifest ??= fetch(`${FONTS}manifest.json`).then((r) => (r.ok ? r.json() : { fonts: [] })).then((m) => m.fonts as LibraryFont[]).catch(() => []);
  return manifest;
}

const clients = new Set<EngineClient>();
const loaded = new Map<string, Promise<ArrayBuffer | undefined>>();
const norm = (f: string) => f.trim().toLowerCase();

/** A new engine Worker: it gets every library font already in use on this page. */
export async function registerClient(client: EngineClient) {
  clients.add(client);
  for (const p of loaded.values()) { const b = await p; if (b) await client.addFont(b.slice(0)).catch(() => undefined); }
}
export const unregisterClient = (client: EngineClient) => { clients.delete(client); };

/** Library entry for a family name (case-insensitive), if the library has it. */
export async function libraryFont(family: string): Promise<LibraryFont | undefined> {
  const n = norm(family);
  return (await fontLibrary()).find((f) => norm(f.family) === n);
}

/**
 * Makes `family` usable: no-op for the default face; for library fonts, fetches once and
 * registers in every engine and in CSS. Returns false when the library does not have it.
 */
export async function ensureFont(family: string): Promise<boolean> {
  if (!family || norm(family) === norm(DEFAULT_FONT)) return true;
  const entry = await libraryFont(family);
  if (!entry) return false;
  const key = norm(entry.family);
  if (!loaded.has(key)) {
    const p = (async () => {
      const r = await fetch(`${FONTS}${entry.file}`);
      if (!r.ok) return undefined;
      const b = await r.arrayBuffer();
      await Promise.all([...clients].map((c) => c.addFont(b.slice(0)).catch(() => undefined)));
      if (typeof FontFace !== 'undefined') {
        const face = new FontFace(entry.family, b.slice(0));
        await face.load().then(() => document.fonts.add(face)).catch(() => undefined);
      }
      return b;
    })().catch(() => undefined);
    loaded.set(key, p);
  }
  return !!(await loaded.get(key));
}

/** Families a batch asks for (type.create / type.setStyle `font`), so they can be loaded first. */
export function batchFonts(batch: { params?: object }[]): string[] {
  const out = new Set<string>();
  for (const c of batch) { const f = (c.params as { font?: unknown } | undefined)?.font; if (typeof f === 'string' && f) out.add(f); }
  return [...out];
}
