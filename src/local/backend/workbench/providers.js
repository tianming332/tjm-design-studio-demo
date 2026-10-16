// OpenAI (GPT) and Anthropic (Claude) adapters for the design agent, next to the Gemini pool.
// Every adapter maps the same neutral turn — {system, tools, input[text|image|function_result]}
// — to its vendor format and returns {calls, text, handle?, state?, usage}. OpenAI Responses is
// stateful (previous_response_id → handle); Claude Messages is stateless, so the transcript is
// returned as `state` and stored with the task.
import { getSetting, setSetting, geminiSettings } from '../db.js';
import { encryptSecret, decryptSecret } from '../security.js';
import { declarationSchema } from './tools.js';
import { ProviderError, geminiProvider } from './gemini.js';
import { geminiProjectCandidates } from '../upstream.js';

export const AGENT_PROVIDERS = ['gemini', 'openai', 'anthropic'];
export const IMAGE_PROVIDERS = ['gemini', 'openai'];
export const PROVIDER_LABEL = { gemini: 'Gemini', openai: 'OpenAI（GPT）', anthropic: 'Anthropic（Claude）' };
const ANTHROPIC_VERSION = '2023-06-01';

// --- settings: official endpoints only; one encrypted key per vendor --------------------------
// Local edition: Gemini is one key like the others (no project pool), saved in this browser only.
export const OFFICIAL_BASE = { gemini: 'https://generativelanguage.googleapis.com/v1beta', openai: 'https://api.openai.com/v1', anthropic: 'https://api.anthropic.com/v1' };

export async function vendorSettings(db, vendor, secret) {
  const keyEncrypted = await getSetting(db, `${vendor}_key_encrypted`, '');
  let apiKey = '';
  if (keyEncrypted && secret) { try { apiKey = decryptSecret(keyEncrypted, secret); } catch {} }
  return { baseUrl: OFFICIAL_BASE[vendor], apiKey, keySaved: !!keyEncrypted, keyMasked: apiKey ? `••••••••${apiKey.slice(-4)}` : keyEncrypted ? '••••••••（无法解密）' : '' };
}

export async function publicVendors(db, secret) {
  const out = {};
  for (const v of ['gemini', 'openai', 'anthropic']) { const { apiKey, ...rest } = await vendorSettings(db, v, secret); out[v] = rest; }
  return out;
}

export async function saveVendor(db, vendor, { apiKey, clearKey }, secret) {
  if (!OFFICIAL_BASE[vendor]) throw new ProviderError({ code: 'BAD_REQUEST', message: `未知服务商 ${vendor}` });
  if (clearKey) { await setSetting(db, `${vendor}_key_encrypted`, ''); return; }
  const key = String(apiKey || '').trim();
  if (key.length < 8 || key.length > 400 || /\s/.test(key)) throw new ProviderError({ code: 'BAD_REQUEST', message: 'API Key 格式无效' });
  if (!secret) throw new ProviderError({ code: 'NOT_CONFIGURED', message: 'DATA_ENCRYPTION_KEY 未配置，无法保存 Key' });
  await setSetting(db, `${vendor}_key_encrypted`, encryptSecret(key, secret));
}

// --- HTTP ------------------------------------------------------------------------------------
async function post(label, url, headers, body, timeoutMs, fetchImpl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  let response;
  try {
    response = await fetchImpl(url, { method: 'POST', signal: controller.signal, headers, body });
  } catch (error) {
    throw new ProviderError(error.name === 'AbortError'
      ? { code: 'UPSTREAM_TIMEOUT', message: `${label} 接口超时（${timeoutMs} ms），结果不确定` }
      : { code: 'UPSTREAM_UNCERTAIN', message: `${label} 连接中断，结果不确定` }, true);
  } finally { clearTimeout(timer); }
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { throw new ProviderError({ code: 'UPSTREAM_ERROR', message: `${label} 返回的不是 JSON（HTTP ${response.status}）` }, false, response.status); }
  if (!response.ok || data?.error) {
    const message = String(data?.error?.message || data?.message || '请求失败').slice(0, 300);
    const code = response.status === 429 ? 'MODEL_LIMIT' : [401, 403].includes(response.status) ? 'NOT_CONFIGURED' : 'UPSTREAM_ERROR';
    throw new ProviderError({ code, message: `${label} HTTP ${response.status}：${message}` }, false, response.status);
  }
  return { data, latencyMs: Date.now() - startedAt };
}

const resultText = item => JSON.stringify(item.result);
const parseArgs = raw => { if (typeof raw !== 'string') return raw ?? {}; try { return JSON.parse(raw || '{}'); } catch { return { __unparsable: raw }; } };

