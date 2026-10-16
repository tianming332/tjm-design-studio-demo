#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use serde_json::{Value, json};

use crate::core::Core;

fn real(name: &str) -> Vec<u8> {
    let p = format!("{}/../../testdata/psd/real/{name}", env!("CARGO_MANIFEST_DIR"));
    std::fs::read(&p).unwrap_or_else(|e| panic!("missing test file {p}: {e}"))
}

fn open_compat() -> (Core, String) {
    let mut c = Core::new();
    let r = c.open("compat-test.psd", &real("compat-test.psd")).expect("open");
    (c, r["docId"].as_str().expect("docId").to_string())
}

fn req(c: &mut Core, v: Value) -> Value {
    serde_json::from_str(&c.request(&v.to_string())).expect("response is JSON")
}

fn env(doc: &str, base: Option<u64>, key: Option<&str>, batch: Value) -> Value {
    let mut e = json!({ "protocol": "tjm/0", "requestId": "r1", "docId": doc, "batch": batch });
    if let Some(b) = base {
        e["baseRevision"] = json!(b);
    }
    if let Some(k) = key {
        e["idempotencyKey"] = json!(k);
    }
    e
}

/// Header + coverage of `selection_mask`: (x, y, w, h, coverage bytes).
fn mask(c: &Core, doc: &str) -> Option<(i32, i32, u32, u32, Vec<u8>)> {
    let raw = c.selection_mask(doc).expect("selection_mask");
    if raw.is_empty() {
        return None;
    }
    let g4 = |o: usize| -> [u8; 4] { raw[o..o + 4].try_into().expect("4 bytes") };
    let (x, y) = (i32::from_le_bytes(g4(0)), i32::from_le_bytes(g4(4)));
    let (w, h) = (u32::from_le_bytes(g4(8)), u32::from_le_bytes(g4(12)));
    Some((x, y, w, h, raw[16..].to_vec()))
}

#[test]
fn selection_mask_is_empty_without_a_selection() {
    let (c, doc) = open_compat();
    assert!(mask(&c, &doc).is_none(), "a freshly opened document has no selection");
}

#[test]
fn selection_mask_reports_a_rectangular_selection() {
    let (mut c, doc) = open_compat();
    let r = req(&mut c, env(&doc, None, None, json!([{ "cmd": "select.rect", "params": { "x": 10, "y": 20, "width": 30, "height": 40 } }])));
    assert_eq!(r["status"], "ok", "{r}");
    let (x, y, w, h, cov) = mask(&c, &doc).expect("a selection exists");
    assert_eq!((x, y, w, h), (10, 20, 30, 40));
    assert_eq!(cov.len(), (w * h) as usize);
    // Fully inside the rectangle, so every sample is fully covered.
    assert!(cov.iter().all(|&v| v == 255), "interior coverage should be opaque");
}

#[test]
fn selection_mask_shows_an_ellipse_clearing_the_corners() {
    let (mut c, doc) = open_compat();
    let r = req(
        &mut c,
        env(&doc, None, None, json!([{ "cmd": "select.rect", "params": { "x": 0, "y": 0, "width": 64, "height": 64, "ellipse": true } }])),
    );
    assert_eq!(r["status"], "ok", "{r}");
    let (_, _, w, h, cov) = mask(&c, &doc).expect("a selection exists");
    let at = |x: u32, y: u32| cov[(y * w + x) as usize];
    assert_eq!(at(0, 0), 0, "top-left corner is outside the ellipse");
    assert_eq!(at(w - 1, h - 1), 0, "bottom-right corner is outside the ellipse");
    assert!(at(w / 2, h / 2) > 250, "the centre is inside the ellipse");
}

