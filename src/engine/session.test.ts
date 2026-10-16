import { describe, expect, it } from 'vitest';
import { DocSession, toRects, selectBatch, docEvents } from './session';
import { envelope } from './client';

// Minimal fake EngineClient: only `request` is exercised by these tests.
function fakeClient(replies: any[]) {
  let i = 0;
  const calls: any[] = [];
  return {
    peakWasmBytes: 0,
    request(env: object) { calls.push(env); return Promise.resolve(replies[i++]); },
    _calls: calls,
  } as any;
}

// Access the private constructor for unit testing without a real Worker.
function makeSession(client: any, revision = 0) {
  const s = new (DocSession as any)(client, 'doc-1', []) as DocSession;
  (s as any).revision = revision;
  return s;
}

describe('toRects', () => {
  it('converts the engine edge form [x0,y0,x1,y1] to x/y/w/h', () => {
    expect(toRects([100, 100, 400, 300])).toEqual([{ x: 100, y: 100, w: 300, h: 200 }]);
  });
  it('normalises null / single / array damage', () => {
    expect(toRects(null)).toEqual([]);
    expect(toRects(undefined)).toEqual([]);
    expect(toRects([{ x: 1, y: 2, w: 3, h: 4 }])).toHaveLength(1);
    expect(toRects([[0, 0, 2, 2], [4, 4, 6, 6]])).toHaveLength(2);
  });
  it('drops degenerate rectangles instead of repainting nothing', () => {
    expect(toRects([10, 10, 10, 20])).toEqual([]);
    expect(toRects([10, 10, 5, 5])).toEqual([]);
    expect(toRects({ x: 0, y: 0, w: 0, h: 5 })).toEqual([]);
  });
});

describe('envelope', () => {
  it('carries docId, batch and baseRevision', () => {
    const env = envelope('doc-1', [{ cmd: 'doc.inspect' }], { baseRevision: 7 }) as any;
    expect(env.protocol).toBe('tjm/0');
    expect(env.docId).toBe('doc-1');
    expect(env.batch[0].cmd).toBe('doc.inspect');
    expect(env.baseRevision).toBe(7);
  });
});

describe('selectBatch', () => {
  it('replaces with the first id then adds the rest', () => {
    expect(selectBatch([7, 8, 9])).toEqual([
      { cmd: 'layer.select', params: { layer: 7, mode: 'replace' } },
      { cmd: 'layer.select', params: { layer: 8, mode: 'add' } },
      { cmd: 'layer.select', params: { layer: 9, mode: 'add' } },
    ]);
  });
  it('is empty for no ids', () => expect(selectBatch([])).toEqual([]));
});

describe('align / distribute batches', () => {
  it('select the layers before the align command, atomically', async () => {
    const client = fakeClient([{ ok: true, data: { status: 'ok', revision: 2, results: [] } }]);
    const s = makeSession(client, 1);
    await s.align([4, 5], 'leftEdges');
    const batch = client._calls[0].batch;
    expect(batch).toHaveLength(3);
    expect(batch[0]).toEqual({ cmd: 'layer.select', params: { layer: 4, mode: 'replace' } });
    expect(batch[2]).toEqual({ cmd: 'layer.align.leftEdges' });
  });

  it('builds the distribute command id from the mode', async () => {
    const client = fakeClient([{ ok: true, data: { status: 'ok', revision: 2, results: [] } }]);
    const s = makeSession(client, 1);
    await s.distribute([1, 2, 3], 'horizontally');
    const batch = client._calls[0].batch;
    expect(batch[3]).toEqual({ cmd: 'layer.distribute.horizontally' });
  });
});