// --- OpenAI Responses ------------------------------------------------------------------------
export function openaiAgentBody({ model, system, tools, input, previous }) {
  const items = [];
  let message = null;
  for (const item of input) {
    if (item.type === 'function_result') { message = null; items.push({ type: 'function_call_output', call_id: item.callId, output: resultText(item) }); continue; }
    if (!message) { message = { role: 'user', content: [] }; items.push(message); }
    message.content.push(item.type === 'image' ? { type: 'input_image', image_url: `data:${item.mime};base64,${item.data}` } : { type: 'input_text', text: item.text });
  }
  return {
    model, instructions: system, input: items, store: true,
    ...(tools.length ? { tools: tools.map(t => ({ type: 'function', name: t.name, description: t.description, parameters: declarationSchema(t.params), strict: false })) } : {}),
    ...(previous ? { previous_response_id: previous } : {})
  };
}

/** Only typed `function_call` output items become calls — free text is never a command. */
export function parseOpenAIAgent(data) {
  if (!data || typeof data !== 'object') throw new ProviderError({ code: 'UPSTREAM_ERROR', message: 'OpenAI 返回内容不是对象' });
  const calls = [];
  const texts = [];
  for (const o of Array.isArray(data.output) ? data.output : []) {
    if (o?.type === 'function_call') {
      if (typeof o.call_id !== 'string' || typeof o.name !== 'string') throw new ProviderError({ code: 'UPSTREAM_ERROR', message: 'function_call 缺少 call_id 或 name' });
      calls.push({ id: o.call_id, name: o.name, args: parseArgs(o.arguments) });
    } else if (o?.type === 'message' && Array.isArray(o.content)) {
      for (const c of o.content) if (c?.type === 'output_text' && typeof c.text === 'string') texts.push(c.text);
    }
  }
  if (!texts.length && typeof data.output_text === 'string') texts.push(data.output_text);
  const u = data.usage;
  return { calls, text: texts.join('\n').trim(), handle: typeof data.id === 'string' ? data.id : undefined, usage: u ? { inputTokens: u.input_tokens, outputTokens: u.output_tokens, totalTokens: u.total_tokens } : undefined };
}

// --- Anthropic Messages ----------------------------------------------------------------------
const OLD_IMAGE = { type: 'text', text: '[较早的画布截图已省略，以最新截图为准]' };

/** Appends this turn's input to the transcript. Only the newest user turn keeps its images, so
 *  the stored transcript stays small; every earlier tool_use gets a tool_result as Claude requires. */
export function anthropicMessages(state, input) {
  const messages = (state?.messages || []).map(m => m.role !== 'user' || !Array.isArray(m.content) ? m
    : { ...m, content: m.content.map(c => c.type === 'image' ? OLD_IMAGE : c) });
  const results = [];
  const rest = [];
  for (const item of input) {
    if (item.type === 'function_result') results.push({ type: 'tool_result', tool_use_id: item.callId, content: resultText(item), ...(item.result?.ok === false ? { is_error: true } : {}) });
    else if (item.type === 'image') rest.push({ type: 'image', source: { type: 'base64', media_type: item.mime, data: item.data } });
    else rest.push({ type: 'text', text: item.text });
  }
  const last = messages[messages.length - 1];
  if (last?.role === 'assistant' && Array.isArray(last.content)) {
    const answered = new Set(results.map(r => r.tool_use_id));
    for (const c of last.content) if (c.type === 'tool_use' && !answered.has(c.id)) results.push({ type: 'tool_result', tool_use_id: c.id, content: '{"ok":false,"error":{"code":"BAD_STATE","message":"未执行"}}', is_error: true });
  }
  const content = [...results, ...rest];
  if (content.length) messages.push({ role: 'user', content });
  return messages;
}

export function anthropicAgentBody({ model, system, tools, messages }) {
  return {
    model, max_tokens: 8192, system, messages,
    ...(tools.length ? { tools: tools.map(t => ({ name: t.name, description: t.description, input_schema: declarationSchema(t.params) })) } : {})
  };
}

export function parseAnthropicAgent(data) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.content)) throw new ProviderError({ code: 'UPSTREAM_ERROR', message: 'Claude 返回内容缺少 content' });
  const calls = [];
  const texts = [];
  for (const c of data.content) {
    if (c?.type === 'tool_use') {
      if (typeof c.id !== 'string' || typeof c.name !== 'string') throw new ProviderError({ code: 'UPSTREAM_ERROR', message: 'tool_use 缺少 id 或 name' });
      calls.push({ id: c.id, name: c.name, args: c.input && typeof c.input === 'object' ? c.input : {} });
    } else if (c?.type === 'text' && typeof c.text === 'string') texts.push(c.text);
  }
  const u = data.usage;
  return { calls, text: texts.join('\n').trim(), handle: typeof data.id === 'string' ? data.id : undefined, usage: u ? { inputTokens: u.input_tokens, outputTokens: u.output_tokens, totalTokens: (u.input_tokens || 0) + (u.output_tokens || 0) } : undefined };
}

