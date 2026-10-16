//! Platform-neutral core of the TJM engine bridge: documents, the `tjm/0` JSON protocol
//! (revisions, atomic batches, idempotency) and byte-level open/save/render.
//! Built on PhotoCraft (MIT OR Apache-2.0); open/save mirror `photocraft-automation::files`
//! (which cannot target wasm32 because it pulls tokio/rmcp/cap-std).

use std::collections::{HashMap, VecDeque};
use std::sync::{OnceLock, PoisonError};

use photocraft_doc::{Document, LayerContent};
use photocraft_engine::{EngineError, Session, command_specs};
use photocraft_io::ExportOptions;
use serde_json::{Value, json};

use crate::schema;

pub const PROTOCOL: &str = "tjm/0";
const IDEMPOTENCY_CAPACITY: usize = 256;
/// Read-only protocol commands handled by the bridge itself; they never bump the revision.
const READ_ONLY: &[&str] = &["doc.inspect", "engine.commands", "doc.revision"];

#[derive(Debug, Clone, PartialEq)]
pub struct ProtoError {
    pub code: &'static str,
    pub message: String,
    pub at: Option<usize>,
}

impl ProtoError {
    fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self { code, message: message.into(), at: None }
    }
}

/// Parsed params docs of every registered command (built once).
pub fn param_fields() -> &'static HashMap<&'static str, Vec<schema::Field>> {
    static FIELDS: OnceLock<HashMap<&'static str, Vec<schema::Field>>> = OnceLock::new();
    FIELDS.get_or_init(|| command_specs().iter().map(|c| (c.id, schema::parse(c.params))).collect())
}

fn engine_code(e: &EngineError) -> &'static str {
    match e {
        EngineError::UnknownCommand(_) => "UNKNOWN_COMMAND",
        EngineError::Disabled(..) => "COMMAND_DISABLED",
        EngineError::BadParams { .. } => "INVALID_PARAMS",
        EngineError::NoDocument => "NO_DOCUMENT",
        EngineError::NoLayer(_) => "NO_LAYER",
        _ => "ENGINE_ERROR",
    }
}

/// One open document as the protocol sees it.
struct DocEntry {
    /// PhotoCraft's own document id (stable while the document is open).
    engine_id: u64,
    revision: u64,
    /// Estimated resident bytes after decoding (budget accounting).
    est_bytes: u64,
}

pub struct Core {
    pub session: Session,
    docs: HashMap<String, DocEntry>,
    next_doc: u64,
    seen: VecDeque<(String, String)>,
    /// Reject an open whose estimate would push total estimated bytes past this (0 = no limit).
    pub budget_bytes: u64,
}

impl Default for Core {
    fn default() -> Self {
        Self::new()
    }
}

impl Core {
    pub fn new() -> Self {
        // 2.5 GiB leaves headroom under the wasm32 4 GiB ceiling for one large document plus overhead.
        Self { session: Session::new(), docs: HashMap::new(), next_doc: 1, seen: VecDeque::new(), budget_bytes: 2_684_354_560 }
    }

    fn total_estimate(&self) -> u64 {
        self.docs.values().map(|d| d.est_bytes).sum()
    }

    fn index_of(&self, doc_id: &str) -> Result<usize, ProtoError> {
        let entry = self.docs.get(doc_id).ok_or_else(|| ProtoError::new("NO_DOCUMENT", format!("unknown docId `{doc_id}`")))?;
        self.session
            .documents()
            .iter()
            .position(|d| d.doc.id.0 == entry.engine_id)
            .ok_or_else(|| ProtoError::new("NO_DOCUMENT", format!("document `{doc_id}` is no longer open")))
    }

    fn activate(&mut self, doc_id: &str) -> Result<usize, ProtoError> {
        let i = self.index_of(doc_id)?;
        self.session.set_active(i);
        Ok(i)
    }

    pub fn revision(&self, doc_id: &str) -> Option<u64> {
        self.docs.get(doc_id).map(|d| d.revision)
    }

