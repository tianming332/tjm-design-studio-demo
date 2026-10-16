import { describe, expect, it } from 'vitest';
import { CLIENT_TOOLS, EDIT_BATCH, targetLayers } from './tools';
import { EditorBridge, clampRegion, lockProblem, summarizeLayers } from './bridge';
import { DocSession, EngineError } from '../engine/session';
import type { Step, TaskSummary } from './contract';
// The Admin catalog is the source of truth for names, schemas and risk.
// @ts-expect-error plain JS module outside this TS project
import { TOOLS as SERVER_TOOLS, validateCall } from '../local/backend/workbench/tools.js';

type ServerTool = { name: string; kind: string; where: string; risk: string };

describe('tool mapping vs the Admin catalog', () => {
  it('the editor executes exactly the catalog\'s client tools', () => {
    const client = (SERVER_TOOLS as ServerTool[]).filter((t) => t.where === 'client').map((t) => t.name).sort();
    expect([...CLIENT_TOOLS].sort()).toEqual(client);
  });
  it('every edit mapping accepts catalog-valid sample args and emits engine commands', () => {
    const sample: Record<string, Record<string, unknown>> = {
      text_create: { text: 'A', x: 1, y: 2 }, text_edit: { layer: 1, text: 'B' }, text_style: { layer: 1, color: '#ff0000' },
      layer_move: { layer: 1, dx: 1, dy: 1 }, layer_props: { layer: 1, opacity: 0.5 }, layer_arrange: { layer: 1, direction: 'sendToBack' },
      layer_align: { layers: [1, 2], edge: 'leftEdges', to: 'canvas' }, shape_create: { kind: 'rect', rect: [0, 0, 10, 10], fill: '#000000' },
      fill_solid: { color: '#ffffff' }, layer_group: { layers: [1, 2], name: 'g' }, layer_delete: { layer: 1 },
      region_select: { method: 'object', rect: [10, 10, 100, 100] }, region_refine: { feather: 2, smooth: 10 },
      region_apply: { op: 'cutout', layer: 1 }, adjust_apply: { kind: 'hueSaturation', saturation: 20 },
      filter_apply: { filter: 'filter.blur.radialBlur#zoom', layer: 2, values: { amount: 900 } },
    };
    expect(Object.keys(sample).sort()).toEqual(Object.keys(EDIT_BATCH).sort());
    for (const [name, args] of Object.entries(sample)) {
      expect(validateCall(name, args).ok, name).toBe(true);
      const batch = EDIT_BATCH[name](args);
      expect(batch.length).toBeGreaterThan(0);
      expect(batch.every((c) => /^[a-z]+(\.[A-Za-z]+)+$/.test(c.cmd)), name).toBe(true);
    }
    expect(EDIT_BATCH.layer_align({ layers: [3, 4], edge: 'topEdges' }).map((c) => c.cmd)).toEqual(['layer.select', 'layer.select', 'layer.align.topEdges']);
    expect(targetLayers({ layer: 3, layers: [4, 5] })).toEqual([3, 4, 5]);
  });
});

// --- bridge against a fake engine client -------------------------------------------------------

const layers = [
  { id: 1, name: '背景', kind: 'Pixel', blend: 'normal', fill: 1, locks: { all: true, pixels: false, position: false, transparency: false } },
  { id: 2, name: '标题', kind: 'Type', blend: 'normal', fill: 1, bounds: [10, 10, 100, 40], text: { text: '春季', font: 'Noto', sizePt: 30 }, locks: { all: false, pixels: false, position: true, transparency: false } },
  { id: 3, name: '商品', kind: 'Pixel', blend: 'normal', fill: 1 },
] as never[];

