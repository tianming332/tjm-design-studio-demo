/* tslint:disable */
/* eslint-disable */

export class Engine {
    free(): void;
    [Symbol.dispose](): void;
    add_font(bytes: Uint8Array): string;
    /**
     * Close a document. JSON {status, closedDocs, openedDocs, touchedDocs}: closing an Edit
     * Contents document commits it into its parent, which then shows up in `touchedDocs`.
     */
    close(doc_id: string): string;
    gpu_available(): boolean;
    /**
     * Try to bring up the GPU compositor. Returns JSON {ok, error?}. Safe to call once at startup.
     */
    init_gpu(): Promise<string>;
    last_save_info(): string;
    constructor();
    /**
     * Open bytes as `name` (extension picks the format). Returns JSON {docId, revision, warnings, document}.
     */
    open(name: string, bytes: Uint8Array): string;
    /**
     * GPU-composite a region (x,y,w,h; all 0 → full canvas) → RGBA8 with the 8-byte header.
     * Empty on any failure (query `last_save_info`-style via console); caller falls back to CPU.
     */
    render_gpu(doc_id: string, x: number, y: number, w: number, h: number): Promise<Uint8Array>;
    /**
     * Selection coverage for the marching-ants overlay: a 16-byte header
     * (x i32, y i32, w u32, h u32) plus `w * h` coverage bytes. Empty when there is no selection.
     * Isolated layer (`alone`) or document-minus-layer RGBA for the live transform preview.
     */
    render_layer_split(doc_id: string, layer: number, alone: boolean, x: number, y: number, w: number, h: number): Uint8Array;
    /**
     * RGBA8 of a document-pixel rectangle (incremental redraw), same header. Empty on error.
     */
    render_region(doc_id: string, x: number, y: number, w: number, h: number): Uint8Array;
    /**
     * RGBA8 preview with an 8-byte little-endian header (width u32, height u32). Empty on error.
     */
    render_rgba(doc_id: string, max_side: number): Uint8Array;
    /**
     * `tjm/0` envelope in, response out.
     */
    request(envelope: string): string;
    reset(): void;
    /**
     * Encoded file bytes (`psd`, `pcraft`, `png`, …). Empty on error; call `last_save_info` for details.
     */
    save(doc_id: string, format: string): Uint8Array;
    selection_mask(doc_id: string): Uint8Array;
    /**
     * Sets the open-time memory budget in bytes (0 = no limit).
     */
    set_budget(bytes: number): void;
    stats(): string;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_engine_free: (a: number, b: number) => void;
    readonly engine_add_font: (a: number, b: number, c: number) => [number, number];
    readonly engine_close: (a: number, b: number, c: number) => [number, number];
    readonly engine_gpu_available: (a: number) => number;
    readonly engine_init_gpu: (a: number) => any;
    readonly engine_last_save_info: (a: number) => [number, number];
    readonly engine_new: () => number;
    readonly engine_open: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly engine_render_gpu: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => any;
    readonly engine_render_layer_split: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => [number, number];
    readonly engine_render_region: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number];
    readonly engine_render_rgba: (a: number, b: number, c: number, d: number) => [number, number];
    readonly engine_request: (a: number, b: number, c: number) => [number, number];
    readonly engine_reset: (a: number) => void;
    readonly engine_save: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly engine_selection_mask: (a: number, b: number, c: number) => [number, number];
    readonly engine_set_budget: (a: number, b: number) => void;
    readonly engine_stats: (a: number) => [number, number];
    readonly wasm_bindgen_d39e73e53fb0403b___convert__closures_____invoke___js_sys_3b325ea0c66951b3___Function_fn_wasm_bindgen_d39e73e53fb0403b___JsValue_____wasm_bindgen_d39e73e53fb0403b___sys__Undefined___js_sys_3b325ea0c66951b3___Function_fn_wasm_bindgen_d39e73e53fb0403b___JsValue_____wasm_bindgen_d39e73e53fb0403b___sys__Undefined_______true_: (a: number, b: number, c: any, d: any) => void;
    readonly wasm_bindgen_d39e73e53fb0403b___convert__closures_____invoke___wasm_bindgen_d39e73e53fb0403b___JsValue__core_608f92abc48d28da___result__Result_____wasm_bindgen_d39e73e53fb0403b___JsError___true_: (a: number, b: number, c: any) => [number, number];
    readonly wasm_bindgen_d39e73e53fb0403b___convert__closures_____invoke___wasm_bindgen_d39e73e53fb0403b___sys__JsNullable_wgpu_c76cc0e3f2e8b911___backend__webgpu__webgpu_sys__gen_GpuError__GpuError___core_608f92abc48d28da___result__Result_____wasm_bindgen_d39e73e53fb0403b___JsError___true_: (a: number, b: number, c: any) => [number, number];
    readonly wasm_bindgen_d39e73e53fb0403b___convert__closures_____invoke___wasm_bindgen_d39e73e53fb0403b___sys__JsNullable_wgpu_c76cc0e3f2e8b911___backend__webgpu__webgpu_sys__gen_GpuError__GpuError___core_608f92abc48d28da___result__Result_____wasm_bindgen_d39e73e53fb0403b___JsError___true__20: (a: number, b: number, c: any) => [number, number];
    readonly wasm_bindgen_d39e73e53fb0403b___convert__closures_____invoke___wasm_bindgen_d39e73e53fb0403b___sys__JsNullable_wgpu_c76cc0e3f2e8b911___backend__webgpu__webgpu_sys__gen_GpuError__GpuError___core_608f92abc48d28da___result__Result_____wasm_bindgen_d39e73e53fb0403b___JsError___true__21: (a: number, b: number, c: any) => [number, number];
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_destroy_closure: (a: number, b: number) => void;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