    /// Open a document from bytes (PSD, PSB, .pcraft, PNG, …).
    pub fn open(&mut self, name: &str, bytes: &[u8]) -> Result<Value, ProtoError> {
        // Budget guard: estimate decoded footprint from the header before decoding anything large.
        let est = estimate_open_bytes(bytes).unwrap_or((bytes.len() as u64).saturating_mul(8));
        if self.budget_bytes > 0 && self.total_estimate().saturating_add(est) > self.budget_bytes {
            return Err(ProtoError {
                code: "OVER_BUDGET",
                message: format!("opening would need ~{} MB; budget is {} MB with {} MB already open", est >> 20, self.budget_bytes >> 20, self.total_estimate() >> 20),
                at: None,
            });
        }
        let (document, warnings) = if name.to_ascii_lowercase().ends_with(&format!(".{}", photocraft_format::EXTENSION)) {
            (photocraft_format::load_from_bytes(bytes).map_err(|e| ProtoError::new("OPEN_FAILED", e.to_string()))?, Vec::new())
        } else {
            let r = photocraft_io::import(name, bytes).map_err(|e| ProtoError::new("OPEN_FAILED", e.to_string()))?;
            (r.document, r.warnings)
        };
        let index = self.session.add_document(document, Some(name.to_string()));
        let engine_id = self.session.documents().get(index).map(|d| d.doc.id.0).ok_or_else(|| ProtoError::new("ENGINE_ERROR", "document vanished after open"))?;
        let doc_id = format!("d{}", self.next_doc);
        self.next_doc += 1;
        self.docs.insert(doc_id.clone(), DocEntry { engine_id, revision: 0, est_bytes: est });
        let mut warnings = warnings;
        let linked = self.linked_smart_objects(&doc_id);
        if !linked.is_empty() {
            warnings.push(format!(
                "{} 个链接智能对象的源文件不在工程内，当前显示的是嵌入的缓存预览；重新链接需要你提供源文件。",
                linked.len()
            ));
        }
        let inspect = self.inspect(&doc_id)?;
        Ok(json!({ "docId": doc_id, "revision": 0, "estimatedBytes": est, "warnings": warnings, "linkedSmartObjects": linked, "document": inspect }))
    }

    /// Linked (external) smart-object layers: they rely on the embedded cache in the browser,
    /// where the linked path can never resolve (plan §6.3).
    fn linked_smart_objects(&self, doc_id: &str) -> Vec<Value> {
        let Ok(i) = self.index_of(doc_id) else { return Vec::new() };
        let Some(st) = self.session.documents().get(i) else { return Vec::new() };
        let mut out = Vec::new();
        for (_, _, l) in st.doc.walk() {
            if let photocraft_doc::LayerContent::Smart(so) = &l.content
                && let photocraft_doc::SmartSource::Linked { path } = &so.source
            {
                out.push(json!({ "layer": l.id.0, "name": l.name, "path": path, "hasCachedPreview": so.cache.is_some() }));
            }
        }
        out
    }

    pub fn inspect(&self, doc_id: &str) -> Result<Value, ProtoError> {
        let i = self.index_of(doc_id)?;
        let st = self.session.documents().get(i).ok_or_else(|| ProtoError::new("NO_DOCUMENT", "gone"))?;
        let mut v = photocraft_engine::inspect::document(st);
        // The engine's layer JSON omits lock flags; the Layers panel needs them to show (and
        // toggle) lock state, so add a `locks` object to every node by layer id.
        let locks: HashMap<u64, photocraft_doc::Locks> = st.doc.walk().into_iter().map(|(_, _, l)| (l.id.0, l.locks)).collect();
        if let Some(layers) = v.get_mut("layers") {
            add_locks(layers, &locks);
        }
        Ok(v)
    }

