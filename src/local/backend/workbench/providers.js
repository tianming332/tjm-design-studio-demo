// Model vendors for the design agent, AI 素材, 画风生图 and 一键成册. Every vendor has a key pool
// (keys.js). Agent adapters map one neutral turn — {system, tools, input[text|image|function_result]}
// — to the vendor format and return {calls, text, handle?, state?, usage}:
//   gemini     Interactions API (stateful, gemini.js)
//   openai     Responses API (stateful: previous_response_id → handle)
//   anthropic  Messages API (stateless: transcript returned as `state`)
//   glm / deepseek / qwen / doubao  OpenAI-compatible Chat Completions (stateless, `state`)
import { getSetting, setSetting, geminiSettings } from '../db.js';
import { declarationSchema } from './tools.js';
import { ProviderError, geminiProvider } from './gemini.js';
import { listPool, keyCandidates, markKey } from './keys.js';

export const VENDORS = {
  gemini: { label: 'Google Gemini', short: 'Gemini', agent: 'gemini', image: true, base: 'https://generativelanguage.googleapis.com/v1beta', console: 'aistudio.google.com' },
  openai: { label: 'OpenAI（GPT）', short: 'GPT', agent: 'openai', image: true, base: 'https://api.openai.com/v1', console: 'platform.openai.com' },
  anthropic: { label: 'Anthropic（Claude）', short: 'Claude', agent: 'anthropic', image: false, base: 'https://api.anthropic.com/v1', console: 'console.anthropic.com' },
  glm: { label: '智谱 GLM', short: 'GLM', agent: 'chat', image: true, base: 'https://open.bigmodel.cn/api/paas/v4', console: 'open.bigmodel.cn' },
  deepseek: { label: 'DeepSeek', short: 'DeepSeek', agent: 'chat', image: false, vision: false, base: 'https://api.deepseek.com', console: 'platform.deepseek.com' },
  qwen: { label: '通义千问（百炼）', short: 'Qwen', agent: 'chat', image: true, base: 'https://dashscope.aliyuncs.com/compatible-mode/v1', imageBase: 'https://dashscope.aliyuncs.com/api/v1', console: 'bailian.console.aliyun.com' },
  doubao: { label: '豆包（火山方舟）', short: '豆包', agent: 'chat', image: true, decompose: true, base: 'https://ark.cn-beijing.volces.com/api/v3', console: 'console.volcengine.com/ark' }
};
export const AGENT_PROVIDERS = Object.keys(VENDORS);
export const IMAGE_PROVIDERS = AGENT_PROVIDERS.filter(v => VENDORS[v].image);
export const PROVIDER_LABEL = Object.fromEntries(AGENT_PROVIDERS.map(v => [v, VENDORS[v].label]));
export const OFFICIAL_BASE = Object.fromEntries(AGENT_PROVIDERS.map(v => [v, VENDORS[v].base]));
const ANTHROPIC_VERSION = '2023-06-01';

/** Per-vendor summary for the admin UI: pool entries (masked), never a clear key. */
export async function publicVendors(db, secret) {
  const out = {};
  for (const id of AGENT_PROVIDERS) {
    const keys = await listPool(db, id, secret);
    const usable = keys.filter(k => k.enabled && k.keySaved).length;
    out[id] = { label: VENDORS[id].label, baseUrl: VENDORS[id].base, console: VENDORS[id].console, image: VENDORS[id].image, keys, usable, keySaved: usable > 0, keyMasked: keys.find(k => k.enabled && k.keySaved)?.keyMasked || '' };
  }
  return out;
}

// --- HTTP ------------------------------------------------------------------------------------
async function request(label, url, init, timeoutMs, fetchImpl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  let response;
  try {
    response = await fetchImpl(url, { ...init, signal: controller.signal });
  } catch (error) {
    throw new ProviderError(error.name === 'AbortError'
      ? { code: 'UPSTREAM_TIMEOUT', message: `${label} 接口超时（${timeoutMs} ms），结果不确定` }
      : { code: 'UPSTREAM_UNCERTAIN', message: `${label} 连接中断，结果不确定` }, true);
  } finally { clearTimeout(timer); }
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { throw new ProviderError({ code: 'UPSTREAM_ERROR', message: `${label} 返回的不是 JSON（HTTP ${response.status}）` }, false, response.status); }
  const failed = !response.ok || (data?.error && typeof data.error === 'object') || (data?.code && data?.message && !data?.output && !data?.data && !data?.choices);
  if (failed) {
    const message = String(data?.error?.message || data?.message || '请求失败').slice(0, 300);
    const code = response.status === 429 ? 'MODEL_LIMIT' : [401, 403].includes(response.status) ? 'NOT_CONFIGURED' : 'UPSTREAM_ERROR';
    throw new ProviderError({ code, message: `${label} HTTP ${response.status}：${message}` }, false, response.status);
  }
  return { data, latencyMs: Date.now() - startedAt };
}
const post = (label, url, headers, body, timeoutMs, fetchImpl) => request(label, url, { method: 'POST', headers, body }, timeoutMs, fetchImpl);