#[test]
fn deselect_clears_the_selection_mask() {
    let (mut c, doc) = open_compat();
    req(&mut c, env(&doc, None, None, json!([{ "cmd": "select.rect", "params": { "x": 5, "y": 5, "width": 10, "height": 10 } }])));
    assert!(mask(&c, &doc).is_some());
    let r = req(&mut c, env(&doc, None, None, json!([{ "cmd": "select.deselect" }])));
    assert_eq!(r["status"], "ok", "{r}");
    assert!(mask(&c, &doc).is_none(), "deselect must clear the mask");
}
/// Id of the layer named `name` from doc.inspect.
fn layer_id(c: &Core, doc: &str, name: &str) -> u64 {
    fn find(ls: &[Value], name: &str) -> Option<u64> {
        ls.iter().find_map(|l| if l["name"] == name { l["id"].as_u64() } else { l["children"].as_array().and_then(|c| find(c, name)) })
    }
    let d = c.inspect(doc).expect("inspect");
    find(d["layers"].as_array().expect("layers"), name).expect("layer")
}

fn opacity(c: &Core, doc: &str, name: &str) -> f64 {
    let d = c.inspect(doc).expect("inspect");
    d["layers"].as_array().expect("layers").iter().find(|l| l["name"] == name).and_then(|l| l["opacity"].as_f64()).expect("opacity")
}

#[test]
fn opens_real_psd_and_resolves_inherited_font() {
    let (c, doc) = open_compat();
    let d = c.inspect(&doc).expect("inspect");
    assert_eq!(d["width"], 2480);
    assert_eq!(d["layers"].as_array().map(Vec::len), Some(5));
    assert!(d.to_string().contains("Adobe Heiti Std"));
}

#[test]
fn ok_batch_bumps_revision_and_read_only_does_not() {
    let (mut c, doc) = open_compat();
    let id = layer_id(&c, &doc, "图层 1");
    let r = req(&mut c, env(&doc, Some(0), None, json!([{ "cmd": "layer.setProps", "params": { "layer": id, "opacity": 0.5 } }])));
    assert_eq!(r["status"], "ok", "{r}");
    assert_eq!(r["revision"], 1);
    assert!((opacity(&c, &doc, "图层 1") - 0.5).abs() < 1e-6);
    let r = req(&mut c, env(&doc, Some(1), None, json!([{ "cmd": "doc.inspect" }])));
    assert_eq!(r["status"], "ok");
    assert_eq!(r["revision"], 1, "read-only must not bump");
}

#[test]
fn stale_base_revision_conflicts_without_executing() {
    let (mut c, doc) = open_compat();
    let id = layer_id(&c, &doc, "图层 1");
    let r = req(&mut c, env(&doc, Some(7), None, json!([{ "cmd": "layer.setProps", "params": { "layer": id, "opacity": 0.2 } }])));
    assert_eq!(r["status"], "conflict");
    assert_eq!(r["error"]["code"], "REVISION_CONFLICT");
    assert!((opacity(&c, &doc, "图层 1") - 1.0).abs() < 1e-6);
}

#[test]
fn failing_step_rolls_back_whole_batch() {
    let (mut c, doc) = open_compat();
    let id = layer_id(&c, &doc, "图层 1");
    let before = c.inspect(&doc).expect("inspect");
    let r = req(
        &mut c,
        env(&doc, Some(0), None, json!([
            { "cmd": "layer.setProps", "params": { "layer": id, "opacity": 0.3 } },
            { "cmd": "layer.renameLayer", "params": { "layer": id, "name": "renamed" } },
            { "cmd": "no.such.command" },
        ])),
    );
    assert_eq!(r["status"], "error");
    assert_eq!(r["error"]["code"], "UNKNOWN_COMMAND");
    assert_eq!(r["error"]["at"], 2);
    assert_eq!(r["rolledBack"], true);
    assert_eq!(c.revision(&doc), Some(0));
    let after = c.inspect(&doc).expect("inspect");
    assert_eq!(before["layers"], after["layers"], "document must be unchanged after rollback");
}