    /// Close a document. Closing an Edit Contents document commits it into its parent smart
    /// object (engine behaviour), so the reply reports every other document that changed.
    pub fn close(&mut self, doc_id: &str) -> Result<Value, ProtoError> {
        let i = self.index_of(doc_id)?;
        let snapshot = self.engine_revisions();
        self.session.close(i);
        self.docs.remove(doc_id);
        let (opened, mut closed, touched) = self.reconcile(None, &snapshot);
        // The closed document itself was unregistered above, so reconcile cannot see it.
        closed.insert(0, json!(doc_id));
        Ok(json!({ "closedDocs": closed, "openedDocs": opened, "touchedDocs": touched }))
    }

    /// Engine document id -> engine revision, for every open document.
    fn engine_revisions(&self) -> HashMap<u64, u64> {
        self.session.documents().iter().map(|d| (d.doc.id.0, d.revision)).collect()
    }

    /// Brings the docId registry in line with the engine after commands that open or close
    /// documents (Edit Contents, closing a contents document, New from clipboard, …):
    /// registers new engine documents, drops vanished ones, and bumps the protocol revision of
    /// every *other* registered document whose engine revision moved (e.g. a parent updated by a
    /// smart-object commit). `target` (already accounted for by the caller) is skipped.
    fn reconcile(&mut self, target: Option<&str>, snapshot: &HashMap<u64, u64>) -> (Vec<Value>, Vec<Value>, Vec<Value>) {
        let live: HashMap<u64, u64> = self.engine_revisions();
        let mut closed = Vec::new();
        self.docs.retain(|id, e| {
            let keep = live.contains_key(&e.engine_id);
            if !keep {
                closed.push(json!(id));
            }
            keep
        });
        let mut touched = Vec::new();
        for (id, e) in self.docs.iter_mut() {
            if Some(id.as_str()) == target {
                continue;
            }
            if let (Some(now), Some(was)) = (live.get(&e.engine_id), snapshot.get(&e.engine_id))
                && now != was
            {
                e.revision = e.revision.saturating_add(1);
                touched.push(json!({ "docId": id, "revision": e.revision }));
            }
        }
        let known: Vec<u64> = self.docs.values().map(|e| e.engine_id).collect();
        let mut opened = Vec::new();
        let fresh: Vec<(u64, String, u32, u32, u64)> = self
            .session
            .documents()
            .iter()
            .filter(|d| !known.contains(&d.doc.id.0))
            .map(|d| {
                let (w, h) = (d.doc.size.width, d.doc.size.height);
                let layers = d.doc.walk().len() as u64;
                let est = (w as u64).saturating_mul(h as u64).saturating_mul(16).saturating_mul(layers.saturating_add(1));
                (d.doc.id.0, d.doc.name.clone(), w, h, est)
            })
            .collect();
        for (engine_id, name, w, h, est) in fresh {
            let doc_id = format!("d{}", self.next_doc);
            self.next_doc += 1;
            self.docs.insert(doc_id.clone(), DocEntry { engine_id, revision: 0, est_bytes: est });
            opened.push(json!({ "docId": doc_id, "name": name, "width": w, "height": h }));
        }
        (opened, closed, touched)
    }

    /// Undo a failed batch: drop documents it opened, restore the target document, re-activate it.
    fn rollback(&mut self, target_engine: u64, before: photocraft_engine::DocState, snapshot: &HashMap<u64, u64>) {
        let mut i = self.session.documents().len();
        while i > 0 {
            i -= 1;
            let is_new = self.session.documents().get(i).is_some_and(|d| !snapshot.contains_key(&d.doc.id.0));
            if is_new {
                self.session.close(i);
            }
        }
        if let Some(pos) = self.session.documents().iter().position(|d| d.doc.id.0 == target_engine) {
            self.session.set_active(pos);
            if let Some(st) = self.session.active_mut() {
                *st = before;
            }
        }
    }

    /// Close every document and clear the idempotency cache (frees within wasm memory, which the
    /// runtime does not return to the OS; pair with terminating the Worker to reclaim it).
    pub fn reset(&mut self) {
        while let Some(st) = self.session.active_index() {
            self.session.close(st);
        }
        self.docs.clear();
        self.seen.clear();
    }