/** Runs `fn(key)` with the vendor's pool: a pinned key only, or failover across keys on
 *  auth / rate / server errors. An uncertain call (timeout) is never retried on another key. */
export async function withKey(db, config, vendor, pinnedId, fn) {
  const all = await keyCandidates(db, config, vendor);
  const keys = pinnedId ? all.filter(k => k.id === pinnedId) : all;
  if (!keys.length) throw new ProviderError({ code: 'NOT_CONFIGURED', message: pinnedId ? `任务绑定的 ${VENDORS[vendor].label} Key 已停用或冷却中` : `${VENDORS[vendor].label} 还没有可用的 Key（「服务商与 Key」）` });
  let last;
  for (const key of keys) {
    try {
      const result = await fn(key);
      await markKey(db, vendor, key.id, true);
      return { ...result, keyId: key.id };
    } catch (error) {
      last = error;
      const status = Number(error.upstreamStatus || 0);
      await markKey(db, vendor, key.id, false, status);
      if (error.uncertain || pinnedId || !(status === 401 || status === 403 || status === 429 || status >= 500)) throw error;
    }
  }
  throw last;
}

const resultText = item => JSON.stringify(item.result);
const parseArgs = raw => { if (typeof raw !== 'string') return raw ?? {}; try { return JSON.parse(raw || '{}'); } catch { return { __unparsable: raw }; } };
const OLD_IMAGE_TEXT = '[较早的画布截图已省略，以最新截图为准]';
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
/** Appends this turn's input to the transcript. Only the newest user turn keeps its images, so
 *  the stored transcript stays small; every earlier tool_use gets a tool_result as Claude requires. */
export function anthropicMessages(state, input) {
  const messages = (state?.messages || []).map(m => m.role !== 'user' || !Array.isArray(m.content) ? m
    : { ...m, content: m.content.map(c => c.type === 'image' ? { type: 'text', text: OLD_IMAGE_TEXT } : c) });
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
// --- OpenAI-compatible Chat Completions (GLM / DeepSeek / Qwen / 豆包) ------------------------
/** Appends this turn to the stored transcript (system prompt excluded). Tool results become
 *  `role: tool` messages right after the assistant turn that asked for them; every tool call
 *  gets an answer; only the newest user message keeps its images (none for text-only vendors). */
export function chatMessages(state, input, { vision = true } = {}) {
  const messages = (state?.messages || []).map(m => m.role !== 'user' || !Array.isArray(m.content) ? m
    : { ...m, content: m.content.map(c => c.type === 'image_url' ? { type: 'text', text: OLD_IMAGE_TEXT } : c) });
  const tools = [];
  const parts = [];
  for (const item of input) {
    if (item.type === 'function_result') tools.push({ role: 'tool', tool_call_id: item.callId, content: resultText(item) });
    else if (item.type === 'image') parts.push(vision ? { type: 'image_url', image_url: { url: `data:${item.mime};base64,${item.data}` } } : { type: 'text', text: '[该模型不支持图像输入，截图未发送；请根据 doc_read 与 doc_lint 的数据判断]' });
    else parts.push({ type: 'text', text: item.text });
  }
  const last = messages[messages.length - 1];
  if (last?.role === 'assistant' && Array.isArray(last.tool_calls)) {
    const answered = new Set(tools.map(t => t.tool_call_id));
    for (const c of last.tool_calls) if (!answered.has(c.id)) tools.push({ role: 'tool', tool_call_id: c.id, content: '{"ok":false,"error":{"code":"BAD_STATE","message":"未执行"}}' });
  }
  messages.push(...tools);
  if (parts.length) messages.push({ role: 'user', content: parts });
  return messages;
}

export function chatAgentBody({ model, system, tools, messages }) {
  return {
    model, messages: [{ role: 'system', content: system }, ...messages],
    ...(tools.length ? { tools: tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: declarationSchema(t.params) } })) } : {})
  };
}

