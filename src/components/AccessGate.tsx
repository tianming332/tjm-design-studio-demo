// Local edition: no experience codes. The AI entry shows which model is bound and opens 设置 · AI.
import { useEffect } from 'react';
import { useWb } from '../state/workbench';
import { openAISettings } from './AISettings';
import { Icon } from './Icon';

export function AccessGate() {
  const wb = useWb();
  useEffect(() => { void useWb.getState().load(); }, []);
  const caps = wb.caps;
  const label = !caps ? '读取本地设置…' : caps.aiEnabled ? `${caps.model}` : '配置 AI（自带 Key）';
  return <button className="quota-button" data-testid="ai-settings" aria-haspopup="dialog" title="设置 · AI：服务商 Key 与模型" onClick={openAISettings}>
    <span>{label}</span><Icon name="settings" size={12} />
  </button>;
}
