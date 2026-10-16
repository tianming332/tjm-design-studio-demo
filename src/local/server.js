// The local edition's "backend": the Admin workbench routes run inside this page. A fetch
// interceptor answers /api/* and /admin/api/workbench/* from the local database, and the model
// adapters call Gemini / OpenAI / Anthropic directly with the user's own keys.
import { openLocalStore } from './sqlite-store.js';
import { workbenchPublicRoutes, workbenchAdminRoutes } from './backend/workbench/routes.js';
import { listStyles, LOCAL_QUOTA, geminiSettings, setSetting } from './backend/db.js';

const MODEL_ID = /^[a-zA-Z0-9_.:-]{2,120}$/;

// `?mock=1` runs the built-in simulated model: try the agent workflow without any key (also used by tests).
const config = { dataEncryptionKey: 'local', sessionSecret: 'local', geminiMock: typeof location !== 'undefined' && new URLSearchParams(location.search).has('mock') };

const json = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...headers } });
const h = {
  json,
  readJson: async request => { try { return await request.json(); } catch { return {}; } },
  cookieHeader: () => '',
  visitorIssue: () => 1,
  accessQuota: async () => LOCAL_QUOTA,
  audit: async () => {}
};

let storePromise;
const store = () => (storePromise ||= openLocalStore());

/** Same JSON error shape as the Admin (`{ error: { code, message } }`). */
function failure(error) {
  const status = Number(error.status) || (error.wb ? 400 : 500);
  const wb = error.wb || { code: error.code || 'ERROR', message: String(error.message || error) };
  return json(status, { error: wb });
}

/** Gemini image models (the Admin keeps these on its 「API 连接」 page). */
async function geminiModels(request, db) {
  if (request.method === 'PUT') {
    const body = await h.readJson(request);
    for (const [field, key] of [['textModel', 'gemini_text_model'], ['editModel', 'gemini_edit_model']]) {
      const v = String(body[field] || '').trim();
      if (!v) continue;
      if (!MODEL_ID.test(v)) throw Object.assign(new Error(`模型名称无效：${v}`), { status: 400, code: 'BAD_REQUEST' });
      await setSetting(db, key, v);
    }
  }
  const g = await geminiSettings(db);
  return json(200, { data: { textModel: g.textModel, editModel: g.editModel } });
}

export async function handleLocal(request) {
  const url = new URL(request.url);
  const db = await store();
  try {
    let res;
    if (url.pathname === '/api/styles') res = json(200, { styles: await listStyles(db) });
    else if (url.pathname === '/api/access/upgrade') res = json(200, { valid: true, message: '本地版无需体验码' });
    else if (url.pathname.startsWith('/api/workbench/')) res = await workbenchPublicRoutes(request, url, db, config, h);
    else if (url.pathname === '/admin/api/workbench/gemini') res = await geminiModels(request, db);
    else if (url.pathname.startsWith('/admin/api/workbench/')) res = await workbenchAdminRoutes(request, url, db, config, h);
    res ||= json(404, { error: { code: 'NOT_FOUND', message: '接口不存在' } });
    if (request.method !== 'GET') db.persist();
    return res;
  } catch (error) {
    if (request.method !== 'GET') db.persist();
    return failure(error);
  }
}

const LOCAL = /^\/(api\/|admin\/api\/workbench\/)/;

/** Routes same-origin backend calls to the in-page backend; everything else uses the network. */
export function installLocalBackend() {
  const network = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.origin !== location.origin || !LOCAL.test(url.pathname)) return network(input, init);
    return handleLocal(request);
  };
}

/** Settings UI helper: calls the local admin routes (keys, models, skills, probe). */
export async function localAdmin(path, method = 'GET', body) {
  const res = await fetch(`/admin/api/workbench/${path}`, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const data = await res.json();
  if (!res.ok) throw Object.assign(new Error(data.error?.message || `请求失败（${res.status}）`), { code: data.error?.code });
  return data.data;
}
