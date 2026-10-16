// Browser client for the Admin backend's /api/workbench/* (same origin; cookies carry the
// experience-code access and the per-browser participant id). No API configuration here.
import type { AssetRecord, Capabilities, CreateTaskRequest, GenerationRecord, PublicStyle, Receipt, Step, TaskEvent, TaskSummary, WbError } from './contract';

export class WbApiError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(e: WbError, status: number) { super(e.message); this.code = e.code; this.status = status; }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { method, credentials: 'same-origin', headers: body === undefined ? {} : { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  } catch {
    throw new WbApiError({ code: 'OFFLINE', message: '本地 AI 服务未就绪' }, 0);
  }
  const json = await res.json().catch(() => undefined) as { data?: T; error?: WbError } & Record<string, unknown> | undefined;
  if (!json) throw new WbApiError({ code: 'OFFLINE', message: `本地 AI 服务没有响应（HTTP ${res.status}）` }, res.status);
  if (!res.ok) throw new WbApiError(json.error ?? { code: 'ERROR', message: `请求失败（HTTP ${res.status}）` }, res.status);
  return (json.data ?? json) as T;
}

const t = (id: string) => `/api/workbench/tasks/${encodeURIComponent(id)}`;

export const wbApi = {
  capabilities: () => call<Capabilities>('GET', '/api/workbench/capabilities'),
  session: () => call<{ participant: boolean; quota: { used: number; limit: number; remaining: number; exhausted: boolean; expiresAt?: string | null } }>('GET', '/api/workbench/session'),
  /** Experience code (same endpoint AIStyle uses); sets the access cookie. */
  verifyCode: (code: string) => call<{ valid: boolean; message: string }>('POST', '/api/access/upgrade', { code }),

  createTask: (req: CreateTaskRequest) => call<TaskSummary>('POST', '/api/workbench/tasks', req),
  task: (id: string) => call<TaskSummary>('GET', t(id)),
  events: (id: string, after: number) => call<{ events: TaskEvent[]; lastSeq: number; state: TaskSummary['state'] }>('GET', `${t(id)}/events?after=${after}`),
  claim: (id: string, who: { clientSessionId: string; docId: string }) => call<{ step: Step | null; observedRevision: number; state: TaskSummary['state'] }>('POST', `${t(id)}/claim-step`, who),
  submit: (id: string, r: Receipt) => call<TaskSummary>('POST', `${t(id)}/tool-results`, r),
  confirm: (id: string, body: { stepId: string; inputDigest: string; approve: boolean }) => call<TaskSummary>('POST', `${t(id)}/confirm`, body),
  pause: (id: string) => call<TaskSummary>('POST', `${t(id)}/pause`, {}),
  cancel: (id: string) => call<TaskSummary>('POST', `${t(id)}/cancel`, {}),
  resume: (id: string, body: { retryUncertain?: boolean; observedRevision?: number }) => call<TaskSummary>('POST', `${t(id)}/resume`, body),
  feedback: (id: string, body: { requestId: string; prompt: string; observedRevision: number; model?: string }) => call<TaskSummary>('POST', `${t(id)}/feedback`, body),

  assets: () => call<AssetRecord[]>('GET', '/api/workbench/assets'),
  uploadAsset: (dataUrl: string, name: string, source?: { siteId: string; url: string }) => call<AssetRecord>('POST', '/api/workbench/assets', { dataUrl, name, ...(source ? { source } : {}) }),
  deleteAsset: (id: string) => call<{ deleted: boolean }>('DELETE', `/api/workbench/assets/${encodeURIComponent(id)}`),
  importUrl: (siteId: string, url: string) => call<{ asset?: AssetRecord; svg?: string; source?: { url: string } }>('POST', '/api/workbench/assets/import-url', { siteId, url }),
  async assetBlob(id: string): Promise<Blob> {
    const res = await fetch(`/api/workbench/assets/${encodeURIComponent(id)}/content`, { credentials: 'same-origin' });
    if (!res.ok) throw new WbApiError({ code: 'NOT_FOUND', message: '素材读取失败' }, res.status);
    return res.blob();
  },
  generate: (req: { requestId: string; prompt: string; styleId?: number; referenceAssetIds?: string[]; size?: string; model?: string; aspectRatio?: string; imageSize?: string; name?: string }) => call<GenerationRecord>('POST', '/api/workbench/generations', req),
  /** AIStyle's public style list (covers, names) from the same backend. */
  styles: () => call<{ styles: PublicStyle[] }>('GET', '/api/styles'),
};