    pub fn stats(&self) -> Value {
        json!({
            "openDocuments": self.docs.len(),
            "estimatedBytesTotal": self.total_estimate(),
            "budgetBytes": self.budget_bytes,
            "documents": self.docs.iter().map(|(id, d)| json!({ "docId": id, "revision": d.revision, "estimatedBytes": d.est_bytes })).collect::<Vec<_>>(),
        })
    }

    fn doc(&self, doc_id: &str) -> Result<&Document, ProtoError> {
        let i = self.index_of(doc_id)?;
        self.session.documents().get(i).map(|d| d.doc.as_ref()).ok_or_else(|| ProtoError::new("NO_DOCUMENT", "gone"))
    }

    /// Public document accessor plus the clamped render rectangle (for the GPU path in `wasm`).
    pub fn doc_and_rect(&self, doc_id: &str, region: Option<(i32, i32, u32, u32)>) -> Result<(&Document, photocraft_geom::Rect), ProtoError> {
        let doc = self.doc(doc_id)?;
        let canvas = photocraft_geom::Rect::from_size(doc.size);
        let rect = match region {
            Some((x, y, w, h)) => clip_rect(photocraft_geom::Rect::from_xywh(x, y, w, h), canvas),
            None => canvas,
        };
        Ok((doc, rect))
    }

    /// Encode the document: `psd`, `psb`, `pcraft`, `png`, `jpg`, `webp`, `tif`, …
    pub fn save(&self, doc_id: &str, format: &str) -> Result<(Vec<u8>, Vec<String>), ProtoError> {
        let doc = self.doc(doc_id)?;
        let ext = format.trim_start_matches('.').to_ascii_lowercase();
        if ext == photocraft_format::EXTENSION {
            let previews = photocraft_format::SaveOptions {
                thumbnail: Some(photocraft_compose::thumbnail(doc, 256)),
                composite: Some(photocraft_compose::thumbnail(doc, 1024)),
            };
            let bytes = photocraft_format::save_to_bytes(doc, &previews).map_err(|e| ProtoError::new("SAVE_FAILED", e.to_string()))?;
            return Ok((bytes, Vec::new()));
        }
        let r = photocraft_io::export(doc, &ext, &ExportOptions::default()).map_err(|e| ProtoError::new("SAVE_FAILED", e.to_string()))?;
        if ext == "psd" || ext == "psb" {
            return Ok((self.with_extra_resources(doc_id, doc, r.bytes), r.warnings));
        }
        Ok((r.bytes, r.warnings))
    }

    /// Adds the thumbnail resource (1036) PhotoCraft does not write.
    fn with_extra_resources(&self, doc_id: &str, doc: &Document, bytes: Vec<u8>) -> Vec<u8> {
        let mut add = Vec::new();
        let thumb = photocraft_compose::thumbnail(doc, 160);
        if let Ok(img) = photocraft_codecs::Image::from_u8(thumb.width, thumb.height, photocraft_codecs::ChannelLayout::Rgba, thumb.pixels) {
            let opts = photocraft_codecs::EncodeOptions { jpeg_quality: 80, ..Default::default() };
            if let Ok(jpeg) = photocraft_codecs::encode(&img, photocraft_codecs::Format::Jpeg, &opts) {
                add.push((1036u16, crate::psd_post::thumbnail_resource(thumb.width, thumb.height, &jpeg)));
            }
        }
        // 1024 (target layer) is not added: its index counts Photoshop's group-divider records,
        // which only the writer knows; a wrong index would target the wrong layer.
        let _ = doc_id;
        crate::psd_post::add_missing_resources(&bytes, &add).unwrap_or(bytes)
    }

