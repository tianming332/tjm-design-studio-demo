// Deterministic mock for TJM_GEMINI_MOCK=1 (local smoke only). It walks the real workflow —
// analysis → assets → skills → document → edit → preview — and everything it produces is
// flagged mock. Never evidence of real model quality or cost.

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
const crc32 = bytes => { let c = 0xffffffff; for (const x of bytes) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

async function deflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Minimal RGBA PNG encoder (real, decodable). */
export async function encodePng(width, height, pixel) {
  const raw = new Uint8Array((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) raw.set(pixel(x, y), y * (width * 4 + 1) + 1 + x * 4);
  const chunk = (type, data) => {
    const out = new Uint8Array(12 + data.length);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, data.length);
    out.set([...type].map(c => c.charCodeAt(0)), 4);
    out.set(data, 8);
    dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
    return out;
  };
  const ihdr = new Uint8Array(13);
  new DataView(ihdr.buffer).setUint32(0, width);
  new DataView(ihdr.buffer).setUint32(4, height);
  ihdr[8] = 8; ihdr[9] = 6;
  const parts = [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', await deflate(raw)), chunk('IEND', new Uint8Array())];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

export async function mockImage(prompt, size = '1024x1024') {
  const [w, h] = size.split('x').map(Number).map(v => Math.max(64, Math.round(v / 4)));
  let seed = 0;
  for (const ch of String(prompt)) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  const base = [60 + (seed % 120), 90 + ((seed >> 8) % 100), 140 + ((seed >> 16) % 100)];
  return { mime: 'image/png', bytes: await encodePng(w, h, (x, y) => [base[0] + Math.round((x / w) * 60), base[1], base[2] - Math.round((y / h) * 60), 255]) };
}

/** Next mock step from what the conversation already contains (state lives in the task). */
export function mockAgentTurn({ input, previous, tools }, memory) {
  const handle = `mock-${(memory.n = (memory.n || 0) + 1)}`;
  const say = (text, calls = []) => ({ calls: calls.map(([name, args], i) => ({ id: `${handle}-${i}`, name, args })), text, handle, usage: { totalTokens: 0 }, latencyMs: 1 });
  if (!tools.length) return say('（模拟）红色');
  if (tools.some(t => t.name === 'probe_echo')) return input.some(i => i.type === 'function_result') ? say('（模拟）已收到 tjm-b0') : say('', [['probe_echo', { value: 'tjm-b0' }]]);
  if (!previous) {
    try { memory.task = String(JSON.parse(input.find(i => i.type === 'text')?.text || '{}').task || ''); } catch { memory.task = ''; }
  }
  // The editor prefixes the brief with workflow instructions; the mock reacts to the user's own words.
  const prompt = (memory.task || '').split('用户需求：').pop().trim();
  const results = Object.fromEntries(input.filter(i => i.type === 'function_result').map(i => [i.name, i.result]));
  const failed = Object.entries(results).find(([, r]) => r?.ok === false && !/前一步失败/.test(r?.error?.message || ''));
  if (failed) { memory.done = true; return say(`（模拟）${failed[0]} 未成功：${failed[1].error?.message}。已停止，请查看后重试。`); }
  const stage = memory.stage || 'start';
  const wantsBackground = /生成|背景|素材图/.test(prompt);
  const wantsFx = /立体字|特效字|艺术字|霓虹|金属字|金色字/.test(prompt);
  const wantsSplit = /拆层|分层|拆解|拆成图层/.test(prompt);
  const wantsReplace = /已框选/.test(prompt) && /换成|替换|改成/.test(prompt);
  if (stage === 'start') { memory.stage = 'analyzed'; return say('（模拟）分析需求。', [['report_analysis', { goal: prompt.slice(0, 200) || '按用户要求修改文档', deliverable: '可编辑的海报文档', keepUnchanged: ['用户提供的素材'] }]]); }
  if (stage === 'analyzed') { memory.stage = 'assets'; return say('（模拟）检查素材库与文档。', [['assets_list', {}], ['doc_read', {}]]); }
  if (stage === 'assets') {
    memory.assets = results.assets_list?.value?.assets ?? [];
    memory.doc = results.doc_read?.value ?? {};
    memory.stage = 'skills';
    return say('（模拟）查找 Skill。', [['skill_list', { query: prompt.slice(0, 100) }]]);
  }
  if (stage === 'skills') {
    const slug = wantsReplace ? 'region-edit' : wantsSplit ? 'layer-decompose' : wantsFx ? 'text-effects' : wantsBackground ? 'generate-background' : /只改|修改|调整|改成/.test(prompt) ? 'scoped-revision' : 'poster-from-assets';
    const known = (results.skill_list?.value?.skills ?? []).some(s => s.slug === slug);
    memory.stage = 'loaded';
    if (known) return say(`（模拟）使用 Skill ${slug}。`, [['skill_load', { slug }]]);
  }
  const w = memory.doc?.width ?? 1000, h = memory.doc?.height ?? 1000;
  if (memory.stage === 'loaded') {
    memory.stage = 'edited';
    const calls = [];
    if (wantsReplace) { memory.stage = 'captured'; return say('（模拟）截取选区作为参考。', [['region_capture', {}]]); }
    const flatDoc = (ls = []) => ls.flatMap(l => [l, ...flatDoc(l.children)]);
    const existingTitle = flatDoc(memory.doc?.layers).find(l => l.kind === 'Type');
    if (/只改|修改|调整|改成/.test(prompt) && existingTitle) {
      const color = /红/.test(prompt) ? '#d62828' : /蓝/.test(prompt) ? '#1f6feb' : /绿/.test(prompt) ? '#2b8a3e' : '#222222';
      return say('（模拟）只改目标文字的颜色。', [['text_style', { layer: existingTitle.id, color }]]);
    }
    if (wantsSplit) {
      // The mock cannot read the image; it walks the subject/background half of the skill.
      const flat = (ls = []) => ls.flatMap(l => [l, ...flat(l.children)]);
      const layer = flat(memory.doc?.layers).find(l => l.kind === 'Pixel')?.id ?? 1;
      return say('（模拟）抠出主体并补全背景。', [
        ['region_select', { method: 'subject', layer }],
        ['region_apply', { op: 'cutout', layer }],
        ['region_apply', { op: 'remove', layer }],
        ['layer_props', { layer, visible: false }],
      ]);
    }
    if (wantsFx) {
      memory.stage = 'fx';
      const title = /[「“"]([^」”"]{1,60})[」”"]/.exec(prompt)?.[1] ?? '立体字';
      return say('（模拟）新建标题文字。', [['text_create', { text: title, x: Math.round(w * 0.12), y: Math.round(h * 0.35), size: Math.max(24, Math.round(h / 7)), color: '#ffcc33' }]]);
    }
    if (wantsBackground) { memory.stage = 'generated'; return say('（模拟）生成背景素材。', [['image_generate', { prompt: `mock background: ${prompt.slice(0, 200)}`, size: w > h ? '1536x1024' : h > w ? '1024x1536' : '1024x1024' }]]); }
    const userAsset = memory.assets.find(a => a.kind === 'upload');
    if (userAsset) calls.push(['asset_import', { assetId: userAsset.id, name: userAsset.name || '用户素材', centerX: Math.round(w / 2), centerY: Math.round(h * 0.6) }]);
    const title = /[「“"]([^」”"]{1,60})[」”"]/.exec(prompt)?.[1] ?? '标题';
    calls.push(['text_create', { text: title, x: Math.round(w * 0.1), y: Math.round(h * 0.2), size: Math.max(12, Math.round(h / 12)), color: '#222222' }]);
    return say('（模拟）放置素材与标题。', calls);
  }
  if (memory.stage === 'captured') {
    const cap = results.region_capture?.value;
    if (!cap?.assetId) { memory.done = true; return say('（模拟）没有截到选区，结束。'); }
    memory.capture = cap;
    memory.stage = 'patched';
    return say('（模拟）按选区生成替换内容。', [['image_generate', { prompt: `mock replace: ${prompt.slice(0, 200)}`, referenceAssetIds: [cap.assetId], aspectRatio: cap.aspectRatio }]]);
  }
  if (memory.stage === 'patched') {
    const assetId = results.image_generate?.value?.assetIds?.[0];
    memory.stage = 'placed';
    if (!assetId) { memory.done = true; return say('（模拟）没有生成结果，结束。'); }
    return say('（模拟）放回原位。', [['asset_import', { assetId, name: 'AI 替换（模拟）', role: 'subject', fit: 'cover', rect: memory.capture.rect }]]);
  }
  if (memory.stage === 'placed') {
    const layer = results.asset_import?.value?.layer;
    memory.stage = 'linted';
    return say('（模拟）限制在选区内并检查。', [['region_mask', { layer }], ['doc_lint', {}]]);
  }
  if (memory.stage === 'linted') { memory.stage = 'edited'; }
  if (memory.stage === 'fx') {
    const layer = results.text_create?.value?.layers?.[0];
    memory.stage = 'edited';
    if (typeof layer !== 'number') { memory.done = true; return say('（模拟）没有拿到文字图层，结束。'); }
    const preset = /霓虹/.test(prompt) ? 'neon' : 'gold';
    return say('（模拟）放进标题区，加特效与弧形，再做出厚度。', [
      ['text_fit', { layer, box: [Math.round(w * 0.08), Math.round(h * 0.28), Math.round(w * 0.84), Math.round(h * 0.22)], align: 'center' }],
      ['text_fx_apply', { layer, preset, warp: { style: 'arc', bend: 25 } }],
      ['text_extrude', { layer, sideColor: '#7a4f00', angle: 60 }],
    ]);
  }
  if (memory.stage === 'generated') {
    const assetId = results.image_generate?.value?.assetIds?.[0];
    memory.stage = 'edited';
    if (!assetId) { memory.done = true; return say('（模拟）没有拿到素材，结束。'); }
    return say('（模拟）导入背景并置底。', [['asset_import', { assetId, name: 'AI 背景（模拟）' }]]);
  }
  if (memory.stage === 'edited') { memory.stage = 'previewed'; return say('（模拟）检查预览。', [['doc_preview', { maxSide: 256 }]]); }
  memory.done = true;
  return say('（模拟）已完成：按工作流分析需求、检查素材、使用 Skill 并执行修改。这是模拟结果，不代表真实模型效果。');
}
