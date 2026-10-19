// 素材 panel state: the participant's asset library (uploads, AI generations, web imports),
// the AI 素材 style generator, and the in-page internet-material browser.
import { create } from 'zustand';
import type { AssetRecord, PublicStyle, Site } from '../ai/contract';
import { wbApi } from '../ai/api';
import { useStore } from './store';
import { blobToDataUrl, rid } from './agent';
import { aiHeld, trackAIWrite, useAIControl } from './aiControl';
import { assetPlacement, backgroundBaseCount, coversCanvas, type PlacementOptions } from '../engine/placement';
import type { Batch } from '../engine/session';
import { flatten } from './store';
import { useWb } from './workbench';

const ACCEPTED = ['image/png', 'image/jpeg', 'image/webp'];

interface AssetsState {
  items: AssetRecord[];
  loading: boolean;
  error?: string;
  notice?: string;
  styles: PublicStyle[];
  generating: boolean;
  refresh(): Promise<void>;
  uploadFiles(files: File[]): Promise<void>;
  remove(id: string): Promise<void>;
  place(id: string, target?: { docId?: string; epoch?: number }, placement?: PlacementOptions): Promise<boolean>;
  loadStyles(): Promise<void>;
  generate(p: { prompt: string; styleId?: number; size: string; referenceAssetId?: string; placement?: PlacementOptions; model?: string; aspectRatio?: string; imageSize?: string; name?: string }): Promise<{ count: number; placed: boolean } | undefined>;
  importUrl(site: Site, url: string): Promise<void>;
  /** Pastes an image address: finds the registered site whose hosts match and imports it. */
  importImageUrl(url: string): Promise<void>;
  openSite(site?: Site): void;
}

/** SVG from a site is drawn through <img> (scripts never run there) and stored as PNG. */
async function rasterizeSvg(svg: string, size = 1024): Promise<string> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error('SVG 无法解析')); img.src = url; });
    const k = size / Math.max(img.naturalWidth || size, img.naturalHeight || size);
    const w = Math.max(1, Math.round((img.naturalWidth || size) * k)), h = Math.max(1, Math.round((img.naturalHeight || size) * k));
    const canvas = new OffscreenCanvas(w, h);
    canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
    return blobToDataUrl(await canvas.convertToBlob({ type: 'image/png' }));
  } finally { URL.revokeObjectURL(url); }
}