describe('photo ops', () => {
  const okReply = () => [{ ok: true, data: { status: 'ok', revision: 2, results: [] } }];

  it('crop sends x/y/width/height', async () => {
    const client = fakeClient(okReply());
    await makeSession(client, 1).crop(5, 6, 100, 50);
    expect(client._calls[0].batch[0]).toEqual({ cmd: 'image.crop', params: { x: 5, y: 6, width: 100, height: 50 } });
  });

  it('resizeImage defaults to bicubic resample', async () => {
    const client = fakeClient(okReply());
    await makeSession(client, 1).resizeImage(800, 600);
    expect(client._calls[0].batch[0]).toEqual({ cmd: 'image.imageSize', params: { width: 800, height: 600, resample: 'bicubic' } });
  });

  it('resizeCanvas defaults to the center anchor and background extension, absolute size', async () => {
    const client = fakeClient(okReply());
    await makeSession(client, 1).resizeCanvas(500, 500);
    expect(client._calls[0].batch[0]).toEqual({ cmd: 'image.canvasSize', params: { width: 500, height: 500, anchor: 'center', extensionColor: 'background', relative: false } });
  });

  it('resizeCanvas passes anchor, extension colour and relative mode through', async () => {
    const client = fakeClient(okReply());
    await makeSession(client, 1).resizeCanvas(20, 0, 'bottomRight', '#ff0000', true);
    expect(client._calls[0].batch[0].params).toEqual({ width: 20, height: 0, anchor: 'bottomRight', extensionColor: '#ff0000', relative: true });
  });

  it('rotate and auto build the command id from the kind', async () => {
    const c1 = fakeClient(okReply());
    await makeSession(c1, 1).rotate('90cw');
    expect(c1._calls[0].batch[0]).toEqual({ cmd: 'image.imageRotation.90cw' });
    const c2 = fakeClient(okReply());
    await makeSession(c2, 1).auto('autoTone');
    expect(c2._calls[0].batch[0]).toEqual({ cmd: 'image.autoTone' });
  });

  it('auto selects the pixel layer first when one is given', async () => {
    const client = fakeClient(okReply());
    await makeSession(client, 1).auto('autoColor', 3);
    expect(client._calls[0].batch).toEqual([
      { cmd: 'layer.select', params: { layer: 3, mode: 'replace' } },
      { cmd: 'image.autoColor' },
    ]);
  });

  it('setAdjustment merges the layer id with the kind params', async () => {
    const client = fakeClient(okReply());
    await makeSession(client, 1).setAdjustment(12, { brightness: 20, contrast: -5 });
    expect(client._calls[0].batch[0]).toEqual({
      cmd: 'layer.setAdjustment',
      params: { layer: 12, brightness: 20, contrast: -5 },
    });
  });
});

