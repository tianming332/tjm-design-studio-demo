import { create } from 'zustand';
import { attachmentKind, attachmentText, contactSheet, parseAttachment, type ParsedAttachment } from '../ai/attachments';
import { wbApi } from '../ai/api';
import { useAssets } from './assets';

export interface BriefFile extends Partial<ParsedAttachment> { id: string; file: File; name: string; status: 'reading' | 'ready' | 'uploading' | 'error'; error?: string; assetId?: string; thumbnail?: string }
const MAX_FILES = 8;
async function dataURL(blob: Blob) { return new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('读取图片失败')); reader.readAsDataURL(blob); }); }
let queue = Promise.resolve();
export const useBriefAttachments = create<{
  files: BriefFile[]; error?: string; preparing: boolean;
  add(files: File[]): Promise<void>; remove(id: string): void; clear(): void;
  prepare(brief: string, limit: number, imageOutput: boolean, referenceId?: string): Promise<{ brief: string; referenceId?: string }>;
}>((set, get) => {
  const patch = (id: string, data: Partial<BriefFile>) => set({ files: get().files.map((f) => f.id === id ? { ...f, ...data } : f) });
  return {
    files: [], preparing: false,
    async add(files) {
      if (get().preparing) return;
      set({ error: undefined });
      for (const file of files) {
        if (get().files.length >= MAX_FILES) { set({ error: `最多添加 ${MAX_FILES} 个附件，请先移除不需要的文件。` }); break; }
        if (get().files.reduce((n, f) => n + f.file.size, 0) + file.size > 100 * 1024 * 1024) { set({ error: '附件总大小不能超过 100 MB，请减少文件后重试。' }); continue; }
        if (get().files.some((f) => f.file.name === file.name && f.file.size === file.size && f.file.lastModified === file.lastModified)) continue;
        const id = crypto.randomUUID();
        set({ files: [...get().files, { id, file, name: file.name, kind: attachmentKind(file.name), status: 'reading' }] });
        queue = queue.then(async () => {
          if (!get().files.some((f) => f.id === id)) return;
          try {
            const parsed = await parseAttachment(file);
            if (!get().files.some((f) => f.id === id)) return;
            patch(id, { ...parsed, status: 'ready', thumbnail: parsed.image ? URL.createObjectURL(parsed.image) : undefined });
          } catch (e) { patch(id, { status: 'error', error: (e as Error).message || '文件解析失败' }); }
        });
      }
      await queue;
    },
    remove(id) { if (get().preparing) return; const f = get().files.find((f) => f.id === id); if (f?.thumbnail) URL.revokeObjectURL(f.thumbnail); set({ files: get().files.filter((f) => f.id !== id), error: undefined }); },
    clear() { for (const f of get().files) if (f.thumbnail) URL.revokeObjectURL(f.thumbnail); set({ files: [], error: undefined }); },
    async prepare(brief, limit, imageOutput, referenceId) {
      if (get().preparing) throw new Error('附件正在上传，请稍候。');
      const files = get().files.map((f) => ({ ...f }));
      if (files.some((f) => f.status !== 'ready')) throw new Error('请等待附件读取完成，或移除读取失败的附件。');
      // Reserve space for uploaded IDs and contact-sheet guidance; never silently cut copy text.
      if (attachmentText(brief, files).length + files.filter((f) => f.image).length * 90 + 100 > limit) throw new Error(`需求与附件文案合计过长（接口上限 ${limit} 字），请精简需求或移除部分文案附件。`);
      set({ preparing: true, error: undefined });
      try {
        if (files.some((f) => f.assetId)) {
          const existing = new Set((await wbApi.assets()).map((a) => a.id));
          for (const f of files) if (f.assetId && !existing.has(f.assetId)) { f.assetId = undefined; patch(f.id, { assetId: undefined }); }
        }
        for (const f of files) {
          if (!f.image || f.assetId) continue;
          patch(f.id, { status: 'uploading' });
          try {
            const a = await wbApi.uploadAsset(await dataURL(f.image), f.name.replace(/\.[^.]+$/, '') + (f.kind === 'design' ? '（文档参考预览）' : ''));
            patch(f.id, { assetId: a.id, status: 'ready', error: undefined, note: `${f.note?.replace(/ · 已入素材库$/, '')} · 已入素材库` });
          } catch (e) { patch(f.id, { status: 'ready', error: '上传失败，可重试' }); throw e; }
        }
        const ready = get().files;
        let reference = referenceId;
        const images = ready.filter((f): f is BriefFile & { image: Blob } => !!f.image).map((f) => ({ image: f.image, name: f.name, assetId: f.assetId }));
        if (imageOutput && referenceId && !images.some((f) => f.assetId === referenceId)) images.push({ image: await wbApi.assetBlob(referenceId), name: '所选参考图', assetId: referenceId });
        if (imageOutput && images.length) {
          reference = images.length === 1 ? images[0].assetId : (await wbApi.uploadAsset(await dataURL(await contactSheet(images)), '需求附件参考拼图')).id;
        }
        const text = attachmentText(brief, ready) + (imageOutput && images.length > 1 ? '\n附带参考图为编号拼图，请分别参考每格素材，不要直接复制拼图边框和编号。' : '');
        if (text.length > limit) throw new Error('合并后的需求超过接口限制，请减少文案附件。');
        if (ready.some((f) => f.image)) await useAssets.getState().refresh();
        return { brief: text, referenceId: reference };
      } catch (e) { set({ error: (e as Error).message }); throw e; }
      finally { set({ preparing: false }); }
    },
  };
});
