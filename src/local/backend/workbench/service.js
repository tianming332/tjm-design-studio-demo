// Design-agent service: workflow-gated agent loop, editor step leases and receipts, confirmation,
// pause / cancel / resume, generations into the participant's asset library. Model turns run
// inline in the request that makes progress (Workers keep no background state between requests).
import { geminiSettings, getStyle, reserveAccessUnits, completeReservation, refundReservation } from '../db.js';
import { generate, collectImageInputs, buildDirectImagePrompt } from '../upstream.js';
import { TOOLS, TOOL_BY_NAME, WORKFLOW_PHASES, canonical, digest, stepDigest, targetLayers, validateCall } from './tools.js';
import { ProviderError } from './gemini.js';
import { agentRouter, vendorImage, decomposeImage, PROVIDER_LABEL } from './providers.js';
import { mockAgentTurn, mockImage } from './mock.js';
import * as S from './store.js';
import { DESIGN_EXECUTION_RULES, needsFinalPreview } from './review.js';

const { wbError, newId } = S;
export const WB_PROTOCOL = 'tjm-wb/0';
const TERMINAL = ['completed', 'failed', 'cancelled'];
const LEASE_MS = 120_000;
const TRANSITIONS = {
  created: ['planning', 'cancelled', 'failed'],
  planning: ['waiting_model', 'waiting_asset', 'waiting_client', 'waiting_confirmation', 'reconciling', 'paused', 'cancelled', 'failed', 'completed'],
  waiting_model: ['planning', 'waiting_client', 'waiting_confirmation', 'waiting_asset', 'reconciling', 'paused', 'cancelled', 'failed', 'completed'],
  waiting_asset: ['planning', 'waiting_client', 'waiting_confirmation', 'reconciling', 'paused', 'cancelled', 'failed'],
  waiting_confirmation: ['waiting_client', 'planning', 'paused', 'cancelled', 'failed'],
  waiting_client: ['executing', 'planning', 'paused', 'reconciling', 'cancelled', 'failed'],
  executing: ['waiting_client', 'waiting_confirmation', 'planning', 'paused', 'reconciling', 'cancelled', 'failed'],
  paused: ['planning', 'waiting_client', 'waiting_confirmation', 'cancelled', 'failed'],
  reconciling: ['planning', 'waiting_client', 'paused', 'cancelled', 'failed'],
  completed: [], failed: [], cancelled: []
};
/** Mock output size for an aspect ratio (long side 1024). */
function ratioSize(ratio) {
  const [w, h] = ratio.split(':').map(Number);
  return w >= h ? `1024x${Math.round(1024 * h / w)}` : `${Math.round(1024 * w / h)}x1024`;
}

/** Probe result counts only for the model and vendor it was run against. */
const verifiedAgent = cfg => cfg.verified.agent?.model === cfg.models.agent && (cfg.verified.agent.provider || 'gemini') === cfg.models.agentProvider;

export function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
/** Steps the server adds on its own (the final full preview) have no model-issued call id: vendors
 *  reject a tool result for a call they never made, so those results go in as plain text. */
export const SYNTHETIC_CALL = 'final-preview-';
export function modelInput(input) {
  return input.map(i => i.type === 'function_result' && String(i.callId).startsWith(SYNTHETIC_CALL)
    ? { type: 'text', text: `系统补充执行的 ${i.name} 结果（不是你发起的调用）：${JSON.stringify(i.result)}` } : i);
}
const PHASE_LABEL = { analyze: '分析需求', assets: '检查素材', skills: '匹配 Skill' };
const PROTOCOL = { mock: 'mock', gemini: 'gemini-interactions/v1beta', openai: 'openai-responses/v1', anthropic: 'anthropic-messages/2023-06-01' };