#[test]
fn idempotency_key_replays_without_reexecuting() {
    let (mut c, doc) = open_compat();
    let id = layer_id(&c, &doc, "图层 1");
    let e = env(&doc, Some(0), Some("k-1"), json!([{ "cmd": "layer.renameLayer", "params": { "layer": id, "name": "A" } }]));
    let first = req(&mut c, e.clone());
    let second = req(&mut c, e);
    assert_eq!(first["status"], "ok");
    assert_eq!(second["replayed"], true);
    assert_eq!(second["revision"], 1);
    assert_eq!(c.revision(&doc), Some(1), "replay must not execute again");
}

#[test]
fn invalid_params_and_disabled_commands_are_structured_errors() {
    let (mut c, doc) = open_compat();
    let id = layer_id(&c, &doc, "图层 1");
    let r = req(&mut c, env(&doc, None, None, json!([{ "cmd": "layer.setProps", "params": { "layer": id, "opacity": "high" } }])));
    assert_eq!(r["status"], "error");
    assert_eq!(r["error"]["code"], "INVALID_PARAMS", "{r}");
    // Adjustments need a pixel layer: target the type layer.
    let text = layer_id(&c, &doc, "72号adobe黑体");
    let r = req(&mut c, env(&doc, None, None, json!([{ "cmd": "layer.select", "params": { "layer": text } }, { "cmd": "image.adjustments.invert" }])));
    assert_eq!(r["status"], "error");
    assert_eq!(r["error"]["code"], "COMMAND_DISABLED", "{r}");
    assert_eq!(r["error"]["at"], 1);
}

#[test]
fn bad_envelopes_are_rejected() {
    let (mut c, doc) = open_compat();
    let r: Value = serde_json::from_str(&c.request("{not json")).expect("json");
    assert_eq!(r["error"]["code"], "BAD_ENVELOPE");
    let r = req(&mut c, json!({ "protocol": "tjm/9", "requestId": "x", "docId": doc, "batch": [] }));
    assert_eq!(r["error"]["code"], "BAD_ENVELOPE");
    let r = req(&mut c, json!({ "protocol": "tjm/0", "requestId": "x", "docId": "nope", "batch": [{ "cmd": "doc.inspect" }] }));
    assert_eq!(r["error"]["code"], "NO_DOCUMENT");
}

#[test]
fn save_psd_round_trips_and_render_matches_size() {
    let (c, doc) = open_compat();
    let (bytes, _warnings) = c.save(&doc, "psd").expect("save");
    let (_, _, ids) = crate::psd_post::resource_ids(&bytes).expect("resources");
    assert!(ids.contains(&1036), "thumbnail resource added: {ids:?}");
    assert!(ids.contains(&1039), "ICC profile kept: {ids:?}");
    let mut c2 = Core::new();
    let r = c2.open("again.psd", &bytes).expect("reopen");
    assert_eq!(r["document"]["layers"].as_array().map(Vec::len), Some(5));
    let (w, h, px) = c.render_rgba(&doc, 512).expect("render");
    assert_eq!((w.max(h), px.len()), (512, (w * h * 4) as usize));
}

#[test]
fn every_registered_params_doc_parses_and_accepts_empty_params() {
    let fields = crate::core::param_fields();
    assert!(fields.len() > 800, "registry has {} commands", fields.len());
    let with_params = photocraft_engine::command_specs().iter().filter(|c| c.params.contains("\":")).count();
    let parsed = fields.values().filter(|f| !f.is_empty()).count();
    assert!(parsed * 10 >= with_params * 9, "parsed {parsed} of {with_params} params docs");
    for (id, f) in fields {
        assert!(crate::schema::check(f, &json!({})).is_none(), "{id} rejects empty params");
    }
}

#[test]
fn open_budget_rejects_oversized_without_decoding() {
    let (c, doc) = open_compat();
    let stats = c.stats();
    assert_eq!(stats["openDocuments"], 1);
    assert!(stats["documents"][0]["estimatedBytes"].as_u64().unwrap() > 0);
    // A 1-byte budget rejects any open; the message carries the estimate.
    let mut c2 = Core::new();
    c2.budget_bytes = 1;
    let e = c2.open("compat-test.psd", &real("compat-test.psd")).unwrap_err();
    assert_eq!(e.code, "OVER_BUDGET");
    assert!(c2.stats()["openDocuments"] == 0);
    let _ = doc;
}