export function parseChatAgent(data) {
  const message = data?.choices?.[0]?.message;
  if (!message) throw new ProviderError({ code: 'UPSTREAM_ERROR', message: '返回内容缺少 choices[0].message' });
  const calls = [];
  for (const c of Array.isArray(message.tool_calls) ? message.tool_calls : []) {
    if (typeof c?.id !== 'string' || typeof c?.function?.name !== 'string') throw new ProviderError({ code: 'UPSTREAM_ERROR', message: 'tool_call 缺少 id 或 name' });
    calls.push({ id: c.id, name: c.function.name, args: parseArgs(c.function.arguments) });
  }
  const text = typeof message.content === 'string' ? message.content : Array.isArray(message.content) ? message.content.map(p => p?.text || '').join('') : '';
  const u = data.usage;
  // Stored back verbatim minus reasoning text, which vendors do not want echoed.
  const assistant = { role: 'assistant', content: text || null, ...(message.tool_calls?.length ? { tool_calls: message.tool_calls } : {}) };
  return { calls, text: text.trim(), handle: typeof data.id === 'string' ? data.id : undefined, assistant, usage: u ? { inputTokens: u.prompt_tokens, outputTokens: u.completion_tokens, totalTokens: u.total_tokens } : undefined };
}

// --- router ----------------------------------------------------------------------------------
/** One provider for the workbench: `turn.provider` (pinned on the task) picks the vendor, and
 *  `turn.projectId` pins the key that answered the first turn. */
// The service may outlive a request, so the global fetch is looked up per call, not captured.
export function agentRouter(db, config, fetchImpl = (...args) => fetch(...args)) {
  const gemini = geminiProvider(db, config, fetchImpl);
  return {
    mock: false,
    async agentTurn(turn) {
      const provider = turn.provider || 'gemini';
      const vendor = VENDORS[provider];
      if (!vendor) throw new ProviderError({ code: 'BAD_REQUEST', message: `未知服务商 ${provider}` });
      if (provider === 'gemini') return gemini.agentTurn(turn);
      const { timeoutMs } = await geminiSettings(db);
      const pinned = turn.projectId || undefined;
      if (provider === 'openai') {
        const out = await withKey(db, config, provider, pinned, async key => {
          const { data, latencyMs } = await post('OpenAI', `${vendor.base}/responses`, { 'content-type': 'application/json', authorization: `Bearer ${key.apiKey}` }, JSON.stringify(openaiAgentBody(turn)), timeoutMs, fetchImpl);
          return { ...parseOpenAIAgent(data), latencyMs };
        });
        return { ...out, projectId: out.keyId };
      }
      if (provider === 'anthropic') {
        const messages = anthropicMessages(turn.state, turn.input);
        const out = await withKey(db, config, provider, pinned, async key => {
          const { data, latencyMs } = await post('Claude', `${vendor.base}/messages`, { 'content-type': 'application/json', 'x-api-key': key.apiKey, 'anthropic-version': ANTHROPIC_VERSION, 'anthropic-dangerous-direct-browser-access': 'true' }, JSON.stringify(anthropicAgentBody({ ...turn, messages })), timeoutMs, fetchImpl);
          return { ...parseAnthropicAgent(data), latencyMs, state: { messages: [...messages, { role: 'assistant', content: data.content }] } };
        });
        return { ...out, projectId: out.keyId };
      }
      const messages = chatMessages(turn.state, turn.input, { vision: vendor.vision !== false });
      const out = await withKey(db, config, provider, pinned, async key => {
        const { data, latencyMs } = await post(vendor.label, `${vendor.base}/chat/completions`, { 'content-type': 'application/json', authorization: `Bearer ${key.apiKey}` }, JSON.stringify(chatAgentBody({ ...turn, messages })), timeoutMs, fetchImpl);
        const parsed = parseChatAgent(data);
        return { calls: parsed.calls, text: parsed.text, handle: parsed.handle, usage: parsed.usage, latencyMs, state: { messages: [...messages, parsed.assistant] } };
      });
      return { ...out, projectId: out.keyId };
    }
  };
}