export const useAssets = create<AssetsState>((set, get) => ({
  items: [], loading: false, styles: [], generating: false,

  async refresh() {
    set({ loading: true });
    try { set({ items: await wbApi.assets(), loading: false, error: undefined }); }
    catch (e) { set({ loading: false, error: (e as Error).message }); }
  },

  async uploadFiles(files) {
    set({ error: undefined, notice: undefined });
    let ok = 0;
    for (const f of files) {
      if (!ACCEPTED.includes(f.type)) { set({ error: `${f.name}：素材库只收 PNG／JPEG／WebP` }); continue; }
      try { await wbApi.uploadAsset(await blobToDataUrl(f), f.name.replace(/\.[^.]+$/, '')); ok++; }
      catch (e) { set({ error: `${f.name}：${(e as Error).message}` }); }
    }
    if (ok) set({ notice: `已加入素材库 ${ok} 张` });
    await get().refresh();
  },

  async remove(id) {
    try { await wbApi.deleteAsset(id); await get().refresh(); }
    catch (e) { set({ error: (e as Error).message }); }
  },

  async place(id, target, placement) {
    const rec = get().items.find((a) => a.id === id);
    try {
      const blob = await wbApi.assetBlob(id);
      if (target && useStore.getState().activeDocId !== target.docId) return false;
      if (target?.epoch !== undefined && (target.epoch !== useAIControl.getState().epoch || aiHeld(target.docId))) return false;
      const ext = blob.type === 'image/jpeg' ? 'jpg' : blob.type === 'image/webp' ? 'webp' : 'png';
      const run = async () => {
        await useStore.getState().placeImage(new File([blob], `${rec?.name || id}.${ext}`, { type: blob.type }));
        const st = useStore.getState(), layer = flatten(st.layers ?? []).find((l) => l.id === st.selectedId);
        if (st.error || !placement || !st.doc || !layer?.bounds || !st.session) return;
        const p = assetPlacement(placement, st.doc, layer.bounds);
        if (target?.epoch !== undefined && target.epoch !== useAIControl.getState().epoch) return;
        const commands: Batch = [{ cmd: 'edit.transform', params: { layer: layer.id, matrix: p.matrix } }];
        if (p.role === 'background') {
          if (st.layers.at(-1)?.id !== layer.id) commands.push({ cmd: 'layer.arrange.sendToBack', params: { layer: layer.id } });
          for (let i = 0; i < backgroundBaseCount(st.layers, layer.id, st.doc.width, st.doc.height); i++) commands.push({ cmd: 'layer.arrange.bringForward', params: { layer: layer.id } });
        } else if (st.layers[0]?.id !== layer.id) commands.push({ cmd: 'layer.arrange.bringToFront', params: { layer: layer.id } });
        await st.session.request(commands);
        await st.aiAfterEdit(st.session.docId, null);
        const updated = flatten(useStore.getState().layers).find((l) => l.id === layer.id);
        if (p.role === 'background' && p.fit === 'cover' && (!updated?.bounds || !coversCanvas(updated.bounds, st.doc.width, st.doc.height))) throw new Error('背景未完整覆盖画布，请检查尺寸');
      };
      if (target?.epoch !== undefined) await trackAIWrite(run); else await run();
      return !useStore.getState().error;
    } catch (e) { set({ error: (e as Error).message }); return false; }
  },

  /** 官方画风 always come fresh from the backend 画风管理, so admin edits show up without a reload. */
  async loadStyles() {
    try { set({ styles: (await wbApi.styles()).styles }); }
    catch (e) { set({ error: (e as Error).message }); }
  },

  /** Generated images go straight into the library and onto the canvas as a new layer. */
  async generate({ prompt, styleId, size, referenceAssetId, placement, model, aspectRatio, imageSize, name }) {
    if (get().generating) return;
    const targetDoc = useStore.getState().activeDocId;
    const epoch = useAIControl.getState().epoch;
    set({ generating: true, error: undefined, notice: undefined });
    try {
      const g = await wbApi.generate({ requestId: rid('gen'), prompt, size, ...(model ? { model } : {}), ...(aspectRatio ? { aspectRatio } : {}), ...(imageSize ? { imageSize } : {}), ...(name ? { name: name.slice(0, 80) } : {}), ...(styleId ? { styleId } : {}), ...(referenceAssetId ? { referenceAssetIds: [referenceAssetId] } : {}) });
      if (g.status !== 'succeeded') { set({ generating: false, error: g.error?.message ?? `生成状态：${g.status}` }); return; }
      if (!g.assetIds.length) throw new Error('生成服务未返回图片，请稍后重试。');
      await get().refresh();
      // A user may have switched/closed the document while waiting for the model.
      // Keep the result in the library instead of silently modifying a different document.
      let placed = useStore.getState().activeDocId === targetDoc && epoch === useAIControl.getState().epoch && !aiHeld(targetDoc);
      if (placed) {
        let expectedDoc = targetDoc;
        for (const id of g.assetIds) {
          if (!await get().place(id, { docId: expectedDoc, epoch }, placement)) { placed = false; break; }
          expectedDoc = useStore.getState().activeDocId; // First result can create a new document.
        }
      }
      set({ generating: false, notice: `已生成 ${g.assetIds.length} 张，已存入素材库${placed ? '并新建图层' : '；请在素材库选择「放入画布」'}${g.sent.mock ? '（模拟模型）' : ''}` });
      return { count: g.assetIds.length, placed };
    } catch (e) { set({ generating: false, error: (e as Error).message }); }
  },

  async importUrl(site, url) {
    set({ error: undefined, notice: undefined });
    try {
      const r = await wbApi.importUrl(site.id, url);
      if (r.svg) await wbApi.uploadAsset(await rasterizeSvg(r.svg), url.split('/').pop()?.replace(/\.svg.*$/i, '') || site.name, { siteId: site.id, url });
      set({ notice: `已从「${site.name}」导入素材库（许可未知，商用前请核对原站授权）` });
      await get().refresh();
    } catch (e) { set({ error: (e as Error).message }); }
  },

  async importImageUrl(url) {
    set({ error: undefined, notice: undefined });
    const u = url.trim();
    if (!/^https:\/\/\S+/.test(u)) { set({ error: '请粘贴以 https:// 开头的图片地址' }); return; }
    const host = (() => { try { return new URL(u).hostname.toLowerCase(); } catch { return ''; } })();
    const sites = useWb.getState().caps?.sites ?? [];
    const site = sites.find((x) => (x.imageHosts ?? []).some((h) => host === h || host.endsWith(`.${h}`)));
    if (!site) { set({ error: '该图片域名未在后台登记，无法直接导入；可改为下载后拖入「我的素材」' }); return; }
    await get().importUrl(site, u);
  },
  // Bookmarks open in a real browser tab (login and right-click-save work there, unlike an iframe).
  openSite(site) { if (site) window.open(site.url, '_blank', 'noopener,noreferrer'); },
}));