    /// Flattened RGBA8, longest side ≤ `max_side` (0 = full size). Returns (width, height, pixels).
    pub fn render_rgba(&self, doc_id: &str, max_side: u32) -> Result<(u32, u32, Vec<u8>), ProtoError> {
        let doc = self.doc(doc_id)?;
        let side = if max_side == 0 { doc.size.width.max(doc.size.height) } else { max_side };
        let img = photocraft_compose::thumbnail(doc, side.max(1));
        Ok((img.width, img.height, img.pixels))
    }

    /// Composite only a document-pixel rectangle at 1:1 (for incremental redraw of a damaged area).
    /// Returns (width, height, pixels) clipped to the canvas.
    pub fn render_region(&self, doc_id: &str, x: i32, y: i32, w: u32, h: u32) -> Result<(u32, u32, Vec<u8>), ProtoError> {
        let doc = self.doc(doc_id)?;
        let canvas = photocraft_geom::Rect::from_size(doc.size);
        let rect = clip_rect(photocraft_geom::Rect::from_xywh(x, y, w, h), canvas);
        if rect.width() == 0 || rect.height() == 0 {
            return Ok((0, 0, Vec::new()));
        }
        let img = photocraft_compose::render_reduced_rect(doc, rect, rect.width(), rect.height()).to_rgba8();
        Ok((img.width, img.height, img.pixels))
    }

    /// Live free-transform preview: `alone = true` renders only `layer` (its effects included);
    /// `alone = false` renders the document with that layer hidden (what lies underneath).
    /// The front end warps the first over the second while the user drags handles.
    pub fn render_layer_split(&self, doc_id: &str, layer: u64, alone: bool, x: i32, y: i32, w: u32, h: u32) -> Result<(u32, u32, Vec<u8>), ProtoError> {
        let doc = self.doc(doc_id)?;
        let canvas = photocraft_geom::Rect::from_size(doc.size);
        let rect = clip_rect(photocraft_geom::Rect::from_xywh(x, y, w, h), canvas);
        if rect.width() == 0 || rect.height() == 0 {
            return Ok((0, 0, Vec::new()));
        }
        let tmp = if alone {
            let mut l = doc
                .walk()
                .into_iter()
                .find(|(_, _, l)| l.id.0 == layer)
                .map(|(_, _, l)| l.clone())
                .ok_or_else(|| ProtoError::new("NO_LAYER", format!("layer {layer} not found")))?;
            l.visible = true;
            l.clipped = false;
            let mut d = Document::new(doc.name.clone(), doc.size, doc.mode, doc.depth);
            d.layers.push(l);
            d
        } else {
            let mut d = doc.clone();
            hide_layer(&mut d.layers, layer);
            d
        };
        let img = photocraft_compose::render_reduced_rect(&tmp, rect, rect.width(), rect.height()).to_rgba8();
        Ok((img.width, img.height, img.pixels))
    }

    /// Selection coverage, for the front end's marching-ants overlay.
    ///
    /// The engine keeps a selection as a grayscale coverage `Surface` clipped to the canvas, and
    /// offers no read-back command, so the bridge exposes one: a 16-byte little-endian header
    /// (`x: i32, y: i32, w: u32, h: u32` = the content bounds) followed by `w * h` coverage bytes.
    /// Empty when the document has no selection, or the selection covers nothing.
    pub fn selection_mask(&self, doc_id: &str) -> Result<Vec<u8>, ProtoError> {
        let doc = self.doc(doc_id)?;
        let Some(sel) = doc.selection.as_ref() else { return Ok(Vec::new()) };
        let canvas = photocraft_geom::Rect::from_size(doc.size);
        let rect = clip_rect(sel.content_bounds(), canvas);
        let (w, h) = (rect.width(), rect.height());
        if w == 0 || h == 0 {
            return Ok(Vec::new());
        }
        let channels = sel.channels().max(1);
        let px = sel.read_region(rect);
        let mut out = Vec::with_capacity(16 + (w as usize) * (h as usize));
        out.extend_from_slice(&rect.x0.to_le_bytes());
        out.extend_from_slice(&rect.y0.to_le_bytes());
        out.extend_from_slice(&w.to_le_bytes());
        out.extend_from_slice(&h.to_le_bytes());
        // Coverage lives in the first channel; clamp because filters can overshoot slightly.
        out.extend(px.chunks(channels).map(|c| (c.first().copied().unwrap_or(0.0).clamp(0.0, 1.0) * 255.0).round() as u8));
        Ok(out)
    }