#[test]
fn close_and_reset_free_documents() {
    let (mut c, doc) = open_compat();
    c.open("second.psd", &real("compat-test.psd")).expect("open 2");
    assert_eq!(c.stats()["openDocuments"], 2);
    c.close(&doc).expect("close");
    assert_eq!(c.stats()["openDocuments"], 1);
    c.reset();
    assert_eq!(c.stats()["openDocuments"], 0);
    assert_eq!(c.stats()["estimatedBytesTotal"], 0);
}

#[test]
fn linked_smart_objects_reported_in_warnings() {
    // compat-6 and compat-7 carry linked (lnkE) smart objects; compat-test has none.
    let mut c = Core::new();
    let plain = c.open("compat-test.psd", &real("compat-test.psd")).expect("open");
    assert_eq!(plain["linkedSmartObjects"].as_array().map(Vec::len), Some(0));

    let mut c2 = Core::new();
    let r = c2.open("compat-7.psd", &real("compat-7.psd")).expect("open 7");
    let linked = r["linkedSmartObjects"].as_array().expect("array");
    assert!(!linked.is_empty(), "compat-7 should report linked smart objects");
    assert!(r["warnings"].as_array().unwrap().iter().any(|w| w.as_str().unwrap_or("").contains("链接智能对象")));
    assert!(linked[0]["name"].is_string() && linked[0]["path"].is_string());
}

#[test]
fn render_region_clips_to_canvas() {
    let (c, doc) = open_compat();
    let (w, h, px) = c.render_region(&doc, 100, 200, 300, 150).expect("region");
    assert_eq!((w, h, px.len()), (300, 150, 300 * 150 * 4));
    // A rect entirely off-canvas returns empty, not an error.
    let (w2, _, px2) = c.render_region(&doc, 99999, 99999, 10, 10).expect("off-canvas");
    assert_eq!((w2, px2.len()), (0, 0));
}

/// First layer (depth-first) whose node matches `pred`, from an inspect payload.
fn find_layer(inspect: &Value, pred: &dyn Fn(&Value) -> bool) -> Option<Value> {
    let mut stack: Vec<Value> = inspect["layers"].as_array()?.clone();
    while let Some(n) = stack.pop() {
        if pred(&n) {
            return Some(n);
        }
        if let Some(ch) = n["children"].as_array() {
            stack.extend(ch.iter().cloned());
        }
    }
    None
}

/// Converts "图层 1" to a smart object and returns its layer id.
fn make_smart_object(c: &mut Core, doc: &str) -> u64 {
    let ins = c.inspect(doc).expect("inspect");
    let px = find_layer(&ins, &|l| l["name"] == "图层 1").expect("图层 1")["id"].as_u64().expect("id");
    let r = req(c, env(doc, None, None, json!([{ "cmd": "layer.select", "params": { "layer": px } }, { "cmd": "layer.smartObjects.convertToSmartObject" }])));
    assert_eq!(r["status"], "ok", "{r}");
    let ins = c.inspect(doc).expect("inspect");
    find_layer(&ins, &|l| l["kind"].as_str().is_some_and(|k| k.to_ascii_lowercase().contains("smart")))
        .expect("smart object layer")["id"]
        .as_u64()
        .expect("id")
}