// --- router ----------------------------------------------------------------------------------
async function vendorOrThrow(db, vendor, config) {
  const v = await vendorSettings(db, vendor, config.dataEncryptionKey);
  if (!v.apiKey) throw new ProviderError({ code: 'NOT_CONFIGURED', message: `${PROVIDER_LABEL[vendor]} 的 API Key 尚未在「API 连接」中配置` });
  return v;
}

/** One provider for the workbench: `turn.provider` (pinned on the task) picks the vendor. */
// The service may outlive a request, so the global fetch is looked up per call, not captured.
export function agentRouter(db, config, fetchImpl = (...args) => fetch(...args)) {
  const gemini = geminiProvider(db, config, fetchImpl);
  return {
    mock: false,
    async agentTurn(turn) {
      const provider = turn.provider || 'gemini';
      if (provider === 'gemini') return gemini.agentTurn(turn);
      const { timeoutMs } = await geminiSettings(db);
      const v = await vendorOrThrow(db, provider, config);
      if (provider === 'openai') {
        const { data, latencyMs } = await post('OpenAI', `${v.baseUrl}/responses`, { 'content-type': 'application/json', authorization: `Bearer ${v.apiKey}` }, JSON.stringify(openaiAgentBody(turn)), timeoutMs, fetchImpl);
        return { ...parseOpenAIAgent(data), latencyMs };
      }
      if (provider === 'anthropic') {
        const messages = anthropicMessages(turn.state, turn.input);
        const { data, latencyMs } = await post('Claude', `${v.baseUrl}/messages`, { 'content-type': 'application/json', 'x-api-key': v.apiKey, 'anthropic-version': ANTHROPIC_VERSION, 'anthropic-dangerous-direct-browser-access': 'true' }, JSON.stringify(anthropicAgentBody({ ...turn, messages })), timeoutMs, fetchImpl);
        const out = parseAnthropicAgent(data);
        return { ...out, latencyMs, state: { messages: [...messages, { role: 'assistant', content: data.content }] } };
      }
      throw new ProviderError({ code: 'BAD_REQUEST', message: `未知服务商 ${provider}` });
    }
  };
}

// --- OpenAI images ---------------------------------------------------------------------------
/** gpt-image sizes: landscape / portrait / square from the requested aspect ratio. */
export function openaiImageSize(aspectRatio) {
  const [w, h] = String(aspectRatio || '1:1').split(':').map(Number);
  return !w || !h || w === h ? '1024x1024' : w > h ? '1536x1024' : '1024x1536';
}

/** Text-to-image, or an edit when reference images are given (style refs + user ref, ≤ 16). */
export async function openaiImage(db, config, { model, prompt, aspectRatio, images = [] }, fetchImpl = fetch) {
  const { timeoutMs } = await geminiSettings(db);
  const v = await vendorOrThrow(db, 'openai', config);
  const size = openaiImageSize(aspectRatio);
  const auth = { authorization: `Bearer ${v.apiKey}` };
  let res;
  if (images.length) {
    const form = new FormData();
    form.append('model', model);
    form.append('prompt', prompt);
    form.append('size', size);
    images.slice(0, 16).forEach((img, i) => form.append('image[]', new Blob([Uint8Array.from(atob(img.data), c => c.charCodeAt(0))], { type: img.mime }), `ref-${i + 1}.${img.mime.split('/')[1]}`));
    res = await post('OpenAI 图片编辑', `${v.baseUrl}/images/edits`, auth, form, timeoutMs, fetchImpl);
  } else {
    res = await post('OpenAI 生图', `${v.baseUrl}/images/generations`, { ...auth, 'content-type': 'application/json' }, JSON.stringify({ model, prompt, size, n: 1, ...(/^dall-e/.test(model) ? { response_format: 'b64_json' } : {}) }), timeoutMs, fetchImpl);
  }
  const b64 = res.data?.data?.[0]?.b64_json;
  if (!b64) throw new ProviderError({ code: 'UPSTREAM_ERROR', message: 'OpenAI 未返回图片数据' });
  const mime = res.data.output_format === 'jpeg' ? 'image/jpeg' : res.data.output_format === 'webp' ? 'image/webp' : 'image/png';
  return { mime, bytes: Uint8Array.from(atob(b64), c => c.charCodeAt(0)), latencyMs: res.latencyMs };
}