/** One-shot text answer (一键成册排版 / 识图) from any vendor; Gemini callers keep their own path. */
export async function completeText(db, config, provider, model, { system = '', input }, fetchImpl) {
  const out = await agentRouter(db, config, fetchImpl).agentTurn({ provider, model, system, tools: [], input });
  return { text: out.text, latencyMs: out.latencyMs, provider, model };
}
// --- images (non-Gemini; Gemini keeps upstream.generate) --------------------------------------
const ratioOf = aspectRatio => { const [w, h] = String(aspectRatio || '1:1').split(':').map(Number); return w > 0 && h > 0 ? w / h : 1; };
const nearest = (aspectRatio, table) => { const r = ratioOf(aspectRatio); return table.reduce((best, s) => Math.abs(Math.log(s.r / r)) < Math.abs(Math.log(best.r / r)) ? s : best).size; };
const sizes = (list, sep = 'x') => list.map(([w, h]) => ({ r: w / h, size: `${w}${sep}${h}` }));

/** gpt-image sizes: landscape / portrait / square from the requested aspect ratio. */
export function openaiImageSize(aspectRatio) {
  return nearest(aspectRatio, sizes([[1024, 1024], [1536, 1024], [1024, 1536]]));
}
const GLM_SIZES = sizes([[1024, 1024], [1344, 768], [768, 1344], [1152, 864], [864, 1152], [1440, 720], [720, 1440]]);
const QWEN_SIZES = sizes([[1328, 1328], [1664, 928], [928, 1664], [1472, 1104], [1104, 1472]], '*');
const b64ToBytes = b64 => Uint8Array.from(atob(b64), c => c.charCodeAt(0));
const dataUrl = img => `data:${img.mime};base64,${img.data}`;

async function fetchBytes(label, url, timeoutMs, fetchImpl) {
  const u = new URL(url);
  if (u.protocol !== 'https:') throw new ProviderError({ code: 'UPSTREAM_ERROR', message: `${label} 返回的图片地址不是 https` });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(u.href, { signal: controller.signal });
    if (!res.ok) throw new ProviderError({ code: 'UPSTREAM_ERROR', message: `${label} 图片下载失败（HTTP ${res.status}）` });
    const mime = String(res.headers.get('content-type') || 'image/png').split(';')[0];
    return { mime: /^image\/(png|jpeg|webp)$/.test(mime) ? mime : 'image/png', bytes: new Uint8Array(await res.arrayBuffer()) };
  } finally { clearTimeout(timer); }
}