#[test]
fn edit_contents_registers_the_child_and_a_commit_touches_the_parent() {
    let (mut c, parent) = open_compat();
    let so = make_smart_object(&mut c, &parent);

    // Edit Contents opens a new engine document: the bridge must hand out a docId for it.
    let r = req(&mut c, env(&parent, None, None, json!([{ "cmd": "layer.select", "params": { "layer": so } }, { "cmd": "layer.smartObjects.editContents" }])));
    assert_eq!(r["status"], "ok", "{r}");
    let opened = r["openedDocs"].as_array().expect("openedDocs");
    assert_eq!(opened.len(), 1, "{r}");
    let child = opened[0]["docId"].as_str().expect("child docId").to_string();
    assert_ne!(child, parent);
    assert_eq!(c.stats()["openDocuments"], 2);
    let child_ins = c.inspect(&child).expect("child is addressable");
    let (cw, ch) = (child_ins["width"].as_u64().unwrap(), child_ins["height"].as_u64().unwrap());
    assert!(cw > 0 && ch > 0);

    // Paint the child red, then Save Contents: the parent changes, so it must be reported.
    let child_px = find_layer(&child_ins, &|l| l["kind"] == "Pixel").expect("child pixel layer")["id"].as_u64().unwrap();
    let paint = json!([
        { "cmd": "layer.select", "params": { "layer": child_px } },
        { "cmd": "paint.stroke", "params": { "points": [[cw / 2, ch / 2]], "size": (cw.max(ch) * 2) as f64, "hardness": 1.0, "color": "#ff0000" } },
    ]);
    let r = req(&mut c, env(&child, None, None, paint));
    assert_eq!(r["status"], "ok", "{r}");
    // Revision of the parent right before the commit (the Edit Contents batch may have moved it).
    let parent_rev = c.revision(&parent).expect("rev");
    let r = req(&mut c, env(&child, None, None, json!([{ "cmd": "layer.smartObjects.saveContents" }])));
    assert_eq!(r["status"], "ok", "{r}");
    let touched = r["touchedDocs"].as_array().expect("touchedDocs");
    assert!(touched.iter().any(|t| t["docId"] == parent.as_str() && t["revision"] == parent_rev + 1), "{r}");
    assert_eq!(c.revision(&parent), Some(parent_rev + 1));

    // The parent's composite now shows the edit at the smart object's centre.
    let ins = c.inspect(&parent).expect("inspect");
    let b = find_layer(&ins, &|l| l["id"] == so).expect("so")["bounds"].clone();
    let (bx, by, bw, bh) = (b[0].as_i64().unwrap(), b[1].as_i64().unwrap(), b[2].as_i64().unwrap(), b[3].as_i64().unwrap());
    let (_, _, px) = c.render_region(&parent, (bx + bw / 2) as i32, (by + bh / 2) as i32, 1, 1).expect("px");
    assert!(px[0] > 200 && px[1] < 60 && px[2] < 60, "parent shows the red edit: {px:?}");

    // A stale baseRevision on the parent is now a conflict (the front end must sync).
    let r = req(&mut c, env(&parent, Some(parent_rev), None, json!([{ "cmd": "doc.inspect" }])));
    assert_eq!(r["status"], "conflict", "{r}");

    // Closing the child unregisters it.
    let closed = c.close(&child).expect("close child");
    assert!(closed["closedDocs"].as_array().unwrap().iter().any(|d| d == child.as_str()), "{closed}");
    assert_eq!(c.stats()["openDocuments"], 1);
    assert!(c.inspect(&child).is_err());
}

#[test]
fn closing_an_edited_child_commits_into_the_parent() {
    let (mut c, parent) = open_compat();
    let so = make_smart_object(&mut c, &parent);
    let r = req(&mut c, env(&parent, None, None, json!([{ "cmd": "layer.select", "params": { "layer": so } }, { "cmd": "layer.smartObjects.editContents" }])));
    let child = r["openedDocs"][0]["docId"].as_str().expect("child").to_string();
    let ins = c.inspect(&child).expect("child");
    let child_px = find_layer(&ins, &|l| l["kind"] == "Pixel").expect("px")["id"].as_u64().unwrap();
    let r = req(&mut c, env(&child, None, None, json!([
        { "cmd": "layer.select", "params": { "layer": child_px } },
        { "cmd": "paint.stroke", "params": { "points": [[4, 4]], "size": 4.0, "color": "#00ff00" } },
    ])));
    assert_eq!(r["status"], "ok", "{r}");
    let before = c.revision(&parent).unwrap();
    let out = c.close(&child).expect("close");
    assert!(out["touchedDocs"].as_array().unwrap().iter().any(|t| t["docId"] == parent.as_str()), "{out}");
    assert_eq!(c.revision(&parent), Some(before + 1));
}

