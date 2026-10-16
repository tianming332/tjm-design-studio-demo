//! wasm-bindgen surface. Everything crosses as JSON strings or byte arrays; errors come back as
//! `{"status":"error","error":{…}}` JSON, never as JS exceptions.

use serde_json::{Value, json};
use wasm_bindgen::prelude::*;

use crate::core::{Core, ProtoError};
use crate::gpu::Gpu;

/// (w, h, pixels) → 8-byte LE header (width, height) + RGBA; empty vec on error.
fn pack(r: Result<(u32, u32, Vec<u8>), ProtoError>) -> Vec<u8> {
    match r {
        Ok((w, h, px)) => {
            let mut out = Vec::with_capacity(8 + px.len());
            out.extend_from_slice(&w.to_le_bytes());
            out.extend_from_slice(&h.to_le_bytes());
            out.extend_from_slice(&px);
            out
        }
        Err(_) => Vec::new(),
    }
}

fn err(e: &ProtoError) -> String {
    json!({ "status": "error", "error": { "code": e.code, "message": e.message, "at": e.at } }).to_string()
}

#[wasm_bindgen]
pub struct Engine {
    core: Core,
    last: Value,
    gpu: Option<Gpu>,
}

#[wasm_bindgen]
impl Engine {
    #[allow(clippy::new_without_default)]
    #[wasm_bindgen(constructor)]
    pub fn new() -> Engine {
        Engine { core: Core::new(), last: Value::Null, gpu: None }
    }

    /// Try to bring up the GPU compositor. Returns JSON {ok, error?}. Safe to call once at startup.
    pub async fn init_gpu(&mut self) -> String {
        if self.gpu.is_some() {
            return json!({ "ok": true, "alreadyInitialized": true }).to_string();
        }
        match Gpu::init().await {
            Ok(g) => { self.gpu = Some(g); json!({ "ok": true }).to_string() }
            Err(e) => json!({ "ok": false, "error": e }).to_string(),
        }
    }

    pub fn gpu_available(&self) -> bool {
        self.gpu.is_some()
    }

    /// GPU-composite a region (x,y,w,h; all 0 → full canvas) → RGBA8 with the 8-byte header.
    /// Empty on any failure (query `last_save_info`-style via console); caller falls back to CPU.
    pub async fn render_gpu(&mut self, doc_id: &str, x: i32, y: i32, w: u32, h: u32) -> Vec<u8> {
        let Some(gpu) = self.gpu.as_mut() else { return Vec::new() };
        let region = if w == 0 && h == 0 { None } else { Some((x, y, w, h)) };
        let (doc, rect) = match self.core.doc_and_rect(doc_id, region) {
            Ok(v) => v,
            Err(_) => return Vec::new(),
        };
        if gpu.supports(doc).is_err() {
            return Vec::new();
        }
        match gpu.render(doc, rect).await {
            Ok((rw, rh, px)) => {
                let mut out = Vec::with_capacity(8 + px.len());
                out.extend_from_slice(&rw.to_le_bytes());
                out.extend_from_slice(&rh.to_le_bytes());
                out.extend_from_slice(&px);
                out
            }
            Err(_) => Vec::new(),
        }
    }

    /// Open bytes as `name` (extension picks the format). Returns JSON {docId, revision, warnings, document}.
    pub fn open(&mut self, name: &str, bytes: &[u8]) -> String {
        match self.core.open(name, bytes) {
            Ok(v) => json!({ "status": "ok", "result": v }).to_string(),
            Err(e) => err(&e),
        }
    }

    /// `tjm/0` envelope in, response out.
    pub fn request(&mut self, envelope: &str) -> String {
        self.core.request(envelope)
    }

    /// RGBA8 preview with an 8-byte little-endian header (width u32, height u32). Empty on error.
    pub fn render_rgba(&mut self, doc_id: &str, max_side: u32) -> Vec<u8> {
        pack(self.core.render_rgba(doc_id, max_side))
    }

    /// RGBA8 of a document-pixel rectangle (incremental redraw), same header. Empty on error.
    pub fn render_region(&mut self, doc_id: &str, x: i32, y: i32, w: u32, h: u32) -> Vec<u8> {
        pack(self.core.render_region(doc_id, x, y, w, h))
    }

    /// Selection coverage for the marching-ants overlay: a 16-byte header
    /// (x i32, y i32, w u32, h u32) plus `w * h` coverage bytes. Empty when there is no selection.
    /// Isolated layer (`alone`) or document-minus-layer RGBA for the live transform preview.
    pub fn render_layer_split(&mut self, doc_id: &str, layer: f64, alone: bool, x: i32, y: i32, w: u32, h: u32) -> Vec<u8> {
        pack(self.core.render_layer_split(doc_id, layer as u64, alone, x, y, w, h))
    }

    pub fn selection_mask(&mut self, doc_id: &str) -> Vec<u8> {
        self.core.selection_mask(doc_id).unwrap_or_default()
    }

    pub fn stats(&self) -> String {
        self.core.stats().to_string()
    }

    pub fn reset(&mut self) {
        self.core.reset();
    }

    /// Sets the open-time memory budget in bytes (0 = no limit).
    pub fn set_budget(&mut self, bytes: f64) {
        self.core.budget_bytes = bytes.max(0.0) as u64;
    }

    /// Encoded file bytes (`psd`, `pcraft`, `png`, …). Empty on error; call `last_save_info` for details.
    pub fn save(&mut self, doc_id: &str, format: &str) -> Vec<u8> {
        match self.core.save(doc_id, format) {
            Ok((bytes, warnings)) => {
                self.last = json!({ "status": "ok", "bytes": bytes.len(), "warnings": warnings });
                bytes
            }
            Err(e) => {
                self.last = serde_json::from_str(&err(&e)).unwrap_or(Value::Null);
                Vec::new()
            }
        }
    }

    pub fn last_save_info(&self) -> String {
        self.last.to_string()
    }

    pub fn add_font(&mut self, bytes: Vec<u8>) -> String {
        self.core.add_font(bytes).to_string()
    }

    /// Close a document. JSON {status, closedDocs, openedDocs, touchedDocs}: closing an Edit
    /// Contents document commits it into its parent, which then shows up in `touchedDocs`.
    pub fn close(&mut self, doc_id: &str) -> String {
        match self.core.close(doc_id) {
            Ok(v) => {
                let mut out = v;
                out["status"] = json!("ok");
                out.to_string()
            }
            Err(e) => err(&e),
        }
    }
}