/** Text-to-image, or an edit when reference images are given. Returns {mime, bytes, latencyMs}. */
export async function vendorImage(db, config, provider, { model, prompt, aspectRatio, imageSize, images = [] }, fetchImpl = (...a) => fetch(...a)) {
  const vendor = VENDORS[provider];
  if (!vendor?.image || provider === 'gemini') throw new ProviderError({ code: 'BAD_REQUEST', message: `${vendor?.label || provider} 不能用于这里的生图` });
  if (!model) throw new ProviderError({ code: 'NOT_CONFIGURED', message: `请先为 ${vendor.label} 选择生图模型` });
  const { timeoutMs } = await geminiSettings(db);
  return withKey(db, config, provider, undefined, async key => {
    const bearer = { authorization: `Bearer ${key.apiKey}` };
    const json = { ...bearer, 'content-type': 'application/json' };
    if (provider === 'openai') {
      let res;
      if (images.length) {
        const form = new FormData();
        form.append('model', model); form.append('prompt', prompt); form.append('size', openaiImageSize(aspectRatio));
        images.slice(0, 16).forEach((img, i) => form.append('image[]', new Blob([b64ToBytes(img.data)], { type: img.mime }), `ref-${i + 1}.${img.mime.split('/')[1]}`));
        res = await post('OpenAI 图片编辑', `${vendor.base}/images/edits`, bearer, form, timeoutMs, fetchImpl);
      } else {
        res = await post('OpenAI 生图', `${vendor.base}/images/generations`, json, JSON.stringify({ model, prompt, size: openaiImageSize(aspectRatio), n: 1, ...(/^dall-e/.test(model) ? { response_format: 'b64_json' } : {}) }), timeoutMs, fetchImpl);
      }
      const b64 = res.data?.data?.[0]?.b64_json;
      if (!b64) throw new ProviderError({ code: 'UPSTREAM_ERROR', message: 'OpenAI 未返回图片数据' });
      const mime = res.data.output_format === 'jpeg' ? 'image/jpeg' : res.data.output_format === 'webp' ? 'image/webp' : 'image/png';
      return { mime, bytes: b64ToBytes(b64), latencyMs: res.latencyMs };
    }
    if (provider === 'doubao') {
      const ref = images.slice(0, 14).map(dataUrl);
      const res = await post('豆包生图', `${vendor.base}/images/generations`, json, JSON.stringify({ model, prompt: aspectRatio ? `${prompt}\n画面宽高比 ${aspectRatio}。` : prompt, size: imageSize && imageSize !== '1K' ? imageSize : '2K', response_format: 'b64_json', watermark: false, ...(ref.length ? { image: ref.length === 1 ? ref[0] : ref } : {}) }), timeoutMs, fetchImpl);
      const item = res.data?.data?.find(d => d.b64_json || d.url);
      if (!item) throw new ProviderError({ code: 'UPSTREAM_ERROR', message: `豆包未返回图片：${res.data?.data?.[0]?.error?.message || ''}` });
      return item.b64_json ? { mime: 'image/png', bytes: b64ToBytes(item.b64_json), latencyMs: res.latencyMs } : { ...(await fetchBytes('豆包', item.url, timeoutMs, fetchImpl)), latencyMs: res.latencyMs };
    }
    if (provider === 'glm') {
      const res = await post('智谱生图', `${vendor.base}/images/generations`, json, JSON.stringify({ model, prompt, size: nearest(aspectRatio, GLM_SIZES) }), timeoutMs, fetchImpl);
      const url = res.data?.data?.[0]?.url;
      if (!url) throw new ProviderError({ code: 'UPSTREAM_ERROR', message: '智谱未返回图片地址' });
      return { ...(await fetchBytes('智谱', url, timeoutMs, fetchImpl)), latencyMs: res.latencyMs };
    }
    // qwen-image: DashScope multimodal-generation (synchronous); references become image parts.
    const content = [...images.slice(0, 3).map(img => ({ image: dataUrl(img) })), { text: prompt }];
    const res = await post('千问生图', `${vendor.imageBase}/services/aigc/multimodal-generation/generation`, json, JSON.stringify({ model, input: { messages: [{ role: 'user', content }] }, parameters: { size: nearest(aspectRatio, QWEN_SIZES), watermark: false } }), timeoutMs, fetchImpl);
    const url = res.data?.output?.choices?.[0]?.message?.content?.find(c => c.image)?.image;
    if (!url) throw new ProviderError({ code: 'UPSTREAM_ERROR', message: `千问未返回图片：${res.data?.message || ''}` });
    return { ...(await fetchBytes('千问', url, timeoutMs, fetchImpl)), latencyMs: res.latencyMs };
  });
}

/** 豆包 Seedream layer decomposition: one flat image → separate layers with name, description and
 *  a box normalised to 0–1000. `targets` (name + normalised box) steer which parts are split. */
export async function decomposeImage(db, config, { model, image, targets = [] }, fetchImpl = (...a) => fetch(...a)) {
  const { timeoutMs } = await geminiSettings(db);
  const hint = targets.length ? `需分离的元素：${targets.map(t => `${t.name}<bbox>${t.box.map(Math.round).join(' ')}</bbox>`).join('、')}。` : '';
  const prompt = `将图片进行精确图层分离：文字、主体、装饰元素分别成层，背景补全为完整底图。${hint}`;
  return withKey(db, config, 'doubao', undefined, async key => {
    const res = await post('豆包拆层', `${VENDORS.doubao.base}/images/generations`, { authorization: `Bearer ${key.apiKey}`, 'content-type': 'application/json' }, JSON.stringify({ model, prompt, image: dataUrl(image), layer_decomposition: true, size: '2K', response_format: 'b64_json', output_format: 'png', watermark: false }), Math.max(timeoutMs, 300000), fetchImpl);
    const layers = [];
    for (const d of res.data?.data || []) {
      if (!d.b64_json && !d.url) continue;
      const img = d.b64_json ? { mime: 'image/png', bytes: b64ToBytes(d.b64_json) } : await fetchBytes('豆包', d.url, timeoutMs, fetchImpl);
      layers.push({ ...img, zIndex: Number(d.z_index ?? layers.length), box: d.bounding_box?.normalized || null, name: String(d.name || (d.z_index ? `图层 ${d.z_index}` : '背景')).slice(0, 60), description: String(d.description || '').slice(0, 200) });
    }
    if (!layers.length) throw new ProviderError({ code: 'UPSTREAM_ERROR', message: '豆包未返回任何图层' });
    return { layers: layers.sort((a, b) => a.zIndex - b.zIndex), latencyMs: res.latencyMs };
  });
}
// --- model discovery and registry --------------------------------------------------------------
export const MODEL_USES = ['agent', 'image', 'text'];
export const MODEL_ID = /^[a-zA-Z0-9_.:\/-]{2,120}$/;
const GEMINI_MODELS = 'https://generativelanguage.googleapis.com/v1beta/models';