describe('paint ops', () => {
  const okReply = () => [{ ok: true, data: { status: 'ok', revision: 2, results: [] } }];
  const brush = { size: 20, hardness: 0.8, opacity: 1, flow: 1 };

  it('stroke sends points, brush params and target', async () => {
    const client = fakeClient(okReply());
    await makeSession(client, 1).stroke([[1, 2], [3, 4]], { ...brush, color: '#ff0000' }, 'pixels');
    expect(client._calls[0].batch[0]).toEqual({
      cmd: 'paint.stroke',
      params: { points: [[1, 2], [3, 4]], size: 20, opacity: 1, erase: false, hardness: 0.8, flow: 1, color: '#ff0000', target: 'pixels' },
    });
  });

  it('pencil uses the hard-edged command and drops hardness/flow', async () => {
    const client = fakeClient(okReply());
    await makeSession(client, 1).stroke([[0, 0]], { ...brush, pencil: true }, 'mask');
    const call = client._calls[0].batch[0];
    expect(call.cmd).toBe('paint.pencil');
    expect(call.params.hardness).toBeUndefined();
    expect(call.params.target).toBe('mask');
  });

  it('eraser sets erase:true', async () => {
    const client = fakeClient(okReply());
    await makeSession(client, 1).stroke([[0, 0]], { ...brush, erase: true }, 'pixels');
    expect(client._calls[0].batch[0].params.erase).toBe(true);
  });

  it('bucket and gradient build their params', async () => {
    const c1 = fakeClient(okReply());
    await makeSession(c1, 1).bucket(5, 6, { tolerance: 40, color: '#00ff00', opacity: 100 }, 'pixels');
    expect(c1._calls[0].batch[0]).toEqual({ cmd: 'paint.bucket', params: { x: 5, y: 6, contiguous: true, tolerance: 40, color: '#00ff00', opacity: 100, target: 'pixels' } });
    const c2 = fakeClient(okReply());
    await makeSession(c2, 1).gradient([0, 0], [100, 0], 'linear', ['#000000', '#ffffff'], 'pixels');
    expect(c2._calls[0].batch[0]).toEqual({ cmd: 'paint.gradient', params: { from: [0, 0], to: [100, 0], style: 'linear', colors: ['#000000', '#ffffff'], target: 'pixels' } });
  });

  it('addMask builds the command id from the kind', async () => {
    const client = fakeClient(okReply());
    await makeSession(client, 1).addMask('hideAll');
    expect(client._calls[0].batch[0]).toEqual({ cmd: 'layer.layerMask.hideAll' });
  });

  it('transformQuad sends rect and quad', async () => {
    const client = fakeClient(okReply());
    await makeSession(client, 1).transformQuad([0, 0, 100, 100], [[0, 0], [120, 0], [120, 100], [0, 100]]);
    expect(client._calls[0].batch[0]).toEqual({ cmd: 'edit.transform', params: { rect: [0, 0, 100, 100], quad: [[0, 0], [120, 0], [120, 100], [0, 100]] } });
  });

  it('transformPreset builds the command id and selects the layer first', async () => {
    const client = fakeClient(okReply());
    await makeSession(client, 1).transformPreset('rotate90Cw', 4);
    expect(client._calls[0].batch).toEqual([
      { cmd: 'layer.select', params: { layer: 4, mode: 'replace' } },
      { cmd: 'edit.transform.rotate90Cw' },
    ]);
  });

  it('transformSelection passes numeric params', async () => {
    const client = fakeClient(okReply());
    await makeSession(client, 1).transformSelection({ rotate: 90, scaleX: 150 });
    expect(client._calls[0].batch[0]).toEqual({ cmd: 'select.transformSelection', params: { rotate: 90, scaleX: 150 } });
  });

  it('cloneStamp selects the layer, sends source and rounds hardness to 0..100', async () => {
    const client = fakeClient(okReply());
    await makeSession(client, 1).cloneStamp([[10, 10]], [20, 20], 8, 0.9, 2);
    expect(client._calls[0].batch).toEqual([
      { cmd: 'layer.select', params: { layer: 2, mode: 'replace' } },
      { cmd: 'paint.cloneStamp', params: { points: [[10, 10]], source: [20, 20], size: 8, hardness: 90, aligned: true } },
    ]);
  });

  it('spotHealing needs no source', async () => {
    const client = fakeClient(okReply());
    await makeSession(client, 1).spotHealing([[5, 5]], 12, 3);
    expect(client._calls[0].batch[1]).toEqual({ cmd: 'paint.spotHealing', params: { points: [[5, 5]], size: 12 } });
  });

  it('contentAwareFill selects the pixel layer first', async () => {
    const client = fakeClient(okReply());
    await makeSession(client, 1).contentAwareFill(7);
    expect(client._calls[0].batch).toEqual([
      { cmd: 'layer.select', params: { layer: 7, mode: 'replace' } },
      { cmd: 'edit.contentAwareFill', params: {} },
    ]);
  });

  it('convertToSmartObject selects the layer then converts', async () => {
    const client = fakeClient(okReply());
    await makeSession(client, 1).convertToSmartObject(5);
    expect(client._calls[0].batch).toEqual([
      { cmd: 'layer.select', params: { layer: 5, mode: 'replace' } },
      { cmd: 'layer.smartObjects.convertToSmartObject' },
    ]);
  });

  it('rasterizeSmartObject and soToLayers use their command ids', async () => {
    const c1 = fakeClient(okReply());
    await makeSession(c1, 1).rasterizeSmartObject(2);
    expect(c1._calls[0].batch[1]).toEqual({ cmd: 'layer.smartObjects.rasterize' });
    const c2 = fakeClient(okReply());
    await makeSession(c2, 1).soToLayers(2);
    expect(c2._calls[0].batch[1]).toEqual({ cmd: 'layer.smartObjects.convertToLayers' });
  });
});