/** Lists the vendor's models with the saved key (no generation, no billing). Doubles as the key test. */
export async function discoverModels(db, config, vendor, fetchImpl = fetch) {
  let url, headers, pick;
  if (vendor === 'gemini') {
    const [project] = await geminiProjectCandidates(db, config);
    if (!project) throw new ProviderError({ code: 'NOT_CONFIGURED', message: 'Gemini Project 池尚未配置' });
    url = `${GEMINI_MODELS}?pageSize=200`;
    headers = { 'x-goog-api-key': project.apiKey };
    pick = data => (data.models || []).map(m => ({ id: String(m.name || '').replace(/^models\//, ''), label: m.displayName || '' }));
  } else {
    const v = await vendorOrThrow(db, vendor, config);
    url = `${v.baseUrl}/models${vendor === 'anthropic' ? '?limit=1000' : ''}`;
    headers = vendor === 'openai' ? { authorization: `Bearer ${v.apiKey}` } : { 'x-api-key': v.apiKey, 'anthropic-version': ANTHROPIC_VERSION, 'anthropic-dangerous-direct-browser-access': 'true' };
    pick = data => (data.data || []).map(m => ({ id: String(m.id || ''), label: m.display_name || '' }));
  }
  const startedAt = Date.now();
  let response;
  try { response = await fetchImpl(url, { headers }); } catch { throw new ProviderError({ code: 'UPSTREAM_ERROR', message: `${PROVIDER_LABEL[vendor]} 连接失败` }); }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new ProviderError({ code: response.status === 401 || response.status === 403 ? 'NOT_CONFIGURED' : 'UPSTREAM_ERROR', message: `${PROVIDER_LABEL[vendor]} HTTP ${response.status}：${String(data?.error?.message || '请求失败').slice(0, 200)}` });
  const models = pick(data).filter(m => MODEL_ID.test(m.id)).sort((a, b) => a.id.localeCompare(b.id)).slice(0, 500);
  return { ok: true, latencyMs: Date.now() - startedAt, models };
}

// --- model registry (admin-managed list shown as choices; free-typed ids stay allowed) ---------
export const MODEL_USES = ['agent', 'image', 'text'];
export const MODEL_ID = /^[a-zA-Z0-9_.:-]{2,120}$/;
const GEMINI_MODELS = 'https://generativelanguage.googleapis.com/v1beta/models';

export function normalizeRegistry(list) {
  if (!Array.isArray(list) || list.length > 300) throw new ProviderError({ code: 'BAD_REQUEST', message: '模型列表无效（最多 300 个）' });
  const seen = new Set();
  return list.map(m => {
    const provider = String(m?.provider || '');
    const id = String(m?.id || '').trim();
    if (!AGENT_PROVIDERS.includes(provider)) throw new ProviderError({ code: 'BAD_REQUEST', message: `未知服务商：${provider}` });
    if (!MODEL_ID.test(id)) throw new ProviderError({ code: 'BAD_REQUEST', message: `模型 ID 无效：${id}` });
    const key = `${provider}:${id}`;
    if (seen.has(key)) throw new ProviderError({ code: 'BAD_REQUEST', message: `模型重复：${key}` });
    seen.add(key);
    const uses = [...new Set(Array.isArray(m.uses) ? m.uses : [])].filter(u => MODEL_USES.includes(u));
    if (provider === 'anthropic' && uses.includes('image')) throw new ProviderError({ code: 'BAD_REQUEST', message: 'Claude 不能生图' });
    return { provider, id, label: String(m.label || '').trim().slice(0, 60), uses, enabled: m.enabled !== false };
  });
}

/** Stored list, or one derived from the ids already configured (first run / upgrade). */
export async function modelRegistry(db) {
  const raw = await getSetting(db, 'model_registry', '');
  if (raw) { try { return normalizeRegistry(JSON.parse(raw)); } catch {} }
  const gem = await geminiSettings(db);
  const [defaultModel, autobookModel, wbModels] = await Promise.all([getSetting(db, 'default_model', ''), getSetting(db, 'autobook_model', ''), getSetting(db, 'workbench_models', '{}')]);
  let wb = {};
  try { wb = JSON.parse(wbModels || '{}'); } catch {}
  const list = [];
  const add = (provider, id, use) => {
    if (!id || !MODEL_ID.test(id)) return;
    const found = list.find(m => m.provider === provider && m.id === id);
    if (found) { if (!found.uses.includes(use)) found.uses.push(use); } else list.push({ provider, id, label: '', uses: [use], enabled: true });
  };
  add('gemini', gem.textModel, 'image'); add('gemini', gem.editModel, 'image');
  add('gemini', defaultModel, 'text'); add('gemini', autobookModel, 'text');
  if (wb.agent) add(['openai', 'anthropic'].includes(wb.agentProvider) ? wb.agentProvider : 'gemini', wb.agent, 'agent');
  add('openai', wb.openaiImage || 'gpt-image-1', 'image');
  return list;
}

export async function saveModelRegistry(db, list) {
  const clean = normalizeRegistry(list);
  await setSetting(db, 'model_registry', JSON.stringify(clean));
  return clean;
}
