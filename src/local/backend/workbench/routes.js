// HTTP routes for the design workbench. Public: /api/workbench/* (experience-code participants);
// admin: /admin/api/workbench/* (existing admin session). Helpers come from routes.js so cookies,
// origin checks, JSON parsing and error format stay identical to the other two tools.
import { createWorkbench } from './service.js';
import { TOOLS } from './tools.js';
import * as S from './store.js';
import { distillTask } from './distill.js';
import { AGENT_PROVIDERS, IMAGE_PROVIDERS, publicVendors, discoverModels, modelRegistry, saveModelRegistry } from './providers.js';
import { saveKey, removeKey } from './keys.js';

const { wbError } = S;
const instances = new WeakMap();
const seeded = new WeakSet();

async function service(db, config) {
  if (!seeded.has(db)) { await S.seedSkills(db); seeded.add(db); }
  const key = db;
  if (!instances.has(key)) instances.set(key, new Map());
  const byMode = instances.get(key);
  const mode = config.geminiMock ? 'mock' : 'real';
  if (!byMode.has(mode)) byMode.set(mode, createWorkbench(db, config));
  return byMode.get(mode);
}

/** Local edition: one participant per browser; there are no experience codes or cookies. */
function participant() {
  return { actor: { ownerId: 'wb:local', issueId: 1, admin: false } };
}

export async function workbenchPublicRoutes(request, url, db, config, h) {
  if (!url.pathname.startsWith('/api/workbench/')) return null;
  const wb = await service(db, config);
  const { actor, cookie } = participant(request, config, h);
  const headers = cookie ? { 'set-cookie': cookie } : {};
  const ok = data => h.json(200, { data }, headers);
  const p = url.pathname.slice('/api/workbench/'.length).split('/').filter(Boolean);
  const m = request.method;
  if (p[0] === 'capabilities' && m === 'GET') return ok(await wb.capabilities(actor));
  if (p[0] === 'session' && m === 'GET') return ok({ participant: !!actor.ownerId, quota: await h.accessQuota(db, actor.issueId) });
  if (!actor.ownerId) throw wbError('ACCESS_REQUIRED', '请先输入体验码', 403);
  const body = ['POST', 'PUT'].includes(m) ? await h.readJson(request, 30 * 1024 * 1024) : undefined;

  if (p[0] === 'tasks') {
    if (!p[1] && m === 'POST') return ok(await wb.createTask(actor, body));
    if (!p[1] && m === 'GET') return ok(await wb.listTasks(actor));
    const id = p[1];
    if (!p[2] && m === 'GET') return ok(await wb.getTask(actor, id));
    if (p[2] === 'events' && m === 'GET') return ok(await wb.events(actor, id, Number(url.searchParams.get('after') || 0) || 0));
    if (m === 'POST') {
      if (p[2] === 'claim-step') return ok(await wb.claimStep(actor, id, body));
      if (p[2] === 'tool-results') return ok(await wb.submitResult(actor, id, body));
      if (p[2] === 'confirm') return ok(await wb.confirm(actor, id, body));
      if (p[2] === 'pause') return ok(await wb.pause(actor, id));
      if (p[2] === 'cancel') return ok(await wb.cancel(actor, id));
      if (p[2] === 'resume') return ok(await wb.resume(actor, id, body || {}));
      if (p[2] === 'feedback') return ok(await wb.feedback(actor, id, body));
    }
  }
  if (p[0] === 'assets') {
    if (!p[1] && m === 'GET') return ok(await S.listAssets(db, actor.ownerId));
    if (!p[1] && m === 'POST') return ok(await wb.uploadAsset(actor, body));
    if (p[1] === 'import-url' && m === 'POST') return ok(await wb.importUrl(actor, body));
    if (p[1] && !p[2] && m === 'GET') return ok(await S.getAsset(db, p[1], actor.ownerId));
    if (p[1] && !p[2] && m === 'DELETE') { await S.deleteAsset(db, p[1], actor.ownerId); return ok({ deleted: true }); }
    if (p[1] && p[2] === 'content' && m === 'GET') {
      const { rec, bytes } = await S.assetBytes(db, p[1], actor.ownerId);
      return new Response(bytes, { status: 200, headers: { 'content-type': rec.mime, 'content-length': String(bytes.length), 'cache-control': 'private, max-age=31536000, immutable', 'x-content-type-options': 'nosniff', 'cross-origin-resource-policy': 'same-origin', 'content-security-policy': "default-src 'none'", ...headers } });
    }
  }
  if (p[0] === 'generations') {
    if (!p[1] && m === 'POST') return ok(await wb.generateAsset(actor, body));
    if (p[1] && m === 'GET') return ok(await wb.generation(actor, p[1]));
  }
  throw wbError('NOT_FOUND', '接口不存在', 404);
}