function fakeEngine(start = 5) {
  const sent: any[] = [];
  let rev = start;
  const client = {
    request(env: any): Promise<any> {
      sent.push(env);
      if (env.batch[0].cmd === 'doc.inspect') return Promise.resolve({ ok: true, data: { status: 'ok', revision: rev, results: [{ value: { width: 800, height: 600, layers } }] } });
      if (env.baseRevision !== rev) return Promise.resolve({ ok: true, data: { status: 'conflict', revision: rev, results: [] } });
      rev += 1;
      return Promise.resolve({ ok: true, data: { status: 'ok', revision: rev, results: [{ value: { layer: 9 } }], damage: [0, 0, 10, 10] } });
    },
    render: () => Promise.resolve({ ok: true, data: { width: 400, height: 300, pixels: new ArrayBuffer(400 * 300 * 4) } }),
    renderRegion: (_d: string, _x: number, _y: number, w: number, h: number) => Promise.resolve({ ok: true, data: { width: w, height: h, pixels: new ArrayBuffer(w * h * 4) } }),
    bump() { rev += 1; },
  };
  const s = new (DocSession as any)(client, 'doc-1', []) as DocSession;
  (s as any).revision = start;
  return { s, sent, client };
}

const task = { id: 'tsk_1', runId: 'run_1', target: { projectRef: 'p', clientSessionId: 'cs', docId: 'doc-1' } } as TaskSummary;
const step = (tool: string, args: Record<string, unknown>, observedRevision = 5): Step => ({ stepId: `stp_${tool}`, callId: 'c1', round: 1, tool, args, inputDigest: 'd1', where: 'client', status: 'leased', lease: { id: 'ls_1', clientSessionId: 'cs', expiresAt: 0 }, observedRevision });

function bridgeWith(s?: DocSession) {
  const synced: string[] = [];
  const b = new EditorBridge({ session: (id) => (id === 'doc-1' ? s : undefined), afterEdit: async (id) => { synced.push(id); }, assetBytes: async () => ({ bytes: new ArrayBuffer(0), mime: 'image/png' }), encodePng: async (px, max) => { const k = Math.min(1, max / Math.max(px.width, px.height)); return { dataUrl: 'data:image/png;base64,AA==', width: Math.round(px.width * k), height: Math.round(px.height * k) }; } });
  return { b, synced };
}

