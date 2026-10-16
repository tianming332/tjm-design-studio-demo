import type { Capabilities, ModelOption } from './contract';
export function availableModels(caps: Capabilities | undefined, kind: 'agent' | 'image', references = false): ModelOption[] {
  const list = caps?.models?.[kind] ?? (kind === 'agent' && caps?.model ? [{ id: caps.model, label: caps.model === 'mock' ? '模拟模型' : caps.model, provider: caps.mock ? 'mock' : 'gemini' }] : []);
  return list.filter((m, i) => !!m.id && list.findIndex(v=>v.id===m.id)===i && (kind !== 'image' || (references ? m.supportsReferences !== false : m.supportsText !== false)));
}
export function modelDisplayName(model: ModelOption): string {
  return model.id === 'mock' ? '模拟模型' : model.label.replace(/^gemini[-\s]/i, 'Gemini ').replace(/[-_]/g, ' ');
}