export function createWorkbench(db, config, opts = {}) {
  const provider = opts.provider ?? (config.geminiMock ? null : agentRouter(db, config));
  const isMock = !provider;

  // --- task context: load, mutate, save with events ------------------------------------------
  async function load(id, actor) {
    const doc = await S.loadTask(db, id);
    if (!doc || doc.task.ownerId !== actor.ownerId) throw wbError('NOT_FOUND', '任务不存在', 404);
    const ctx = { task: doc.task, priv: doc.priv, events: [] };
    const t = ctx.task;
    // A model / image call older than its timeout with no answer: the request died mid-flight.
    if ((t.state === 'waiting_model' || t.state === 'waiting_asset') && Date.now() - t.updatedAt > ((await geminiSettings(db)).timeoutMs || 300000) + 60000) {
      for (const a of t.attempts) if (a.status === 'sent') a.status = 'uncertain';
      t.error = { code: 'UPSTREAM_UNCERTAIN', message: '上次调用没有完成记录，结果不确定；请核对后恢复或取消' };
      transition(ctx, 'reconciling', t.error.message);
      await save(ctx);
    }
    return ctx;
  }
  function event(ctx, type, message, data) {
    const t = ctx.task;
    t.lastSeq += 1;
    ctx.events.push({ seq: t.lastSeq, at: Date.now(), type, message: String(message).slice(0, 2000), ...(data === undefined ? {} : { data }) });
  }
  function transition(ctx, to, message) {
    const t = ctx.task;
    if (t.state === to) return;
    if (!TRANSITIONS[t.state].includes(to)) throw wbError('BAD_STATE', `任务状态 ${t.state} 不能转为 ${to}`, 409);
    const from = t.state;
    t.state = to;
    event(ctx, 'state', message || `${from} → ${to}`, { from, to });
  }
  async function save(ctx) {
    await settleQuota(ctx.task);
    await S.saveTask(db, ctx.task, ctx.priv);
    await S.insertEvents(db, ctx.task.id, ctx.events.splice(0));
  }
  const terminal = t => TERMINAL.includes(t.state);

  async function settleQuota(t) {
    if (!t.quota || t.quota.settled) return;
    if (t.attempts.some(a => a.purpose === 'agent' && a.status === 'ok')) await completeReservation(db, t.quota.requestId);
    else if (terminal(t)) await refundReservation(db, t.quota.requestId);
    else return;
    t.quota.settled = true;
  }

  // --- create ---------------------------------------------------------------------------------
  async function createTask(actor, req) {
    const cfg = await S.workbenchConfig(db);
    if (!cfg.enabled) throw wbError('FORBIDDEN', '设计 Agent 已在后台停用', 403);
    if (req?.protocol !== WB_PROTOCOL) throw wbError('BAD_REQUEST', `协议版本应为 ${WB_PROTOCOL}`);
    const str = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max;
    if (!str(req.requestId, 80) || !/^[A-Za-z0-9:_-]{8,80}$/.test(req.requestId)) throw wbError('BAD_REQUEST', 'requestId 无效');
    if (!str(req.prompt, 4000)) throw wbError('BAD_REQUEST', '任务内容为空或过长');
    const tg = req.target;
    if (!tg || !str(tg.projectRef, 200) || !str(tg.clientSessionId, 80) || !str(tg.docId, 200)) throw wbError('BAD_REQUEST', '目标文档引用不完整');
    if (!Number.isInteger(req.observedRevision) || req.observedRevision < 0) throw wbError('BAD_REQUEST', 'observedRevision 无效');
    if (req.allowedLayers && (!Array.isArray(req.allowedLayers) || req.allowedLayers.some(x => !Number.isInteger(x)))) throw wbError('BAD_REQUEST', 'allowedLayers 无效');
    const reqDigest = await digest(canonical({ ...req, requestId: undefined }));
    const key = `${actor.ownerId}:task:${req.requestId}`;
    const prior = await S.getRequest(db, key);
    if (prior) {
      if (prior.digest !== reqDigest) throw wbError('IDEMPOTENCY_MISMATCH', '同一 requestId 对应了不同的任务内容', 409);
      return (await load(prior.ref, actor)).task;
    }
    if (await S.activeTaskCount(db, actor.ownerId) >= cfg.limits.activeTasksPerParticipant) throw wbError('CONCURRENCY_LIMIT', '已有进行中的设计任务；请先完成、取消或停止它', 429);
    const model = isMock ? 'mock' : cfg.models.agent;
    const vendor = isMock ? 'mock' : cfg.models.agentProvider;
    if (req.model !== undefined && req.model !== model) throw wbError('BAD_REQUEST', '所选模型已在「设置 · AI」中更改，请重新选择', 400);
    if (!model) throw wbError('NOT_CONFIGURED', '请在「设置 · AI」中填写 Key 并选择 Agent 模型', 503);
    const id = newId('tsk');
    const now = Date.now();
    const t = {
      id, runId: newId('run'), applicationId: 'workbench', ownerId: actor.ownerId, state: 'created', prompt: req.prompt,
      target: { projectRef: tg.projectRef, clientSessionId: tg.clientSessionId, docId: tg.docId, ...(tg.name ? { name: String(tg.name).slice(0, 200) } : {}) },
      ...(req.allowedLayers?.length ? { allowedLayers: [...req.allowedLayers] } : {}),
      observedRevision: req.observedRevision,
      pinned: { model, provider: vendor, providerProtocol: PROTOCOL[vendor], mock: isMock },
      phases: { analyze: false, assets: false, skills: false }, analysis: null, skill: null,
      budget: { modelCalls: Math.min(cfg.limits.modelCallsPerTask, req.mode?.maxModelCalls ?? Infinity), modelCallsUsed: 0, generations: cfg.limits.generationsPerTask, generationsUsed: 0, steps: cfg.limits.stepsPerTask, stepsUsed: 0 },
      steps: [], attempts: [], lastSeq: 0, createdAt: now, updatedAt: now, ...(req.parentTaskId ? { parentTaskId: req.parentTaskId } : {})
    };
    // Experience-code quota: one unit per task, settled after the first successful model turn.
    if (actor.issueId) {
      const op = `wb:${id}`;
      await reserveAccessUnits(db, actor.issueId, op, [{ requestId: `${op}:task`, tool: 'workbench', units: 1 }]);
      t.quota = { requestId: `${op}:task`, settled: false };
    }
    const priv = { pendingInput: [{ type: 'text', text: userMessage(t, req) }], invalidRounds: 0, round: 0, mock: {} };
    const ctx = { task: t, priv, events: [] };
    event(ctx, 'created', `任务已创建（${isMock ? '模拟模型' : model}）`, { pinned: t.pinned, budget: t.budget });
    await S.insertTask(db, t, priv);
    await S.insertEvents(db, id, ctx.events.splice(0));
    await S.putRequest(db, key, id, reqDigest);
    await advance(ctx);
    return ctx.task;
  }

  /** Runs model turns until the task needs the browser, the user, or is finished. */
  async function advance(ctx) {
    for (let guard = 0; guard < 24; guard++) {
      const t = ctx.task;
      if (terminal(t)) { await save(ctx); return; }
      if (t.state === 'created') transition(ctx, 'planning', '开始：分析需求');
      if (t.state !== 'planning') { await save(ctx); return; }
      const goOn = await modelTurn(ctx);
      if (!goOn) return;
    }
    await save(ctx);
  }

  /** One agent turn. Returns false when the context was replaced or already saved terminally. */
  async function modelTurn(ctx) {
    const { task: t, priv } = ctx;
    if (t.budget.modelCallsUsed >= t.budget.modelCalls) {
      t.error = { code: 'BUDGET_EXHAUSTED', message: `已达模型调用上限（${t.budget.modelCalls} 次），已停止；已执行的修改保留在历史中` };
      transition(ctx, 'failed', t.error.message);
      await save(ctx);
      return false;
    }
    const cfg = await S.workbenchConfig(db);
    t.budget.modelCallsUsed += 1; // reserved before sending: a lost answer still counts
    const attempt = { id: newId('att'), purpose: 'agent', model: t.pinned.model, mock: isMock, status: 'sent', startedAt: Date.now() };
    t.attempts.push(attempt);
    transition(ctx, 'waiting_model', `调用模型（第 ${t.budget.modelCallsUsed}/${t.budget.modelCalls} 次）`);
    await save(ctx);
    const turnInput = { provider: t.pinned.provider || 'gemini', model: t.pinned.model, system: `${cfg.systemPrompt}\n\n${DESIGN_EXECUTION_RULES}`, tools: TOOLS, input: modelInput(priv.pendingInput), previous: priv.handle, state: priv.providerState, projectId: priv.projectId };
    let out;
    let failure;
    try { out = isMock ? mockAgentTurn(turnInput, priv.mock) : await provider.agentTurn(turnInput); }
    catch (error) { failure = error instanceof ProviderError ? error : new ProviderError({ code: 'UPSTREAM_ERROR', message: String(error.message || error) }); }
    // Someone may have paused / cancelled while we waited: continue on the fresh copy.
    const fresh = await S.loadTask(db, t.id);
    if (fresh.task.rev !== t.rev) { ctx.task = fresh.task; ctx.priv = fresh.priv; }
    const T = ctx.task;
    const A = T.attempts.find(a => a.id === attempt.id);
    A.latencyMs = Date.now() - A.startedAt;
    if (failure) {
      A.status = failure.uncertain ? 'uncertain' : 'error';
      A.error = failure.wb;
      if (terminal(T)) { event(ctx, 'attempt', `取消后在途调用结束：${failure.wb.message}`); await save(ctx); return false; }
      T.error = failure.wb;
      if (failure.uncertain) transition(ctx, 'reconciling', `${failure.wb.message}；不会自动重发，确认后可恢复`);
      else if (failure.wb.code === 'MODEL_LIMIT') transition(ctx, 'paused', failure.wb.message);
      else transition(ctx, 'failed', failure.wb.message);
      await save(ctx);
      return false;
    }
    A.status = 'ok';
    if (out.handle) A.externalId = out.handle;
    if (out.usage) A.usage = out.usage;
    ctx.priv.handle = out.handle;
    if (out.projectId) ctx.priv.projectId = out.projectId;
    if (out.state !== undefined) ctx.priv.providerState = out.state;
    ctx.priv.pendingInput = [];
    if (terminal(T)) { event(ctx, 'attempt', '任务已取消：在途模型结果已记录但不执行'); await save(ctx); return false; }
    if (out.text) event(ctx, 'model', out.text);
    if (!out.calls.length) {
      const lastGoodEdit = T.steps.reduce((last, s, i) => s.where === 'client' && !['doc_read', 'doc_preview'].includes(s.tool) && s.status === 'done' && s.receipt?.status === 'ok' ? i : last, -1);
      const unresolvedEdit = T.steps.find((s, i) => i > lastGoodEdit && s.where === 'client' && !['doc_read', 'doc_preview'].includes(s.tool) && s.status === 'failed'
        && !['REVISION_CONFLICT', 'USER_TAKEOVER'].includes(s.receipt?.error?.code ?? s.error?.code));
      if (T.state !== 'paused' && unresolvedEdit) {
        T.error = { code: 'INCOMPLETE_EDIT', message: `最后的 ${unresolvedEdit.tool} 未执行成功，不能标记设计完成。${unresolvedEdit.receipt?.error?.message ?? unresolvedEdit.error?.message ?? ''}` };
        T.resultText = out.text;
        transition(ctx, 'failed', T.error.message); await save(ctx); return false;
      }
      if (T.state !== 'paused' && needsFinalPreview(T)) {
        ctx.priv.finalPreviewRetries = (ctx.priv.finalPreviewRetries || 0) + 1;
        if (ctx.priv.finalPreviewRetries > 2) {
          T.error = { code: 'FINAL_REVIEW_REQUIRED', message: '最后一次修改尚未通过完整预览核验，未标记完成。请检查画布后继续。' };
          transition(ctx, 'failed', T.error.message); await save(ctx); return false;
        }
        event(ctx, 'review-required', '模型准备结束，但预览早于最后一次修改；补充完整画布检查');
        ctx.priv.pendingInput.push({ type: 'text', text: '系统要求：接下来会提供最后修改后的全画布预览，请检查背景覆盖、主体尺寸、文字遮挡及遗漏。不要把中途预览当最终检查。' });
        await processCalls(ctx, [{ id: `${SYNTHETIC_CALL}${ctx.priv.round}-${ctx.priv.finalPreviewRetries}`, name: 'doc_preview', args: { maxSide: 1024 } }], cfg);
        return true;
      }
      T.resultText = out.text || '（模型未返回说明）';
      T.error = undefined;
      if (T.state !== 'paused') transition(ctx, 'completed', '任务完成');
      await save(ctx);
      return false;
    }
    await processCalls(ctx, out.calls, cfg);
    return true;
  }

  async function processCalls(ctx, calls, cfg) {
    const { task: t, priv } = ctx;
    priv.round += 1;
    let valid = 0;
    const reply = (call, result) => priv.pendingInput.push({ type: 'function_result', callId: call.id, name: call.name, result });
    for (const call of calls) {
      const v = validateCall(call.name, call.args);
      const base = { stepId: newId('stp'), callId: call.id, round: priv.round, tool: call.name, args: call.args ?? {}, inputDigest: await stepDigest(call.name, call.args ?? {}) };
      const reject = error => {
        t.steps.push({ ...base, where: v.ok ? v.tool.where : 'server', status: 'rejected', error });
        reply(call, { ok: false, error });
        event(ctx, 'step-rejected', `${call.name}：${error.message}`, { code: error.code });
      };
      if (!v.ok) { reject(v.error); continue; }
      const tool = v.tool;
      if (t.budget.stepsUsed >= t.budget.steps) { reject({ code: 'BUDGET_EXHAUSTED', message: `单任务步骤上限 ${t.budget.steps}` }); continue; }
      // Workflow gate: no edits or assets before the analysis, asset check and skill match.
      if (tool.kind === 'edit' || tool.kind === 'asset') {
        if (priv.mustReadBeforeEdit) { reject({ code: 'BAD_STATE', message: '用户接管或文档变化后，必须先单独调用 doc_read 重新读取文档，再规划编辑' }); continue; }
        const missing = WORKFLOW_PHASES.filter(p => !t.phases[p]);
        if (missing.length) { reject({ code: 'BAD_STATE', message: `请先完成：${missing.map(p => PHASE_LABEL[p]).join('、')}` }); continue; }
        if (t.skill && !t.skill.tools.includes(tool.name) && !(tool.name === 'layer_fit' && t.skill.tools.includes('asset_import'))) { reject({ code: 'FORBIDDEN', message: `当前 Skill「${t.skill.name}」不允许使用 ${tool.name}` }); continue; }
      }
      if (tool.kind === 'edit' && t.allowedLayers?.length) {
        const outside = targetLayers(v.args).filter(id => !t.allowedLayers.includes(id));
        if (outside.length) { reject({ code: 'FORBIDDEN', message: `图层 ${outside.join(', ')} 不在允许修改的范围内` }); continue; }
      }
      valid++;
      t.budget.stepsUsed += 1;
      const args = tool.name === 'asset_import' && !v.args.role && t.assetRoles?.[v.args.assetId] ? { ...v.args, role: t.assetRoles[v.args.assetId] } : v.args;
      const step = { ...base, inputDigest: await stepDigest(call.name, args), args, where: tool.where, status: 'pending', ...(tool.risk === 'confirm' ? { needsConfirmation: true, confirmed: false } : {}) };
      t.steps.push(step);
      event(ctx, 'step', `计划：${call.name}`, { stepId: step.stepId, tool: call.name, kind: tool.kind, needsConfirmation: !!step.needsConfirmation });
    }
    if (!valid) {
      priv.invalidRounds += 1;
      if (priv.invalidRounds > cfg.limits.invalidCallRounds) {
        t.error = { code: 'INVALID_TOOL_CALL', message: `模型连续 ${priv.invalidRounds} 轮没有返回可执行的调用，已停止` };
        transition(ctx, 'failed', t.error.message);
        return;
      }
    }
    // A pause that arrived during the model call must also prevent new server-side generations.
    if (t.state === 'paused') return;
    for (const step of t.steps.filter(s => s.round === priv.round && s.where === 'server' && s.status === 'pending')) {
      await runServerStep(ctx, step);
      if (ctx.task.state === 'paused' || ctx.task.state === 'reconciling' || terminal(ctx.task)) return;
    }
    settle(ctx);
  }

  async function runServerStep(ctx, step) {
    const { task: t, priv } = ctx;
    const ok = value => { step.status = 'done'; priv.pendingInput.push({ type: 'function_result', callId: step.callId, name: step.tool, result: { ok: true, value } }); };
    const fail = error => { step.status = 'failed'; step.error = error; priv.pendingInput.push({ type: 'function_result', callId: step.callId, name: step.tool, result: { ok: false, error } }); };
    const a = step.args;
    if (step.tool === 'report_analysis') {
      t.analysis = a;
      t.phases.analyze = true;
      event(ctx, 'phase', `分析需求：${a.goal}`, { phase: 'analyze', analysis: a });
      return ok({ recorded: true });
    }
    if (step.tool === 'report_region') {
      t.regionAnalysis = a;
      event(ctx, 'analysis', `分析主体：${a.subject}；光线：${a.lighting}${a.replaceWith ? `；替换为：${a.replaceWith}` : ''}`, { analysis: a });
      return ok({ recorded: true, note: '生图提示词要写进这些分析：同样的光源方向、透视尺度与接触投影；参考图外圈保持原样以便衔接。' });
    }
    if (step.tool === 'report_layers') {
      t.layerPlan = a;
      const count = type => a.items.filter(i => i.type === type).length;
      event(ctx, 'analysis', `拆层规划：${a.items.length} 个元素（文字 ${count('text')}、艺术字 ${count('art-text')}、主体 ${count('subject')}、装饰 ${count('decoration')}、特效 ${count('effect')}、调色 ${count('grade')}）`, { plan: a });
      return ok({ recorded: true, items: a.items.length });
    }
    if (step.tool === 'image_decompose') {
      if (t.budget.generationsUsed >= t.budget.generations) return fail({ code: 'BUDGET_EXHAUSTED', message: `本任务生图上限 ${t.budget.generations} 次` });
      const src = await S.assetBytes(db, a.assetId, t.ownerId).catch(() => null);
      if (!src) return fail({ code: 'NOT_FOUND', message: `素材 ${a.assetId} 不存在` });
      const [rx, ry, rw, rh] = a.rect;
      const norm = ([x, y, w, h]) => [(x - rx) / rw * 1000, (y - ry) / rh * 1000, (x + w - rx) / rw * 1000, (y + h - ry) / rh * 1000].map(v => Math.max(0, Math.min(1000, v)));
      const toDoc = box => box ? [rx + box[0] / 1000 * rw, ry + box[1] / 1000 * rh, (box[2] - box[0]) / 1000 * rw, (box[3] - box[1]) / 1000 * rh].map(Math.round) : a.rect;
      t.budget.generationsUsed += 1;
      let out;
      try {
        out = isMock
          ? { layers: [{ mime: src.rec.mime, bytes: src.bytes, zIndex: 0, box: null, name: '背景（模拟）', description: '模拟模式：原图作为背景层' }] }
          : await decomposeImage(db, config, { model: (await S.workbenchConfig(db)).models.decomposeModel, image: { mime: src.rec.mime, data: toBase64(src.bytes) }, targets: (a.targets || []).map(x => ({ name: x.name, box: norm(x.rect) })) });
      } catch (error) { return fail(error.wb || { code: 'UPSTREAM_ERROR', message: String(error.message || error) }); }
      const cfg = await S.workbenchConfig(db);
      const layers = [];
      for (const l of out.layers) {
        const rec = await S.putAsset(db, t.ownerId, { bytes: l.bytes, mime: l.mime, kind: 'generated', name: `拆层 · ${l.name}`.slice(0, 80), source: { decomposedFrom: a.assetId, taskId: t.id, z: l.zIndex, description: l.description } }, cfg.limits);
        layers.push({ assetId: rec.id, name: l.name, description: l.description, z: l.zIndex, rect: toDoc(l.box), role: l.box ? 'decoration' : 'background' });
      }
      event(ctx, 'asset', `AI 拆层完成：${layers.length} 层已存入素材库`, { assetIds: layers.map(l => l.assetId) });
      return ok({ layers, note: '按 z 从小到大 asset_import(assetId, rect, fit=contain；背景 role=background)。普通文字层改用 text_create 重建并隐藏对应图片层。' });
    }
    if (step.tool === 'assets_list') {
      const assets = (await S.listAssets(db, t.ownerId, 100)).map(r => ({ id: r.id, name: r.name, kind: r.kind, width: r.width, height: r.height, alphaChannel: r.alphaChannel, ...(r.source?.styleName ? { style: r.source.styleName } : {}), ...(r.source?.site ? { site: r.source.site } : {}) }));
      t.phases.assets = true;
      event(ctx, 'phase', `检查素材：素材库 ${assets.length} 张`, { phase: 'assets', count: assets.length });
      return ok({ assets, note: assets.length ? 'kind=upload 为用户自己拖入／上传的素材，优先使用。' : '素材库为空。' });
    }
    if (step.tool === 'skill_list') {
      const words = `${t.prompt} ${a.query || ''}`;
      const skills = (await S.listSkills(db, { publishedOnly: true })).filter(s => !a.category || s.category === a.category).map(s => ({
        slug: s.slug, name: s.name, category: s.category, description: s.description, version: s.version,
        match: s.triggers.split(/[,，\s]+/).filter(w => w && words.includes(w)).length
      })).sort((x, y) => y.match - x.match);
      t.phases.skills = true;
      event(ctx, 'phase', `匹配 Skill：${skills.length} 个可用${skills[0]?.match ? `，最接近「${skills[0].name}」` : ''}`, { phase: 'skills', skills: skills.map(s => s.slug) });
      return ok({ skills });
    }
    if (step.tool === 'skill_load') {
      const skill = await S.publishedSkill(db, a.slug);
      if (!skill) return fail({ code: 'NOT_FOUND', message: `Skill ${a.slug} 不存在或未发布` });
      // Style and purpose skills are guidance layered on top: they never narrow the tool set.
      if (skill.category === 'style' || skill.category === 'purpose') {
        t.guides = [...(t.guides || []).filter(g => g.slug !== skill.slug), { slug: skill.slug, version: skill.version, name: skill.name, category: skill.category }];
        t.phases.skills = true;
        event(ctx, 'skill', `叠加${skill.category === 'style' ? '风格' : '用途约束'}「${skill.name}」v${skill.version}`, { slug: skill.slug, version: skill.version, category: skill.category });
        return ok({ slug: skill.slug, version: skill.version, name: skill.name, category: skill.category, guidance: skill.body, note: '这是叠加约束，不限制工具；按其规则选择版式、配色、字效与尺寸，再配合一个工作流或通用能力 Skill 执行。' });
      }
      t.skill = { slug: skill.slug, version: skill.version, name: skill.name, category: skill.category, tools: skill.tools };
      t.phases.skills = true;
      event(ctx, 'skill', `使用 Skill「${skill.name}」v${skill.version}`, { slug: skill.slug, version: skill.version });
      return ok({ slug: skill.slug, version: skill.version, name: skill.name, steps: `${skill.body}\n\n${DESIGN_EXECUTION_RULES}`, allowedTools: skill.tools.includes('asset_import') ? [...new Set([...skill.tools, 'layer_fit'])] : skill.tools });
    }
    if (step.tool === 'image_generate') {
      if (t.budget.generationsUsed >= t.budget.generations) return fail({ code: 'BUDGET_EXHAUSTED', message: `本任务生图上限 ${t.budget.generations} 次` });
      if (t.state === 'waiting_model' || t.state === 'planning') transition(ctx, 'waiting_asset', '生成素材中');
      t.budget.generationsUsed += 1;
      const attemptId = newId('att');
      t.attempts.push({ id: attemptId, purpose: 'image-generate', status: 'sent', startedAt: Date.now() });
      await save(ctx); // A concurrent pause must see the outstanding image request.
      const g = await generateAsset({ ownerId: t.ownerId, issueId: null }, { requestId: `${t.id}:${step.stepId}`, prompt: a.prompt, styleId: a.styleId, referenceAssetIds: a.referenceAssetIds, size: a.size, ...(a.aspectRatio ? { aspectRatio: a.aspectRatio } : {}), taskId: t.id }, { chargeQuota: false });
      const fresh = await S.loadTask(db, t.id);
      if (fresh.task.rev !== t.rev) { ctx.task = fresh.task; ctx.priv = fresh.priv; }
      const T = ctx.task, P = ctx.priv, current = T.steps.find((s) => s.stepId === step.stepId);
      Object.assign(T.attempts.find((x) => x.id === attemptId), { externalId: g.attemptId, model: g.sent.model, mock: g.sent.mock, status: g.status === 'succeeded' ? 'ok' : g.status === 'uncertain' ? 'uncertain' : 'error' });
      if (terminal(T)) { event(ctx, 'asset', '任务已停止：在途生图结果仅存入素材库，不继续执行'); return; }
      if (g.status === 'uncertain') {
        current.status = 'uncertain';
        T.error = g.error;
        if (T.state !== 'paused') transition(ctx, 'reconciling', `${g.error?.message || '生图结果不确定'}；不会自动重新生成`);
        return;
      }
      if (g.status !== 'succeeded') {
        current.status = 'failed'; current.error = g.error;
        P.pendingInput.push({ type: 'function_result', callId: current.callId, name: current.tool, result: { ok: false, error: g.error } });
        return;
      }
      const role = a.role || (/背景|底图|底纹|\bbackground\b/i.test(a.prompt) ? 'background' : undefined);
      if (role) { T.assetRoles ||= {}; for (const id of g.assetIds) T.assetRoles[id] = role; }
      event(ctx, 'asset', `素材已生成并存入素材库：${g.assetIds.join(', ')}（尚未放入文档）`, { generationId: g.id, assetIds: g.assetIds });
      current.status = 'done';
      P.pendingInput.push({ type: 'function_result', callId: current.callId, name: current.tool, result: { ok: true, value: { generationId: g.id, assetIds: g.assetIds, notes: g.notes } } });
      return;
    }
    return fail({ code: 'NOT_IMPLEMENTED', message: `服务端不执行 ${step.tool}` });
  }

  function nextClientStep(ctx) {
    const { task: t, priv } = ctx;
    return t.steps.find(s => s.round === priv.round && s.where === 'client' && (s.status === 'pending' || s.status === 'leased'));
  }

  function settle(ctx) {
    const t = ctx.task;
    if (terminal(t) || t.state === 'paused' || t.state === 'reconciling') return;
    const next = nextClientStep(ctx);
    if (next?.needsConfirmation && !next.confirmed) transition(ctx, 'waiting_confirmation', `等待确认：${next.tool}`);
    else if (next) { if (t.state !== 'waiting_client') transition(ctx, 'waiting_client', '等待编辑器执行'); }
    else transition(ctx, 'planning', '本轮结果已回传');
  }

  // --- editor side ----------------------------------------------------------------------------
  async function claimStep(actor, taskId, who) {
    const ctx = await load(taskId, actor);
    const t = ctx.task;
    if (who?.clientSessionId !== t.target.clientSessionId || who?.docId !== t.target.docId) throw wbError('TARGET_MISMATCH', '只有任务绑定的文档会话可以执行该任务', 409);
    const none = { step: null, observedRevision: t.observedRevision, state: t.state };
    if (t.state !== 'waiting_client' && t.state !== 'executing') return none;
    const step = nextClientStep(ctx);
    if (!step) return none;
    if (step.status === 'leased') {
      if (step.lease.expiresAt > Date.now()) return none;
      // Lease ran out without a receipt: it may or may not have run. Never hand it out blindly.
      step.status = 'uncertain';
      t.error = { code: 'UPSTREAM_UNCERTAIN', message: `步骤 ${step.tool} 租约过期且无回执，需要核对文档` };
      transition(ctx, 'reconciling', t.error.message);
      await save(ctx);
      return { ...none, state: t.state };
    }
    if (step.needsConfirmation && !step.confirmed) throw wbError('BAD_STATE', '该步骤需要先确认', 409);
    step.status = 'leased';
    step.lease = { id: newId('ls'), clientSessionId: who.clientSessionId, expiresAt: Date.now() + LEASE_MS };
    step.observedRevision = t.observedRevision;
    if (t.state === 'waiting_client') transition(ctx, 'executing', `执行：${step.tool}`);
    await save(ctx);
    return { step, observedRevision: t.observedRevision, state: t.state };
  }

  async function submitResult(actor, taskId, r) {
    const ctx = await load(taskId, actor);
    const t = ctx.task;
    if (JSON.stringify(r ?? {}).length > 8 * 1024 * 1024) throw wbError('BAD_REQUEST', '回执过大', 413);
    const step = t.steps.find(s => s.stepId === r?.stepId);
    if (!step || step.where !== 'client') throw wbError('NOT_FOUND', '步骤不存在', 404);
    if (r.taskId !== t.id || r.runId !== t.runId || r.callId !== step.callId || r.docId !== t.target.docId) throw wbError('TARGET_MISMATCH', '回执与任务／步骤／文档不一致', 409);
    if (r.inputDigest !== step.inputDigest) throw wbError('IDEMPOTENCY_MISMATCH', '回执的输入摘要与步骤不一致', 409);
    if (step.status === 'done' || step.status === 'failed') {
      if (step.receipt?.leaseId === r.leaseId && step.receipt.status === r.status && step.receipt.revisionAfter === r.revisionAfter) return t;
      throw wbError('IDEMPOTENCY_MISMATCH', '该步骤已有不同的回执', 409);
    }
    if (!step.lease || step.lease.id !== r.leaseId || !['leased', 'uncertain'].includes(step.status)) throw wbError('LEASE_INVALID', '租约无效或已被收回', 409);
    if (!['ok', 'error'].includes(r.status) || !Number.isInteger(r.revisionBefore) || !Number.isInteger(r.revisionAfter)) throw wbError('BAD_REQUEST', '回执格式不正确');
    const priv = ctx.priv;
    const late = step.status === 'uncertain';
    const { preview, ...stored } = r;
    step.receipt = { ...stored, ...(preview ? { preview: { revision: preview.revision, width: preview.width, height: preview.height, region: preview.region, scale: preview.scale } } : {}) };
    if (r.status === 'ok') {
      step.status = 'done';
      if (step.tool === 'doc_read') priv.mustReadBeforeEdit = false;
      t.observedRevision = r.revisionAfter;
      if (t.allowedLayers?.length && ['text_create', 'shape_create', 'fill_solid', 'asset_import', 'layer_group', 'text_extrude'].includes(step.tool)) {
        for (const id of r.affectedLayers || []) if (!t.allowedLayers.includes(id)) t.allowedLayers.push(id);
      }
      priv.pendingInput.push({ type: 'function_result', callId: step.callId, name: step.tool, result: { ok: true, revision: r.revisionAfter, value: r.result ?? null, ...(step.receipt.preview ? { preview: step.receipt.preview } : {}) } });
      const img = preview && /^data:(image\/png);base64,([A-Za-z0-9+/=]+)$/.exec(String(preview.dataUrl || ''));
      if (img) priv.pendingInput.push({ type: 'image', mime: img[1], data: img[2] });
      event(ctx, 'receipt', `${step.tool} 已执行（修订 ${r.revisionBefore} → ${r.revisionAfter}）${late ? '（迟到回执，已核对）' : ''}`, { stepId: step.stepId, affectedLayers: r.affectedLayers });
    } else {
      step.status = 'failed';
      const err = r.error || { code: 'ENGINE_ERROR', message: '执行失败' };
      priv.pendingInput.push({ type: 'function_result', callId: step.callId, name: step.tool, result: { ok: false, error: err } });
      event(ctx, 'receipt', `${step.tool} 失败：${err.message}`, { stepId: step.stepId, code: err.code });
      for (const s of t.steps.filter(x => x.round === step.round && x.where === 'client' && x.status === 'pending')) {
        s.status = 'skipped';
        priv.pendingInput.push({ type: 'function_result', callId: s.callId, name: s.tool, result: { ok: false, error: { code: 'BAD_STATE', message: '前一步失败，本步未执行' } } });
      }
      if (err.code === 'REVISION_CONFLICT' || err.code === 'USER_TAKEOVER') {
        t.error = { code: err.code, message: err.code === 'USER_TAKEOVER' ? '用户请求手动接管，AI 写入已暂停；继续后重新读取文档' : '文档在规划后被修改（人工编辑或其他操作），已暂停；继续后将重新读取文档' };
        priv.pendingInput.push({ type: 'text', text: '注意：文档已被用户修改，之前读取的信息已过期。继续前必须重新调用 doc_read。' });
        if (!terminal(t) && t.state !== 'paused') transition(ctx, 'paused', t.error.message);
        await save(ctx);
        return ctx.task;
      }
    }
    if (terminal(t) || t.state === 'paused') { await save(ctx); return ctx.task; }
    if (t.state === 'reconciling') { t.error = undefined; transition(ctx, 'waiting_client', '迟到回执已核对'); }
    settle(ctx);
    await advance(ctx);
    return ctx.task;
  }

  async function confirm(actor, taskId, body) {
    const ctx = await load(taskId, actor);
    const t = ctx.task;
    if (t.state !== 'waiting_confirmation') throw wbError('BAD_STATE', '当前没有等待确认的操作', 409);
    const step = nextClientStep(ctx);
    if (!step || step.stepId !== body?.stepId || step.inputDigest !== body.inputDigest) throw wbError('IDEMPOTENCY_MISMATCH', '确认的操作与当前待确认操作不一致', 409);
    if (body.approve === true) {
      step.confirmed = true;
      transition(ctx, 'waiting_client', `已批准：${step.tool}`);
      await save(ctx);
      return ctx.task;
    }
    step.status = 'rejected';
    ctx.priv.pendingInput.push({ type: 'function_result', callId: step.callId, name: step.tool, result: { ok: false, error: { code: 'FORBIDDEN', message: '用户拒绝了该操作' } } });
    event(ctx, 'confirm', `已拒绝：${step.tool}`);
    settle(ctx);
    await advance(ctx);
    return ctx.task;
  }

  async function pause(actor, taskId) {
    const ctx = await load(taskId, actor);
    if (terminal(ctx.task)) throw wbError('BAD_STATE', '任务已结束', 409);
    transition(ctx, 'paused', '用户暂停');
    await save(ctx);
    return ctx.task;
  }

  async function cancel(actor, taskId) {
    const ctx = await load(taskId, actor);
    const t = ctx.task;
    if (terminal(t)) return t;
    const inflight = t.attempts.filter(a => a.status === 'sent').length;
    for (const s of t.steps) if (s.status === 'pending') s.status = 'skipped';
    transition(ctx, 'cancelled', inflight ? `已取消；${inflight} 个已发出的调用可能仍会计费，其结果只记录不执行` : '已取消；已执行的修改保留在历史中，不自动撤销');
    await save(ctx);
    return ctx.task;
  }

  /** Uncertain upstream calls are re-sent only with explicit consent (retryUncertain). */
  async function resume(actor, taskId, body = {}) {
    const ctx = await load(taskId, actor);
    const t = ctx.task;
    if (t.state !== 'paused' && t.state !== 'reconciling') throw wbError('BAD_STATE', '只有暂停或待核对的任务可以恢复', 409);
    const changed = body.observedRevision !== undefined && body.observedRevision !== t.observedRevision;
    if (body.observedRevision !== undefined) {
      if (!Number.isInteger(body.observedRevision) || body.observedRevision < 0) throw wbError('BAD_REQUEST', 'observedRevision 无效');
      t.observedRevision = body.observedRevision;
    }
    if (t.state === 'paused' && t.attempts.some((a) => a.status === 'sent')) throw wbError('BAD_STATE', '已发出的模型调用尚未结束，请稍后再继续；不会重复发送', 409);
    if (t.state === 'reconciling') {
      const step = t.steps.find(s => s.status === 'uncertain');
      if (step?.where === 'client') {
        // Re-run under the same engine idempotency key: if it already ran, the engine replays it.
        step.status = 'pending';
        step.lease = undefined;
        t.error = undefined;
        transition(ctx, 'waiting_client', `核对：重新提交 ${step.tool}（引擎按幂等键去重）`);
        await save(ctx);
        return ctx.task;
      }
      const uncertainCall = t.attempts.some(a => a.status === 'uncertain' && !a.acknowledged);
      if ((step || uncertainCall) && body.retryUncertain !== true) throw wbError('UPSTREAM_UNCERTAIN', '上一次调用结果不确定，重新发送可能再次计费；确认后选择「重发不确定的调用」', 409);
      for (const a of t.attempts) if (a.status === 'uncertain') a.acknowledged = true;
      t.error = undefined;
      transition(ctx, 'planning', '用户确认重新发送');
      if (step) {
        step.status = 'pending';
        await runServerStep(ctx, step);
        if (ctx.task.state === 'planning') settle(ctx);
      }
      await advance(ctx);
      return ctx.task;
    }
    if (changed || t.error?.code === 'USER_TAKEOVER' || t.error?.code === 'REVISION_CONFLICT') {
      for (const s of t.steps.filter((s) => s.status === 'pending')) {
        s.status = 'skipped';
        ctx.priv.pendingInput.push({ type: 'function_result', callId: s.callId, name: s.tool, result: { ok: false, error: { code: 'REVISION_CONFLICT', message: '手动编辑后旧计划失效，未执行' } } });
      }
      ctx.priv.mustReadBeforeEdit = true;
      ctx.priv.pendingInput.push({ type: 'text', text: '用户修改了文档。恢复前先调用 doc_read，基于最新尺寸、图层和位置重新规划，禁止沿用旧坐标和图层 id。' });
    }
    t.error = undefined;
    if (t.steps.some((s) => s.round === ctx.priv.round && s.where === 'server' && s.status === 'pending')) {
      transition(ctx, 'planning', '恢复待执行的服务端步骤');
      for (const s of t.steps.filter((s) => s.round === ctx.priv.round && s.where === 'server' && s.status === 'pending')) {
        await runServerStep(ctx, s);
        if (ctx.task.state === 'paused' || ctx.task.state === 'reconciling' || terminal(ctx.task)) { await save(ctx); return ctx.task; }
      }
      settle(ctx); await advance(ctx); return ctx.task;
    }
    const next = nextClientStep(ctx);
    if (next) transition(ctx, next.needsConfirmation && !next.confirmed ? 'waiting_confirmation' : 'waiting_client', '已恢复');
    else transition(ctx, 'planning', '已恢复');
    await advance(ctx);
    return ctx.task;
  }

  async function feedback(actor, taskId, body) {
    const parent = (await load(taskId, actor)).task;
    if (!terminal(parent)) throw wbError('BAD_STATE', '任务未结束；请先完成或取消', 409);
    return createTask(actor, { protocol: WB_PROTOCOL, requestId: body?.requestId, prompt: body?.prompt, ...(body?.model ? { model: body.model } : {}), observedRevision: body?.observedRevision, target: body?.target ?? parent.target, parentTaskId: parent.id, ...(parent.allowedLayers ? { allowedLayers: parent.allowedLayers } : {}) });
  }

  // --- generations into the asset library ------------------------------------------------------
  const SIZES = new Set(['1024x1024', '1024x1536', '1536x1024']);
  /** Output controls sent as Interactions `response_format.aspect_ratio / image_size` (vendor docs 2026-10-15). */
  const ASPECT_RATIOS = ['1:1', '2:3', '3:2', '3:4', '4:3', '9:16', '16:9'];
  const IMAGE_SIZES = ['1K', '2K', '4K'];

  /** Style generation (the AIStyle pipeline) → asset in the library. Never touches a document. */
  async function generateAsset(actor, req, { chargeQuota = true } = {}) {
    if (!req || !/^[A-Za-z0-9:_-]{8,160}$/.test(String(req.requestId || ''))) throw wbError('BAD_REQUEST', 'requestId 无效');
    const prompt = String(req.prompt || '').trim();
    if (!prompt || prompt.length > 4000) throw wbError('BAD_REQUEST', '提示词为空或过长');
    if (req.size !== undefined && !SIZES.has(req.size)) throw wbError('BAD_REQUEST', '尺寸只能是 1024x1024 / 1024x1536 / 1536x1024');
    if (req.aspectRatio !== undefined && !ASPECT_RATIOS.includes(req.aspectRatio)) throw wbError('BAD_REQUEST', `比例只能是 ${ASPECT_RATIOS.join(' / ')}`);
    if (req.imageSize !== undefined && !IMAGE_SIZES.includes(req.imageSize)) throw wbError('BAD_REQUEST', `分辨率只能是 ${IMAGE_SIZES.join(' / ')}`);
    const refs = Array.isArray(req.referenceAssetIds) ? req.referenceAssetIds.slice(0, 1) : [];
    const reqDigest = await digest(canonical({ ...req, requestId: undefined }));
    const key = `${actor.ownerId}:gen:${req.requestId}`;
    const prior = await S.getRequest(db, key);
    if (prior) {
      if (prior.digest !== reqDigest) throw wbError('IDEMPOTENCY_MISMATCH', '同一 requestId 对应了不同的生成请求', 409);
      const g = await S.loadGeneration(db, prior.ref, actor.ownerId);
      if (g.status !== 'uncertain') return g; // same intent → same result, never paid twice
    }
    const style = req.styleId ? await getStyle(db, Number(req.styleId), true, true) : { id: 0, name: '', systemPrompt: '', references: [] };
    if (!style) throw wbError('NOT_FOUND', '画风不存在或已停用', 404);
    const reference = refs.length ? await S.assetBytes(db, refs[0], actor.ownerId) : null;
    const gem = await geminiSettings(db);
    const wbModels = (await S.workbenchConfig(db)).models;
    const imageVendor = isMock ? 'mock' : wbModels.imageProvider;
    const configuredModel = isMock ? 'mock' : imageVendor !== 'gemini' ? wbModels.imageModel : (reference || style.references?.length ? gem.editModel : gem.textModel);
    if (req.model !== undefined && req.model !== configuredModel) throw wbError('BAD_REQUEST', '该模型不支持当前输入，或「设置 · AI」中的模型已更改', 400);
    const model = req.model || configuredModel;
    if (!model) throw wbError('NOT_CONFIGURED', '请在「设置 · AI」中设置生图模型', 503);
    const notes = [req.aspectRatio || req.imageSize ? `已发送比例 ${req.aspectRatio ?? '默认'}、分辨率 ${req.imageSize ?? '默认'}（尚未用真实模型验证），以返回图片的实际尺寸为准` : '未指定比例与分辨率，以返回图片的实际尺寸为准'];
    if (style.references?.length) notes.push(`使用画风参考图 ${style.references.length} 张`);
    const g = { id: newId('gen'), requestId: req.requestId, ownerId: actor.ownerId, ...(req.taskId ? { taskId: req.taskId } : {}), status: 'running', request: { ...req, prompt }, sent: { model, provider: imageVendor, mock: isMock, aspectRatio: req.aspectRatio ?? null, imageSize: req.imageSize ?? null, styleId: style.id || null, styleName: style.name || null, references: (style.references?.length || 0) + (reference ? 1 : 0) }, notes, assetIds: [], attemptId: newId('att'), createdAt: Date.now() };
    await S.saveGeneration(db, g);
    await S.putRequest(db, key, g.id, reqDigest);
    const op = `wbgen:${g.id}`;
    let held = false;
    if (chargeQuota && actor.issueId) { await reserveAccessUnits(db, actor.issueId, op, [{ requestId: `${op}:image`, tool: 'workbench-image', units: 1 }]); held = true; }
    try {
      let image;
      if (isMock) image = await mockImage(prompt, req.aspectRatio ? ratioSize(req.aspectRatio) : req.size || '1024x1024');
      else if (imageVendor !== 'gemini') {
        const input = { prompt, imageDataUrl: reference ? `data:${reference.rec.mime};base64,${toBase64(reference.bytes)}` : null };
        image = await vendorImage(db, config, imageVendor, { model, prompt: await buildDirectImagePrompt(db, style, input), aspectRatio: req.aspectRatio, imageSize: req.imageSize, images: await collectImageInputs(style, input) });
      } else {
        const imageDataUrl = reference ? `data:${reference.rec.mime};base64,${toBase64(reference.bytes)}` : null;
        const result = await generate(db, config, style, { prompt, imageDataUrl, geminiApiKey: '' }, { model, aspectRatio: req.aspectRatio, imageSize: req.imageSize });
        const m = /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/.exec(String(result.imageUrl || ''));
        if (!m) throw wbError('UPSTREAM_ERROR', result.text ? `模型未返回图片：${String(result.text).slice(0, 120)}` : '模型未返回图片', 502);
        image = { mime: m[1], bytes: Uint8Array.from(atob(m[2]), c => c.charCodeAt(0)) };
      }
      const cfg = await S.workbenchConfig(db);
      const rec = await S.putAsset(db, actor.ownerId, { bytes: image.bytes, mime: image.mime, kind: 'generated', name: (style.name ? `${style.name} · ` : '') + (String(req.name || '').trim() || prompt).slice(0, 40), source: { generationId: g.id, model, mock: isMock, styleId: style.id || null, styleName: style.name || null, prompt: prompt.slice(0, 500) } }, cfg.limits);
      g.assetIds.push(rec.id);
      g.status = 'succeeded';
      if (held) await completeReservation(db, `${op}:image`);
    } catch (error) {
      const uncertain = error.code === 'upstream_timeout' || error.uncertain;
      g.status = uncertain ? 'uncertain' : 'failed';
      g.error = error.wb || { code: uncertain ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_ERROR', message: String(error.message || error).slice(0, 300) };
      // A timeout may still be billed upstream, but the participant is not charged for no image.
      if (held) await refundReservation(db, `${op}:image`);
    }
    g.updatedAt = Date.now();
    await S.saveGeneration(db, g);
    return g;
  }

  // --- internet material import ---------------------------------------------------------------
  const hostAllowed = (host, hosts) => hosts.some(h => host === h || host.endsWith(`.${h}`));

  /** Fetches an image the user picked on an enabled site. Only that site's image hosts, https,
   *  ≤ 3 redirects re-checked per hop, size-capped. SVG is returned for client-side rasterising. */
  async function importUrl(actor, body, fetchImpl = fetch) {
    const cfg = await S.workbenchConfig(db);
    const site = cfg.sites.find(s => s.id === body?.siteId && s.enabled);
    if (!site) throw wbError('FORBIDDEN', '该网站未在后台开放', 403);
    let url;
    try { url = new URL(String(body.url || '')); } catch { throw wbError('BAD_REQUEST', '图片地址无效'); }
    let response;
    for (let hop = 0; ; hop++) {
      if (url.protocol !== 'https:' || url.username || url.password || !hostAllowed(url.hostname, site.imageHosts || [])) throw wbError('FORBIDDEN', `不允许从 ${url.hostname} 导入（后台为「${site.name}」登记的图片域名：${(site.imageHosts || []).join('、') || '无'}）`, 403);
      response = await fetchImpl(url.href, { redirect: 'manual', headers: { accept: 'image/png,image/jpeg,image/webp,image/svg+xml' } });
      if (response.status >= 300 && response.status < 400 && response.headers.get('location') && hop < 3) { url = new URL(response.headers.get('location'), url); continue; }
      break;
    }
    if (!response.ok) throw wbError('UPSTREAM_ERROR', `图片下载失败（HTTP ${response.status}）`, 502);
    const mime = String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    const max = cfg.limits.maxAssetMb * 1024 * 1024;
    if (Number(response.headers.get('content-length') || 0) > max) throw wbError('BAD_REQUEST', `图片超过 ${cfg.limits.maxAssetMb} MB`, 413);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > max) throw wbError('BAD_REQUEST', `图片超过 ${cfg.limits.maxAssetMb} MB`, 413);
    const source = { site: site.name, siteId: site.id, url: url.href, license: 'unknown', importedAt: new Date().toISOString() };
    if (mime === 'image/svg+xml') {
      if (bytes.length > 2 * 1024 * 1024) throw wbError('BAD_REQUEST', 'SVG 过大', 413);
      return { svg: new TextDecoder().decode(bytes), source };
    }
    const asset = await S.putAsset(db, actor.ownerId, { bytes, mime, kind: 'web', name: decodeURIComponent(url.pathname.split('/').pop() || site.name).slice(0, 80), source }, cfg.limits);
    return { asset };
  }

  async function uploadAsset(actor, body) {
    const cfg = await S.workbenchConfig(db);
    const m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(body?.dataUrl || ''));
    if (!m) throw wbError('BAD_REQUEST', '只接受 PNG／JPEG／WebP 图片');
    const bytes = Uint8Array.from(atob(m[2]), c => c.charCodeAt(0));
    // A rasterised web SVG keeps its site / URL, flagged as claimed by the client.
    const web = body.source?.siteId ? cfg.sites.find(s => s.id === body.source.siteId) : null;
    const source = web ? { site: web.name, siteId: web.id, url: String(body.source.url || '').slice(0, 500), license: 'unknown', rasterizedFrom: 'svg', claimedByClient: true } : { uploadedAt: new Date().toISOString() };
    return S.putAsset(db, actor.ownerId, { bytes, mime: m[1], kind: web ? 'web' : 'upload', name: String(body.name || '').slice(0, 120), source }, cfg.limits);
  }

  // --- reads ----------------------------------------------------------------------------------
  async function capabilities(actor) {
    const cfg = await S.workbenchConfig(db);
    const gem = await geminiSettings(db);
    const option = (id, provider, extra = {}) => ({ id, label: id === 'mock' ? '模拟模型' : id, provider: isMock ? 'mock' : provider, ...extra });
    const imageVendor = cfg.models.imageProvider;
    const imageIds = isMock ? ['mock'] : imageVendor !== 'gemini' ? [cfg.models.imageModel].filter(Boolean) : [...new Set([gem.textModel, gem.editModel].filter(Boolean))];
    const configured = isMock || !!cfg.models.agent;
    return {
      protocol: WB_PROTOCOL, applicationId: 'workbench', mode: 'official', mock: isMock,
      aiEnabled: cfg.enabled && configured && !!actor.issueId,
      reason: !cfg.enabled ? '设计 Agent 已在后台停用' : !configured ? '请在「设置 · AI」中填写 Key 并选择 Agent 模型' : !actor.issueId ? '请先输入体验码' : undefined,
      model: isMock ? 'mock' : cfg.models.agent || null, provider: isMock ? 'mock' : cfg.models.agentProvider, verified: !isMock && verifiedAgent(cfg),
      models: {
        agent: configured ? [option(isMock ? 'mock' : cfg.models.agent, cfg.models.agentProvider)] : [],
        image: imageIds.map(id => option(id, imageVendor, imageVendor !== 'gemini' ? { supportsText: true, supportsReferences: imageVendor !== 'glm' } : { supportsText: isMock || id === gem.textModel, supportsReferences: isMock || id === gem.editModel })),
      },
      imageOptions: { aspectRatios: ASPECT_RATIOS, imageSizes: IMAGE_SIZES },
      imageEnabled: cfg.enabled && imageIds.length > 0 && !!actor.issueId,
      tools: TOOLS.map(t => ({ name: t.name, kind: t.kind, risk: t.risk })),
      limits: cfg.limits,
      sites: cfg.sites.filter(s => s.enabled).map(({ id, name, url, note }) => ({ id, name, url, note })),
      closed: ['resource-connector-api', 'code-execution', 'multi-agent', 'event-streaming', 'auto-layer-split']
    };
  }

  async function events(actor, taskId, after) {
    const { task } = await load(taskId, actor);
    return { events: await S.listEvents(db, task.id, after), lastSeq: task.lastSeq, state: task.state };
  }

  /** B0 probe against the bound agent model: one function-call round trip + image understanding. */
  async function probe() {
    const cfg = await S.workbenchConfig(db);
    const model = isMock ? 'mock' : cfg.models.agent;
    const vendor = isMock ? 'mock' : cfg.models.agentProvider;
    if (!model) throw wbError('NOT_CONFIGURED', '先为设计 Agent 填写模型 ID', 400);
    const echo = { name: 'probe_echo', description: '把 value 原样返回。', params: { type: 'object', properties: { value: { type: 'string', maxLength: 40 } }, required: ['value'] } };
    const turn = input => isMock ? mockAgentTurn(input, {}) : provider.agentTurn({ provider: vendor, ...input });
    const checks = [];
    const run = async (name, fn) => { const t0 = Date.now(); try { checks.push({ name, ok: true, detail: await fn(), latencyMs: Date.now() - t0 }); } catch (e) { checks.push({ name, ok: false, detail: e.wb?.message || String(e.message || e), latencyMs: Date.now() - t0 }); } };
    await run('function-call 往返', async () => {
      const first = await turn({ model, system: '你是接口测试。必须调用 probe_echo，value 为 "tjm-b0"。', tools: [echo], input: [{ type: 'text', text: '开始测试' }] });
      const call = first.calls.find(c => c.name === 'probe_echo');
      if (!call) throw new Error(`未返回 function_call（文字：${String(first.text).slice(0, 80)}）`);
      if (call.args?.value !== 'tjm-b0') throw new Error(`参数不符：${JSON.stringify(call.args)}`);
      const second = await turn({ model, system: '用一句话确认收到结果。', tools: [echo], input: [{ type: 'function_result', callId: call.id, name: call.name, result: { value: 'tjm-b0' } }], previous: first.handle, state: first.state, projectId: first.projectId });
      if (!second.text) throw new Error('第二轮未返回文字');
      return `call_id=${call.id}；第二轮：${String(second.text).slice(0, 60)}`;
    });
    await run('图像理解', async () => {
      const { encodePng } = await import('./mock.js');
      const red = toBase64(await encodePng(64, 64, () => [220, 30, 30, 255]));
      const out = await turn({ model, system: '只回答颜色名称。', tools: [], input: [{ type: 'text', text: '这张图主要是什么颜色？' }, { type: 'image', mime: 'image/png', data: red }] });
      if (!out.text) throw new Error('未返回文字');
      return String(out.text).slice(0, 60);
    });
    const ok = checks.every(c => c.ok);
    if (ok && !isMock) await S.saveWorkbenchSetting(db, 'workbench_verified', { ...cfg.verified, agent: { model, provider: vendor, at: Date.now() } });
    return { model, provider: vendor, providerLabel: PROVIDER_LABEL[vendor] || vendor, mock: isMock, ok, verified: ok && !isMock, checks };
  }

  return {
    createTask, claimStep, submitResult, confirm, pause, cancel, resume, feedback, generateAsset, importUrl, uploadAsset,
    capabilities, events, probe, isMock,
    getTask: async (actor, id) => (await load(id, actor)).task,
    listTasks: actor => S.listTasks(db, actor.ownerId),
    generation: (actor, id) => S.loadGeneration(db, id, actor.ownerId)
  };
}

function userMessage(t, req) {
  return JSON.stringify({
    task: req.prompt,
    targetDocument: { name: t.target.name, docId: t.target.docId, observedRevision: t.observedRevision },
    allowedLayers: t.allowedLayers ?? '整个文档',
    note: 'task 是用户原话；按工作流先 report_analysis，再 assets_list 与 doc_read，再 skill_list。'
  });
}

export { TOOL_BY_NAME };