describe('EditorBridge', () => {
  it('does not try to bring an already-frontmost imported subject forward again', async () => {
    const { s, client, sent } = fakeEngine();
    const request = client.request.bind(client);
    client.request = (env: any) => env.batch[0].cmd === 'doc.inspect'
      ? Promise.resolve({ ok: true, data: { status: 'ok', revision: s.currentRevision, results: [{ value: { width: 800, height: 600, layers: [{ id: 9, name: 'subject', kind: 'Pixel', bounds: [350, 250, 100, 100] }, ...layers] } }] } })
      : request(env);
    s.loadImageToClipboard = async () => ({ width: 100, height: 100 });
    const { b } = bridgeWith(s);
    const result = await b.execute(task, step('asset_import', { assetId: 'a1', fit: 'native', role: 'subject', name: 'product' }));
    expect(result.status).toBe('ok');
    expect(sent.flatMap((e) => e.batch).some((c) => c.cmd === 'layer.arrange.bringToFront')).toBe(false);
  });
  it('doc_read returns the real tree with ids, text and locks', async () => {
    const { s } = fakeEngine();
    const r = await bridgeWith(s).b.execute(task, step('doc_read', {}));
    expect(r.status).toBe('ok');
    expect((r.result as any).layers.map((l: any) => l.id)).toEqual([1, 2, 3]);
    expect((r.result as any).layers[1]).toMatchObject({ text: '春季', locks: { position: true } });
    expect(summarizeLayers([{ id: 4, name: 'x', kind: 'Pixel', blend: 'normal', fill: 1 }] as never)).toEqual([{ id: 4, name: 'x', kind: 'Pixel' }]);
  });
  it('edits run with the observed revision and an idempotency key, then sync the UI', async () => {
    const { s, sent } = fakeEngine();
    const { b, synced } = bridgeWith(s);
    const r = await b.execute(task, step('text_style', { layer: 3, color: '#ff0000' }));
    expect(r).toMatchObject({ status: 'ok', revisionBefore: 5, revisionAfter: 6, affectedLayers: [3, 9] });
    const edit = sent.find((e) => e.batch[0].cmd === 'type.setStyle');
    expect(edit).toMatchObject({ baseRevision: 5, idempotencyKey: 'tsk_1:stp_text_style' });
    expect(synced).toEqual(['doc-1']);
  });
  it('a manual edit after planning is a REVISION_CONFLICT, and nothing is executed', async () => {
    const { s, sent, client } = fakeEngine();
    client.bump(); (s as any).revision = 6; // user edited: engine and session now at 6
    const r = await bridgeWith(s).b.execute(task, step('layer_move', { layer: 3, dx: 1, dy: 1 }, 5));
    expect(r.status).toBe('error');
    expect(r.error!.code).toBe('REVISION_CONFLICT');
    expect(sent.some((e) => e.batch[0].cmd === 'layer.translate')).toBe(false);
  });
  it('the engine-side check catches an edit that lands while the step is queued', async () => {
    const { s, client } = fakeEngine();
    const orig = client.request.bind(client);
    client.request = (env: any) => { if (env.batch[0].cmd === 'layer.setProps') client.bump(); return orig(env); };
    const r = await bridgeWith(s).b.execute(task, step('layer_props', { layer: 3, opacity: 0.5 }));
    expect(r.error?.code).toBe('REVISION_CONFLICT');
  });
  it('locked or missing layers are refused before the engine is touched', async () => {
    const { s } = fakeEngine();
    const { b } = bridgeWith(s);
    expect((await b.execute(task, step('layer_props', { layer: 1, opacity: 0.5 }))).error?.code).toBe('LOCKED');
    expect((await b.execute(task, step('layer_move', { layer: 2, dx: 1, dy: 0 }))).error?.code).toBe('LOCKED');
    expect((await b.execute(task, step('layer_move', { layer: 77, dx: 1, dy: 0 }))).error?.code).toBe('NOT_FOUND');
    expect(lockProblem({ width: 1, height: 1, layers } as never, 'text_style', [2])).toBeUndefined(); // position lock does not block styling
  });
  it('never writes into another document; a reused key with other input is refused', async () => {
    const { b } = bridgeWith(undefined);
    expect((await b.execute(task, step('doc_read', {}))).error?.code).toBe('TARGET_MISMATCH');
    const { s } = fakeEngine();
    const b2 = bridgeWith(s).b;
    await b2.execute(task, step('doc_read', {}));
    expect((await b2.execute(task, { ...step('doc_read', {}), inputDigest: 'other' })).error?.code).toBe('IDEMPOTENCY_MISMATCH');
  });
  it('preview reports revision, region and scale for mapping back to document pixels', async () => {
    const { s } = fakeEngine();
    const b = bridgeWith(s).b;
    const full = await b.preview(s, { maxSide: 400 });
    expect(full).toMatchObject({ revision: 5, region: { x: 0, y: 0, w: 800, h: 600 }, width: 400, scale: 0.5 });
    const part = await b.preview(s, { region: { x: 700, y: 500, w: 400, h: 400 }, maxSide: 50 });
    expect(part.region).toEqual({ x: 700, y: 500, w: 100, h: 100 }); // clamped to the canvas
    expect(part.scale).toBe(0.5);
    expect(clampRegion({ x: -5, y: -5, w: 10, h: 10 }, 4, 4)).toEqual({ x: 0, y: 0, w: 4, h: 4 });
  });
  it('engine failures become ENGINE_ERROR receipts, not exceptions', async () => {
    const { s, client } = fakeEngine();
    client.request = (env: any) => Promise.resolve(env.batch[0].cmd === 'doc.inspect' ? { ok: true, data: { status: 'ok', revision: 5, results: [{ value: { width: 1, height: 1, layers } }] } } : { ok: true, data: { status: 'error', revision: 5, results: [], error: { code: 'INVALID_PARAMS', message: 'bad' } } });
    const r = await bridgeWith(s).b.execute(task, step('text_edit', { layer: 3, text: 'x' }));
    expect(r.error).toMatchObject({ code: 'ENGINE_ERROR' });
    expect(EngineError).toBeDefined();
  });
});