export async function workbenchAdminRoutes(request, url, db, config, h) {
  if (!url.pathname.startsWith('/admin/api/workbench/')) return null;
  const wb = await service(db, config);
  const p = url.pathname.slice('/admin/api/workbench/'.length).split('/').filter(Boolean);
  const m = request.method;
  const ok = data => h.json(200, { data });
  const body = ['POST', 'PUT'].includes(m) ? await h.readJson(request, 512 * 1024) : undefined;
  const state = async () => ({ config: await S.workbenchConfig(db), modelCallTiers: S.MODEL_CALL_TIERS, mock: wb.isMock, skills: await S.listSkills(db), tools: TOOLS.map(t => ({ name: t.name, kind: t.kind, risk: t.risk, description: t.description })), tasks: await S.listTasks(db, null, 30), vendors: await publicVendors(db, config.dataEncryptionKey), models: await modelRegistry(db) });
  if (p[0] === 'state' && m === 'GET') return ok(await state());
  if (p[0] === 'config' && m === 'PUT') {
    if (body.enabled !== undefined) await S.saveWorkbenchSetting(db, 'workbench_enabled', body.enabled === false ? '0' : '1');
    if (body.models) {
      const current = (await S.workbenchConfig(db)).models;
      const next = { ...current };
      for (const purpose of ['agent', 'vision-review', 'openaiImage', 'imageModel', 'decomposeModel']) {
        if (body.models[purpose] === undefined) continue;
        const v = String(body.models[purpose] || '').trim();
        if (v && !/^[a-zA-Z0-9_.:\/-]{2,120}$/.test(v)) throw wbError('BAD_REQUEST', `模型名称无效：${v}`);
        next[purpose] = v;
      }
      if (body.models.agentProvider !== undefined) {
        if (!AGENT_PROVIDERS.includes(body.models.agentProvider)) throw wbError('BAD_REQUEST', `Agent 服务商只能是 ${AGENT_PROVIDERS.join(' / ')}`);
        next.agentProvider = body.models.agentProvider;
      }
      if (body.models.imageProvider !== undefined) {
        if (!IMAGE_PROVIDERS.includes(body.models.imageProvider)) throw wbError('BAD_REQUEST', `生图服务商只能是 ${IMAGE_PROVIDERS.join(' / ')}`);
        next.imageProvider = body.models.imageProvider;
      }
      await S.saveWorkbenchSetting(db, 'workbench_models', next);
      const cfg = await S.workbenchConfig(db);
      const verified = cfg.verified;
      if (verified.agent && (verified.agent.model !== cfg.models.agent || (verified.agent.provider || 'gemini') !== cfg.models.agentProvider)) { delete verified.agent; await S.saveWorkbenchSetting(db, 'workbench_verified', verified); }
    }
    if (body.limits) {
      const limits = { ...(await S.workbenchConfig(db)).limits };
      for (const [k, v] of Object.entries(body.limits)) {
        if (!(k in S.DEFAULT_LIMITS) || !Number.isInteger(v) || v < 0 || v > 100000) throw wbError('BAD_REQUEST', `限额 ${k} 无效`);
        if (k === 'modelCallsPerTask' && !S.MODEL_CALL_TIERS.includes(v)) throw wbError('BAD_REQUEST', `模型调用上限只能选 ${S.MODEL_CALL_TIERS.join(' / ')} 次`);
        limits[k] = v;
      }
      await S.saveWorkbenchSetting(db, 'workbench_limits', limits);
    }
    if (body.systemPrompt !== undefined) {
      const text = String(body.systemPrompt).trim();
      if (text.length > 12000) throw wbError('BAD_REQUEST', '系统提示词不能超过 12000 字');
      await S.saveWorkbenchSetting(db, 'workbench_system_prompt', text);
    }
    if (body.sites) await S.saveWorkbenchSetting(db, 'workbench_sites', validateSites(body.sites));
    await h.audit(db, 'workbench.config.updated');
    return ok(await state());
  }
  const vendorError = e => { throw e.wb ? wbError(e.wb.code, e.wb.message, e.wb.code === 'BAD_REQUEST' ? 400 : 502) : e; };
  // Key pools: POST adds, PUT /:id updates (name / weight / enabled / replace key), DELETE /:id removes.
  if (p[0] === 'providers' && AGENT_PROVIDERS.includes(p[1]) && p[2] === 'keys') {
    if (!p[3] && m === 'POST') { const id = await saveKey(db, p[1], body || {}, config.dataEncryptionKey).catch(vendorError); await h.audit(db, 'provider.key.added', `${p[1]};id=${id}`); return ok(await state()); }
    if (p[3] && m === 'PUT') { await saveKey(db, p[1], { ...(body || {}), id: Number(p[3]) }, config.dataEncryptionKey).catch(vendorError); await h.audit(db, 'provider.key.updated', `${p[1]};id=${p[3]};key=${body?.apiKey ? 'replaced' : 'kept'}`); return ok(await state()); }
    if (p[3] && m === 'DELETE') { await removeKey(db, p[1], p[3]); await h.audit(db, 'provider.key.removed', `${p[1]};id=${p[3]}`); return ok(await state()); }
  }
  // Lists the official models with the saved key: the key test and the model picker in one call.
  if (p[0] === 'providers' && AGENT_PROVIDERS.includes(p[1]) && p[2] === 'models' && m === 'POST') {
    const r = await discoverModels(db, config, p[1]).catch(vendorError);
    await h.audit(db, 'workbench.provider.tested', `${p[1]};models=${r.models.length}`);
    return ok(r);
  }
  if (p[0] === 'models' && !p[1] && m === 'PUT') {
    await saveModelRegistry(db, body?.models).catch(vendorError);
    await h.audit(db, 'models.registry.updated', `count=${body.models.length}`);
    return ok(await state());
  }
  if (p[0] === 'probe' && m === 'POST') { const r = await wb.probe(); await h.audit(db, 'workbench.probe', `ok=${r.ok};mock=${r.mock}`); return ok(r); }
  if (p[0] === 'skills') {
    const known = new Set(TOOLS.map(t => t.name));
    if (!p[1] && m === 'POST') { const s = await S.saveSkill(db, body, known); await h.audit(db, 'workbench.skill.saved', s.slug); return ok(s); }
    const id = Number(p[1]);
    if (id && !p[2] && m === 'PUT') { const s = await S.saveSkill(db, { ...body, id }, known); await h.audit(db, 'workbench.skill.saved', s.slug); return ok(s); }
    if (id && p[2] === 'publish' && m === 'POST') { const s = await S.publishSkill(db, id); await h.audit(db, 'workbench.skill.published', `${s.slug}@${s.version}`); return ok(s); }
    if (id && p[2] === 'status' && m === 'PUT') return ok(await S.setSkillStatus(db, id, body.status));
  }
  if (p[0] === 'tasks' && p[1] && p[2] === 'distill' && m === 'POST') {
    const doc = await S.loadTask(db, p[1]);
    if (!doc) throw wbError('NOT_FOUND', '任务不存在', 404);
    let draft;
    try { draft = distillTask(doc.task, body || {}); } catch (e) { throw e.wb ? wbError(e.wb.code, e.wb.message) : e; }
    if (body?.dryRun) return ok({ draft });
    const s = await S.saveSkill(db, draft, new Set(TOOLS.map(t => t.name)));
    await h.audit(db, 'workbench.skill.distilled', `${s.slug}<-${doc.task.id}`);
    return ok(s);
  }
  if (p[0] === 'tasks' && p[1] && m === 'GET') {
    const doc = await S.loadTask(db, p[1]);
    if (!doc) throw wbError('NOT_FOUND', '任务不存在', 404);
    return ok({ task: doc.task, events: await S.listEvents(db, p[1], 0) });
  }
  throw wbError('NOT_FOUND', '管理接口不存在', 404);
}

function validateSites(sites) {
  if (!Array.isArray(sites) || sites.length > 40) throw wbError('BAD_REQUEST', '网站列表无效');
  return sites.map(s => {
    const id = String(s.id || '').trim();
    if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(id)) throw wbError('BAD_REQUEST', `网站 id 无效：${id}`);
    let url;
    try { url = new URL(String(s.url)); } catch { throw wbError('BAD_REQUEST', `网站地址无效：${s.url}`); }
    if (url.protocol !== 'https:') throw wbError('BAD_REQUEST', '网站地址必须是 https');
    const imageHosts = (Array.isArray(s.imageHosts) ? s.imageHosts : String(s.imageHosts || '').split(/[,，\s]+/)).map(x => String(x).trim().toLowerCase()).filter(Boolean);
    for (const host of imageHosts) if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host)) throw wbError('BAD_REQUEST', `图片域名无效：${host}`);
    return { id, name: String(s.name || id).slice(0, 40), url: url.href, imageHosts, enabled: s.enabled !== false, note: String(s.note || '').slice(0, 120) };
  });
}