describe('DocSession.request', () => {  it('advances revision on ok', async () => {
    const client = fakeClient([{ ok: true, data: { status: 'ok', revision: 5, results: [{ value: 42 }] } }]);
    const s = makeSession(client, 1);
    const body = await s.request([{ cmd: 'x' }]);
    expect(body.revision).toBe(5);
    expect(s.currentRevision).toBe(5);
  });

  it('throws CONFLICT and realigns revision', async () => {
    const client = fakeClient([{ ok: true, data: { status: 'conflict', revision: 9, results: [] } }]);
    const s = makeSession(client, 2);
    await expect(s.request([{ cmd: 'x' }])).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(s.currentRevision).toBe(9);
  });

  it('throws on error status', async () => {
    const client = fakeClient([{ ok: true, data: { status: 'error', revision: 2, results: [], error: 'bad param' } }]);
    const s = makeSession(client, 2);
    await expect(s.request([{ cmd: 'x' }])).rejects.toThrow('bad param');
  });

  it('sends baseRevision equal to current revision', async () => {
    const client = fakeClient([{ ok: true, data: { status: 'ok', revision: 4, results: [] } }]);
    const s = makeSession(client, 3);
    await s.request([{ cmd: 'x' }]);
    expect(client._calls[0].baseRevision).toBe(3);
  });
});

describe('multi-document bridge events', () => {
  it('docEvents is undefined when nothing happened elsewhere', () => {
    expect(docEvents({ openedDocs: [], closedDocs: [], touchedDocs: [] })).toBeUndefined();
    expect(docEvents(undefined)).toBeUndefined();
  });

  it('reports opened docs from a reply and lets the parent realign its revision', async () => {
    const client = fakeClient([
      { ok: true, data: { status: 'ok', revision: 4, results: [], openedDocs: [{ docId: 'd2', name: 'so.psb', width: 10, height: 10 }], closedDocs: [], touchedDocs: [] } },
      { ok: true, data: { status: 'ok', revision: 9, results: [] } },
    ]);
    const parent = makeSession(client, 3);
    const seen: any[] = [];
    parent.onEvents = (ev) => seen.push(ev);
    await parent.request([{ cmd: 'layer.smartObjects.editContents' }]);
    expect(seen).toHaveLength(1);
    expect(seen[0].openedDocs[0].docId).toBe('d2');

    // A child commit bumped the parent to 7 on the bridge: sync, and the next request sends it.
    parent.syncRevision(7);
    await parent.request([{ cmd: 'doc.inspect' }]);
    expect(client._calls[1].baseRevision).toBe(7);
  });

  it('attached sessions share the client and start at the given revision', async () => {
    const client = fakeClient([{ ok: true, data: { status: 'ok', revision: 1, results: [] } }]);
    const child = DocSession.attach(client, 'd2', 0);
    await child.request([{ cmd: 'doc.inspect' }]);
    expect(client._calls[0].docId).toBe('d2');
    expect(client._calls[0].baseRevision).toBe(0);
  });
});

describe('DocSession.request — observed revision (AI steps)', () => {
  it('sends the caller-pinned baseRevision instead of the session revision', async () => {
    const c = fakeClient([{ ok: true, data: { status: 'conflict', revision: 8, results: [] } }]);
    const s = makeSession(c, 8);
    await expect(s.request([{ cmd: 'layer.translate' }], 'k1', { baseRevision: 5 })).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(c._calls[0]).toMatchObject({ baseRevision: 5, idempotencyKey: 'k1' });
    expect(s.currentRevision).toBe(8);
  });
  it('a replayed reply does not move the session back to the old revision', async () => {
    const c = fakeClient([{ ok: true, data: { status: 'ok', revision: 3, replayed: true, results: [] } }]);
    const s = makeSession(c, 7);
    await s.request([{ cmd: 'layer.translate' }], 'k1');
    expect(s.currentRevision).toBe(7);
  });
});
