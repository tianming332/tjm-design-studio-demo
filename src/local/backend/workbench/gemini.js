// Model access for the design agent. Keys come from the existing Gemini Project Pool; a task is
// pinned to the project that answered its first turn (interaction ids are only valid there), so
// the pool's automatic failover is used only before a conversation starts.
import { geminiSettings } from '../db.js';
import { geminiProjectCandidates } from '../upstream.js';
import { declarationSchema } from './tools.js';

export class ProviderError extends Error {
  constructor(wb, uncertain = false, status) { super(wb.message); this.wb = wb; this.uncertain = uncertain; this.upstreamStatus = status; }
}

export function geminiAgentBody({ model, system, tools, input, previous }) {
  return {
    model,
    system_instruction: system,
    tools: tools.map(t => ({ type: 'function', name: t.name, description: t.description, parameters: declarationSchema(t.params) })),
    input: input.map(item => {
      if (item.type === 'text') return { type: 'text', text: item.text };
      if (item.type === 'image') return { type: 'image', mime_type: item.mime, data: item.data };
      return { type: 'function_result', name: item.name, call_id: item.callId, result: [{ type: 'text', text: JSON.stringify(item.result) }] };
    }),
    ...(previous ? { previous_interaction_id: previous } : {})
  };
}

const usageOf = u => u && typeof u === 'object' ? { inputTokens: u.total_input_tokens ?? u.input_tokens, outputTokens: u.total_output_tokens ?? u.output_tokens, totalTokens: u.total_tokens } : undefined;

/** Only typed `function_call` steps become calls — free text is never treated as a command. */
export function parseGeminiAgent(data) {
  if (!data || typeof data !== 'object') throw new ProviderError({ code: 'UPSTREAM_ERROR', message: 'Gemini 返回内容不是对象' });
  const steps = Array.isArray(data.steps) ? data.steps : Array.isArray(data.outputs) ? data.outputs : [];
  const calls = [];
  const texts = [];
  for (const s of steps) {
    if (s?.type === 'function_call') {
      if (typeof s.id !== 'string' || typeof s.name !== 'string') throw new ProviderError({ code: 'UPSTREAM_ERROR', message: 'function_call 缺少 id 或 name' });
      let args = s.arguments ?? {};
      if (typeof args === 'string') { try { args = JSON.parse(args); } catch { args = { __unparsable: args }; } }
      calls.push({ id: s.id, name: s.name, args });
    } else if (s?.type === 'text' && typeof s.text === 'string') texts.push(s.text);
    else if (Array.isArray(s?.content)) for (const p of s.content) if (p?.type === 'text' && typeof p.text === 'string') texts.push(p.text);
  }
  if (!steps.length && typeof data.output_text === 'string') texts.push(data.output_text);
  return { calls, text: texts.join('\n').trim(), handle: typeof data.id === 'string' ? data.id : undefined, usage: usageOf(data.usage) };
}

async function post(url, apiKey, body, timeoutMs, fetchImpl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  let response;
  try {
    response = await fetchImpl(url, { method: 'POST', signal: controller.signal, headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey }, body: JSON.stringify(body) });
  } catch (error) {
    // Sent without an answer: the vendor may have processed (and billed) it.
    throw new ProviderError(error.name === 'AbortError'
      ? { code: 'UPSTREAM_TIMEOUT', message: `Gemini Agent 接口超时（${timeoutMs} ms），结果不确定` }
      : { code: 'UPSTREAM_UNCERTAIN', message: 'Gemini Agent 连接中断，结果不确定' }, true);
  } finally { clearTimeout(timer); }
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { throw new ProviderError({ code: 'UPSTREAM_ERROR', message: `Gemini 返回的不是 JSON（HTTP ${response.status}）` }, false, response.status); }
  if (!response.ok || data?.error) {
    const message = String(data?.error?.message || data?.message || '请求失败').slice(0, 300);
    const code = response.status === 429 ? 'MODEL_LIMIT' : [401, 403].includes(response.status) ? 'NOT_CONFIGURED' : 'UPSTREAM_ERROR';
    throw new ProviderError({ code, message: `Gemini HTTP ${response.status}：${message}` }, false, response.status);
  }
  return { data, latencyMs: Date.now() - startedAt };
}

/** Real provider over the project pool. `projectId` pins later turns to the first project. */
export function geminiProvider(db, config, fetchImpl = fetch) {
  return {
    mock: false,
    async agentTurn({ model, system, tools, input, previous, projectId }) {
      const settings = await geminiSettings(db);
      const candidates = await geminiProjectCandidates(db, config);
      const project = projectId ? candidates.find(c => c.id === projectId) : candidates[0];
      if (!project) throw new ProviderError({ code: 'NOT_CONFIGURED', message: projectId ? '任务绑定的 Gemini Project 已停用或冷却中' : 'Gemini Project Pool 尚未配置' });
      const { data, latencyMs } = await post(settings.endpoint, project.apiKey, geminiAgentBody({ model, system, tools, input, previous }), settings.timeoutMs, fetchImpl);
      return { ...parseGeminiAgent(data), latencyMs, projectId: project.id };
    }
  };
}