    /// Register font bytes (TTF/OTF/TTC) with the shared text engine and redraw type layers.
    pub fn add_font(&mut self, bytes: Vec<u8>) -> Value {
        let families = photocraft_text::shared().lock().unwrap_or_else(PoisonError::into_inner).fonts.register_font_data(bytes);
        let mut layers = Vec::new();
        for st in self.session.documents() {
            for (_, _, l) in st.doc.walk() {
                if matches!(&l.content, LayerContent::Text(_)) {
                    layers.push((st.doc.id, l.id));
                }
            }
        }
        let busy = self.session.refresh_type_layers(&layers);
        json!({ "families": families, "refreshedLayers": layers.len(), "pendingLayers": busy.len() })
    }

    /// The `tjm/0` entry point: one envelope in, one response out (both JSON).
    pub fn request(&mut self, envelope: &str) -> String {
        let parsed: Result<Value, _> = serde_json::from_str(envelope);
        let response = match parsed {
            Err(e) => error_response(None, None, &ProtoError::new("BAD_ENVELOPE", format!("not JSON: {e}"))),
            Ok(env) => {
                let key = env.get("idempotencyKey").and_then(Value::as_str).map(str::to_string);
                if let Some(k) = &key
                    && let Some((_, cached)) = self.seen.iter().find(|(seen, _)| seen == k)
                {
                    return replayed(cached, &env);
                }
                let out = self.handle(&env);
                if let Some(k) = key {
                    // Only answers that executed something are cached; envelope errors may be retried.
                    if !matches!(out.get("error").and_then(|e| e.get("code")).and_then(Value::as_str), Some("BAD_ENVELOPE")) {
                        self.seen.push_back((k, out.to_string()));
                        while self.seen.len() > IDEMPOTENCY_CAPACITY {
                            self.seen.pop_front();
                        }
                    }
                }
                out
            }
        };
        response.to_string()
    }