#[test]
fn a_failed_batch_that_opened_a_document_rolls_it_back() {
    let (mut c, parent) = open_compat();
    let so = make_smart_object(&mut c, &parent);
    let rev = c.revision(&parent).unwrap();
    let r = req(&mut c, env(&parent, None, None, json!([
        { "cmd": "layer.select", "params": { "layer": so } },
        { "cmd": "layer.smartObjects.editContents" },
        { "cmd": "no.such.command" },
    ])));
    assert_eq!(r["status"], "error", "{r}");
    assert_eq!(r["rolledBack"], true);
    assert_eq!(c.stats()["openDocuments"], 1, "the half-opened child is closed again");
    assert_eq!(c.revision(&parent), Some(rev));
    // The parent is still usable afterwards.
    let r = req(&mut c, env(&parent, Some(rev), None, json!([{ "cmd": "doc.inspect" }])));
    assert_eq!(r["status"], "ok", "{r}");
}

#[test]
fn inspect_reports_layer_locks_and_unlock_round_trips() {
    let (mut c, doc) = open_compat();
    let r = req(&mut c, env(&doc, Some(0), None, json!([{ "cmd": "layer.new.layer" }])));
    assert_eq!(r["status"], "ok", "{r}");
    let id = r["results"][0]["value"]["layer"].as_u64().expect("new layer id");
    let node = |c: &Core| -> Value {
        let v = c.inspect(&doc).expect("inspect");
        v["layers"].as_array().expect("layers").iter().find(|n| n["id"].as_u64() == Some(id)).cloned().expect("layer node")
    };
    assert_eq!(node(&c)["locks"]["pixels"], false);
    let r = req(&mut c, env(&doc, Some(1), None, json!([{ "cmd": "layer.setProps", "params": { "layer": id, "locks": { "pixels": true, "position": true } } }])));
    assert_eq!(r["status"], "ok", "{r}");
    let n = node(&c);
    assert_eq!(n["locks"]["pixels"], true);
    assert_eq!(n["locks"]["position"], true);
    assert_eq!(n["locks"]["transparency"], false);
    let r = req(&mut c, env(&doc, Some(2), None, json!([{ "cmd": "layer.setProps", "params": { "layer": id, "locks": { "pixels": false, "position": false } } }])));
    assert_eq!(r["status"], "ok", "{r}");
    assert_eq!(node(&c)["locks"]["pixels"], false);
}

#[test]
fn render_layer_split_isolates_and_hides_a_layer() {
    let (mut c, doc) = open_compat();
    let r = req(&mut c, env(&doc, Some(0), None, json!([
        { "cmd": "layer.new.layer" },
        { "cmd": "select.rect", "params": { "x": 0, "y": 0, "width": 8, "height": 8 } },
        { "cmd": "edit.fill", "params": { "color": "#ff0000" } }
    ])));
    assert_eq!(r["status"], "ok", "{r}");
    let id = r["results"][0]["value"]["layer"].as_u64().expect("layer id");
    let (w, h, alone) = c.render_layer_split(&doc, id, true, 0, 0, 16, 16).expect("alone");
    assert_eq!((w, h), (16, 16));
    assert_eq!(&alone[0..4], &[255, 0, 0, 255], "the layer's own red pixel");
    assert_eq!(alone[(10 * 16 + 10) * 4 + 3], 0, "nothing else is drawn");
    let (_, _, under) = c.render_layer_split(&doc, id, false, 0, 0, 16, 16).expect("without");
    assert_ne!(&under[0..4], &[255, 0, 0, 255], "the layer is hidden underneath");
    assert!(c.render_layer_split(&doc, 999_999, true, 0, 0, 4, 4).is_err());
}
