import type { Capabilities, ModelOption } from './contract';
export function availableModels(caps: Capabilities | undefined, kind: 'agent' | 'image', references = false): ModelOption[] {
  const list = caps?.models?.[kind] ?? (kind === 'agent' && caps?.model ? [{ id: caps.model, label: caps.model === 'mock' ? '模拟模型' : caps.model, provider: caps.mock ? 'mock' : 'gemini' }] : []);
  return list.filter((m, i) => !!m.id && list.findIndex(v=>v.id===m.id)===i && (kind !== 'image' || (references ? m.supportsReferences !== false : m.supportsText !== false)));
}
const PROVIDER_LABEL: Record<string, string> = { mock: '测试用模拟模型', gemini: 'Google Gemini', openai: 'OpenAI', anthropic: 'Anthropic', glm: '智谱 GLM', deepseek: 'DeepSeek', qwen: '通义千问', doubao: '豆包' };
export const providerLabel = (p?: string): string => PROVIDER_LABEL[p ?? ''] ?? (p || '');
export function modelDisplayName(model: ModelOption): string {
  if (model.id === 'mock') return '模拟模型';
  // An admin-set display name is shown verbatim; a bare id gets light prettifying.
  if (model.label && model.label !== model.id) return model.label;
  return model.id.replace(/^gemini[-\s]/i, 'Gemini ').replace(/[-_]/g, ' ');
}