    fn handle(&mut self, env: &Value) -> Value {
        let request_id = env.get("requestId").and_then(Value::as_str);
        if env.get("protocol").and_then(Value::as_str) != Some(PROTOCOL) {
            return error_response(request_id, None, &ProtoError::new("BAD_ENVELOPE", format!("`protocol` must be \"{PROTOCOL}\"")));
        }
        let Some(request_id) = request_id else {
            return error_response(None, None, &ProtoError::new("BAD_ENVELOPE", "`requestId` (string) is required"));
        };
        let Some(doc_id) = env.get("docId").and_then(Value::as_str) else {
            return error_response(Some(request_id), None, &ProtoError::new("BAD_ENVELOPE", "`docId` (string) is required"));
        };
        let Some(batch) = env.get("batch").and_then(Value::as_array) else {
            return error_response(Some(request_id), None, &ProtoError::new("BAD_ENVELOPE", "`batch` (array) is required"));
        };
        if batch.is_empty() {
            return error_response(Some(request_id), None, &ProtoError::new("BAD_ENVELOPE", "`batch` is empty"));
        }
        let mut steps = Vec::with_capacity(batch.len());
        for (at, step) in batch.iter().enumerate() {
            let Some(cmd) = step.get("cmd").and_then(Value::as_str) else {
                return error_response(Some(request_id), None, &ProtoError { code: "BAD_ENVELOPE", message: "each step needs `cmd` (string)".into(), at: Some(at) });
            };
            let params = step.get("params").cloned().unwrap_or_else(|| json!({}));
            if !params.is_object() {
                return error_response(Some(request_id), None, &ProtoError { code: "BAD_ENVELOPE", message: "`params` must be an object".into(), at: Some(at) });
            }
            steps.push((cmd.to_string(), params));
        }
        let current = match self.revision(doc_id) {
            Some(r) => r,
            None => return error_response(Some(request_id), None, &ProtoError::new("NO_DOCUMENT", format!("unknown docId `{doc_id}`"))),
        };
        if let Some(base) = env.get("baseRevision") {
            match base.as_u64() {
                Some(b) if b == current => {}
                Some(b) => {
                    let mut r = error_response(Some(request_id), Some(current), &ProtoError::new("REVISION_CONFLICT", format!("baseRevision {b} != current {current}")));
                    r["status"] = json!("conflict");
                    return r;
                }
                None => return error_response(Some(request_id), Some(current), &ProtoError::new("BAD_ENVELOPE", "`baseRevision` must be a non-negative integer")),
            }
        }
        let index = match self.activate(doc_id) {
            Ok(i) => i,
            Err(e) => return error_response(Some(request_id), Some(current), &e),
        };
        // Atomic batch: DocState is cheap to clone (Arc'd document, copy-on-write tiles).
        let Some(before) = self.session.documents().get(index).cloned() else {
            return error_response(Some(request_id), Some(current), &ProtoError::new("NO_DOCUMENT", "gone"));
        };
        let target_engine = before.doc.id.0;
        let engine_rev_before = before.revision;
        // Commands may open/close other documents (Edit Contents) or change them (a smart-object
        // commit updates the parent), so every open document's revision is snapshotted.
        let snapshot = self.engine_revisions();
        let mut results = Vec::with_capacity(steps.len());
        for (at, (cmd, params)) in steps.into_iter().enumerate() {
            let invalid = param_fields().get(cmd.as_str()).and_then(|f| schema::check(f, &params));
            let outcome = if READ_ONLY.contains(&cmd.as_str()) {
                self.read_only(doc_id, &cmd)
            } else if let Some(msg) = invalid {
                Err(ProtoError { code: "INVALID_PARAMS", message: format!("{cmd}: {msg}"), at: Some(at) })
            } else {
                self.session.execute(&cmd, params).map_err(|e| ProtoError { code: engine_code(&e), message: e.to_string(), at: Some(at) })
            };
            match outcome {
                Ok(value) => results.push(json!({ "cmd": cmd, "value": value })),
                Err(mut e) => {
                    e.at = Some(at);
                    self.rollback(target_engine, before, &snapshot);
                    let mut r = error_response(Some(request_id), Some(current), &e);
                    r["rolledBack"] = json!(true);
                    r["results"] = Value::Array(results);
                    return r;
                }
            }
        }
        // Indices shift when documents open or close, so find the target by its engine id.
        let target_now = self.session.documents().iter().position(|d| d.doc.id.0 == target_engine);
        let changed = target_now.is_none_or(|i| self.session.documents().get(i).is_some_and(|d| d.revision != engine_rev_before));
        let revision = if changed { current + 1 } else { current };
        if let Some(entry) = self.docs.get_mut(doc_id) {
            entry.revision = revision;
        }
        let (opened, closed, touched) = self.reconcile(Some(doc_id), &snapshot);
        // Damage rect (document pixels) of the batch, for incremental redraw; null = assume all changed.
        let damage = target_now.and_then(|i| self.session.documents().get(i)).and_then(|d| d.last_damage).map(|r| json!([r.x0, r.y0, r.x1, r.y1]));
        json!({
            "requestId": request_id, "status": "ok", "revision": revision, "changed": changed, "damage": damage, "results": results,
            "openedDocs": opened, "closedDocs": closed, "touchedDocs": touched,
        })
    }

    fn read_only(&self, doc_id: &str, cmd: &str) -> Result<Value, ProtoError> {
        match cmd {
            "doc.inspect" => self.inspect(doc_id),
            "doc.revision" => Ok(json!(self.revision(doc_id))),
            "engine.commands" => Ok(Value::Array(
                command_specs()
                    .iter()
                    .map(|c| json!({ "id": c.id, "label": c.label, "params": c.params, "enabled": self.session.is_enabled(c.id) }))
                    .collect(),
            )),
            _ => Err(ProtoError::new("UNKNOWN_COMMAND", cmd)),
        }
    }
}

