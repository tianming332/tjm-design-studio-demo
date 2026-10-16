// Promise client for the engine worker, plus a tjm/0 envelope builder.
export interface Reply<T = any> { ok: boolean; data: T; error?: string; ms: number; wasmBytes: number }

export class EngineClient {
  private worker: Worker;
  private next = 1;
  private pending = new Map<number, { resolve: (r: Reply) => void; timer: ReturnType<typeof setTimeout> }>();
  peakWasmBytes = 0;

  constructor(private timeoutMs = 5 * 60_000) {
    this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (ev: MessageEvent<Reply & { id: number }>) => {
      const p = this.pending.get(ev.data.id);
      if (!p) return;
      clearTimeout(p.timer);
      this.pending.delete(ev.data.id);
      this.peakWasmBytes = Math.max(this.peakWasmBytes, ev.data.wasmBytes ?? 0);
      p.resolve(ev.data);
    };
  }

  private call<T>(msg: Record<string, unknown>, transfer: Transferable[] = []): Promise<Reply<T>> {
    const id = this.next++;
    return new Promise((resolve) => {
      const timer = setTimeout(() => { this.pending.delete(id); resolve({ ok: false, data: undefined as T, error: `timeout after ${this.timeoutMs} ms`, ms: this.timeoutMs, wasmBytes: 0 }); }, this.timeoutMs);
      this.pending.set(id, { resolve, timer });
      this.worker.postMessage({ id, ...msg }, transfer);
    });
  }

  open(name: string, bytes: ArrayBuffer) { return this.call<any>({ op: 'open', name, bytes }, [bytes]); }
  request(envelope: object) { return this.call<any>({ op: 'request', envelope: JSON.stringify(envelope) }); }
  render(docId: string, maxSide = 1024) { return this.call<{ width: number; height: number; pixels: ArrayBuffer }>({ op: 'render', docId, maxSide }); }
  /** Live transform preview: the layer alone, or the document without it. */
  renderLayerSplit(docId: string, layer: number, alone: boolean, x: number, y: number, w: number, h: number) {
    return this.call<{ width: number; height: number; pixels: ArrayBuffer }>({ op: 'renderLayerSplit', docId, layer, alone, x, y, w, h });
  }
  renderRegion(docId: string, x: number, y: number, w: number, h: number) { return this.call<{ width: number; height: number; pixels: ArrayBuffer }>({ op: 'renderRegion', docId, x, y, w, h }); }
  initGpu() { return this.call<{ ok: boolean; error?: string }>({ op: 'initGpu' }); }
  renderGpu(docId: string, x = 0, y = 0, w = 0, h = 0) { return this.call<{ width: number; height: number; pixels: ArrayBuffer; ok: boolean }>({ op: 'renderGpu', docId, x, y, w, h }); }
  save(docId: string, format = 'psd') { return this.call<{ info: any; bytes: ArrayBuffer }>({ op: 'save', docId, format }); }
  selectionMask(docId: string) { return this.call<{ bytes: ArrayBuffer }>({ op: 'selectionMask', docId }); }
  addFont(bytes: ArrayBuffer) { return this.call<any>({ op: 'addFont', bytes }, [bytes]); }
  close(docId: string) { return this.call<any>({ op: 'close', docId }); }
  stats() { return this.call<any>({ op: 'stats' }); }
  reset() { return this.call<any>({ op: 'reset' }); }
  setBudget(bytes: number) { return this.call<any>({ op: 'setBudget', bytes }); }
  terminate() { this.worker.terminate(); }
}

let counter = 0;
export function envelope(docId: string, batch: { cmd: string; params?: object }[], opts: { baseRevision?: number; idempotencyKey?: string } = {}) {
  counter += 1;
  return { protocol: 'tjm/0', requestId: `r-${Date.now().toString(36)}-${counter}`, docId, batch, ...opts };
}