/** Lists the vendor's models with a pool key (no generation, no billing). Doubles as the key test.
 *  Vendors without a list endpoint answer with an error the UI shows ("请手动添加"). */
export async function discoverModels(db, config, vendor, fetchImpl = (...a) => fetch(...a)) {
  const v = VENDORS[vendor];
  if (!v) throw new ProviderError({ code: 'BAD_REQUEST', message: `未知服务商 ${vendor}` });
  const startedAt = Date.now();
  const out = await withKey(db, config, vendor, undefined, async key => {
    const headers = vendor === 'gemini' ? { 'x-goog-api-key': key.apiKey } : vendor === 'anthropic' ? { 'x-api-key': key.apiKey, 'anthropic-version': ANTHROPIC_VERSION, 'anthropic-dangerous-direct-browser-access': 'true' } : { authorization: `Bearer ${key.apiKey}` };
    const url = vendor === 'gemini' ? `${GEMINI_MODELS}?pageSize=200` : `${v.base}/models${vendor === 'anthropic' ? '?limit=1000' : ''}`;
    const { data } = await request(v.label, url, { headers }, 20000, fetchImpl);
    const list = vendor === 'gemini' ? (data.models || []).map(m => ({ id: String(m.name || '').replace(/^models\//, ''), label: m.displayName || '' }))
      : (data.data || []).map(m => ({ id: String(m.id || ''), label: m.display_name || '' }));
    return { models: list };
  });
  const models = out.models.filter(m => MODEL_ID.test(m.id)).sort((a, b) => a.id.localeCompare(b.id)).slice(0, 500);
  return { ok: true, latencyMs: Date.now() - startedAt, models };
}

export function normalizeRegistry(list) {
  if (!Array.isArray(list) || list.length > 300) throw new ProviderError({ code: 'BAD_REQUEST', message: '模型列表无效（最多 300 个）' });
  const seen = new Set();
  return list.map(m => {
    const provider = String(m?.provider || '');
    const id = String(m?.id || '').trim();
    if (!VENDORS[provider]) throw new ProviderError({ code: 'BAD_REQUEST', message: `未知服务商：${provider}` });
    if (!MODEL_ID.test(id)) throw new ProviderError({ code: 'BAD_REQUEST', message: `模型 ID 无效：${id}` });
    const key = `${provider}:${id}`;
    if (seen.has(key)) throw new ProviderError({ code: 'BAD_REQUEST', message: `模型重复：${key}` });
    seen.add(key);
    const uses = [...new Set(Array.isArray(m.uses) ? m.uses : [])].filter(u => MODEL_USES.includes(u));
    if (!VENDORS[provider].image && uses.includes('image')) throw new ProviderError({ code: 'BAD_REQUEST', message: `${VENDORS[provider].label} 不能生图` });
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
    if (!id || !MODEL_ID.test(id) || !VENDORS[provider]) return;
    const found = list.find(m => m.provider === provider && m.id === id);
    if (found) { if (!found.uses.includes(use)) found.uses.push(use); } else list.push({ provider, id, label: '', uses: [use], enabled: true });
  };
  add('gemini', gem.textModel, 'image'); add('gemini', gem.editModel, 'image');
  add('gemini', defaultModel, 'text'); add('gemini', autobookModel, 'text');
  if (wb.agent) add(VENDORS[wb.agentProvider] ? wb.agentProvider : 'gemini', wb.agent, 'agent');
  add('openai', wb.openaiImage || 'gpt-image-1', 'image');
  return list;
}

export async function saveModelRegistry(db, list) {
  const clean = normalizeRegistry(list);
  await setSetting(db, 'model_registry', JSON.stringify(clean));
  return clean;
}