/// Hides `id` wherever it sits in the tree (preview helper).
fn hide_layer(layers: &mut [photocraft_doc::Layer], id: u64) {
    for l in layers.iter_mut() {
        if l.id.0 == id {
            l.visible = false;
        }
        if let Some(ch) = l.children_mut() {
            hide_layer(ch, id);
        }
    }
}

/// Adds `locks` (transparency/pixels/position/artboard/all) to every layer node, recursing into groups.
fn add_locks(nodes: &mut Value, locks: &HashMap<u64, photocraft_doc::Locks>) {
    let Some(arr) = nodes.as_array_mut() else { return };
    for n in arr {
        if let Some(l) = n.get("id").and_then(Value::as_u64).and_then(|id| locks.get(&id)) {
            n["locks"] = json!({"transparency": l.transparency, "pixels": l.pixels, "position": l.position, "artboard": l.artboard, "all": l.all});
        }
        if let Some(ch) = n.get_mut("children") {
            add_locks(ch, locks);
        }
    }
}

fn error_response(request_id: Option<&str>, revision: Option<u64>, e: &ProtoError) -> Value {
    json!({
        "requestId": request_id,
        "status": "error",
        "revision": revision,
        "error": { "code": e.code, "message": e.message, "at": e.at },
    })
}

/// A replayed answer is the cached one, flagged, with this request's id.
fn replayed(cached: &str, env: &Value) -> String {
    let mut v: Value = serde_json::from_str(cached).unwrap_or_else(|_| json!({}));
    v["replayed"] = json!(true);
    if let Some(id) = env.get("requestId") {
        v["requestId"] = id.clone();
    }
    v.to_string()
}

fn clip_rect(a: photocraft_geom::Rect, b: photocraft_geom::Rect) -> photocraft_geom::Rect {
    photocraft_geom::Rect::new(a.x0.max(b.x0), a.y0.max(b.y0), a.x1.min(b.x1), a.y1.min(b.y1))
}

/// Estimates resident bytes after decoding a PSD/PSB, from the file header (dimensions, channels,
/// depth) and the layer-record count. A deliberate over-estimate used only as an open-time budget
/// guard; returns `None` for formats it does not probe (the caller falls back to a size multiple).
fn estimate_open_bytes(b: &[u8]) -> Option<u64> {
    if b.get(0..4)? != b"8BPS" {
        return None;
    }
    let be32 = |at: usize| -> Option<u64> { b.get(at..at + 4).map(|s| u32::from_be_bytes([s[0], s[1], s[2], s[3]]) as u64) };
    let be16 = |at: usize| -> Option<u64> { b.get(at..at + 2).map(|s| u16::from_be_bytes([s[0], s[1]]) as u64) };
    let channels = be16(12)?.max(4);
    let height = be32(14)?;
    let width = be32(18)?;
    let depth_bytes = (be16(22)? / 8).max(1);
    let area = width.saturating_mul(height);
    // Walk to the layer section to read the record count (cheap; no pixel decode).
    let cm_len = be32(26)? as usize;
    let res_at = 30usize.checked_add(cm_len)?;
    let res_len = be32(res_at)? as usize;
    let lm_at = res_at.checked_add(4)?.checked_add(res_len)?;
    let layer_count = be32(lm_at)
        .and_then(|_| {
            let li_at = lm_at + 8; // layer-mask len (u32) + layer-info len (u32)
            b.get(li_at..li_at + 2).map(|s| i16::from_be_bytes([s[0], s[1]]).unsigned_abs() as u64)
        })
        .unwrap_or(8)
        .clamp(1, 1000);
    // Composite + one worst-case (full-canvas) surface per layer record.
    Some(area.saturating_mul(channels).saturating_mul(depth_bytes).saturating_mul(layer_count.saturating_add(1)))
}
