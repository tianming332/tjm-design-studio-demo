// Web Worker hosting the WASM engine. Messages: {id, op, ...} → {id, ok, data | error}.
import init, { Engine } from './pkg/tjm_engine_wasm.js';

type Msg =
  | { id: number; op: 'open'; name: string; bytes: ArrayBuffer }
  | { id: number; op: 'request'; envelope: string }
  | { id: number; op: 'render'; docId: string; maxSide: number }
  | { id: number; op: 'renderRegion'; docId: string; x: number; y: number; w: number; h: number }
  | { id: number; op: 'renderLayerSplit'; docId: string; layer: number; alone: boolean; x: number; y: number; w: number; h: number }
  | { id: number; op: 'initGpu' }
  | { id: number; op: 'renderGpu'; docId: string; x: number; y: number; w: number; h: number }
  | { id: number; op: 'save'; docId: string; format: string }
  | { id: number; op: 'selectionMask'; docId: string }
  | { id: number; op: 'addFont'; bytes: ArrayBuffer }
  | { id: number; op: 'close'; docId: string }
  | { id: number; op: 'stats' }
  | { id: number; op: 'reset' }
  | { id: number; op: 'setBudget'; bytes: number }
  | { id: number; op: 'memory' };

let engine: Engine | undefined;
let wasmMemory: WebAssembly.Memory | undefined;
const ready = init().then((exports) => { wasmMemory = (exports as unknown as { memory: WebAssembly.Memory }).memory; engine = new Engine(); });

// Serialize all engine calls: wasm-bindgen forbids re-entrant use of the Engine object,
// which happens when an async op (init_gpu/render_gpu) awaits while another message arrives.
let chain: Promise<void> = Promise.resolve();
self.onmessage = (ev: MessageEvent<Msg>) => { chain = chain.then(() => handle(ev.data)); };

async function handle(m: Msg) {
  try {
    await ready;
    const e = engine!;
    const t0 = performance.now();
    let data: unknown;
    const transfer: Transferable[] = [];
    switch (m.op) {
      case 'open': data = JSON.parse(e.open(m.name, new Uint8Array(m.bytes))); break;
      case 'request': data = JSON.parse(e.request(m.envelope)); break;
      case 'render': {
        const out = e.render_rgba(m.docId, m.maxSide);
        if (out.length < 8) throw new Error('render failed');
        const dv = new DataView(out.buffer, out.byteOffset, 8);
        const pixels = out.slice(8);
        data = { width: dv.getUint32(0, true), height: dv.getUint32(4, true), pixels: pixels.buffer };
        transfer.push(pixels.buffer);
        break;
      }
      case 'renderRegion': {
        const out = e.render_region(m.docId, m.x, m.y, m.w, m.h);
        const dv = out.length >= 8 ? new DataView(out.buffer, out.byteOffset, 8) : null;
        const pixels = out.slice(8);
        data = { width: dv ? dv.getUint32(0, true) : 0, height: dv ? dv.getUint32(4, true) : 0, pixels: pixels.buffer };
        transfer.push(pixels.buffer);
        break;
      }
      case 'renderLayerSplit': {
        const out = e.render_layer_split(m.docId, m.layer, m.alone, m.x, m.y, m.w, m.h);
        const dv = out.length >= 8 ? new DataView(out.buffer, out.byteOffset, 8) : null;
        const pixels = out.slice(8);
        data = { width: dv ? dv.getUint32(0, true) : 0, height: dv ? dv.getUint32(4, true) : 0, pixels: pixels.buffer };
        transfer.push(pixels.buffer);
        break;
      }
      case 'initGpu': data = JSON.parse(await e.init_gpu()); break;
      case 'renderGpu': {
        const out = await e.render_gpu(m.docId, m.x, m.y, m.w, m.h);
        const dv = out.length >= 8 ? new DataView(out.buffer, out.byteOffset, 8) : null;
        const pixels = out.slice(8);
        data = { width: dv ? dv.getUint32(0, true) : 0, height: dv ? dv.getUint32(4, true) : 0, pixels: pixels.buffer, ok: out.length >= 8 };
        transfer.push(pixels.buffer);
        break;
      }
      case 'save': {
        const bytes = e.save(m.docId, m.format);
        data = { info: JSON.parse(e.last_save_info()), bytes: bytes.buffer };
        transfer.push(bytes.buffer);
        break;
      }
      case 'selectionMask': {
        const bytes = e.selection_mask(m.docId);
        data = { bytes: bytes.buffer };
        transfer.push(bytes.buffer);
        break;
      }
      case 'addFont': data = JSON.parse(e.add_font(new Uint8Array(m.bytes))); break;
      case 'close': data = JSON.parse(e.close(m.docId)); break;
      case 'stats': data = JSON.parse(e.stats()); break;
      case 'reset': e.reset(); data = {}; break;
      case 'setBudget': e.set_budget(m.bytes); data = {}; break;
      case 'memory': data = { wasmBytes: wasmMemory?.buffer.byteLength ?? 0 }; break;
    }
    (self as unknown as Worker).postMessage({ id: m.id, ok: true, data, ms: performance.now() - t0, wasmBytes: wasmMemory?.buffer.byteLength ?? 0 }, transfer);
  } catch (err) {
    (self as unknown as Worker).postMessage({ id: m.id, ok: false, error: String(err), wasmBytes: wasmMemory?.buffer.byteLength ?? 0 });
  }
}
