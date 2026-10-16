import { useEffect, useState } from 'react';
import { useStore } from '../state/store';
import type { LayerNode } from '../engine/protocol';

/** Explicit apply gives IME/multiline editing one undo entry and never commits into a new selection. */
export function TextContentEditor({ layer, docId }: { layer: LayerNode; docId: string }) {
  const current = layer.text?.text ?? '';
  const [draft, setDraft] = useState(current), [base, setBase] = useState(current);
  const [message, setMessage] = useState('');
  const busy = useStore((s) => s.busy);
  const onCanvas = useStore((s) => !!s.typeEditing);
  const dirty = draft !== base;
  useEffect(() => { if (!dirty) { setDraft(current); setBase(current); } }, [current, dirty]);
  const conflict = current !== base && dirty;
  const disabled = busy || !!layer.locks?.all || !!layer.locks?.pixels || onCanvas;
  const apply = async () => {
    setMessage('');
    if (await useStore.getState().editTextContent(layer.id, draft, base, docId)) setBase(draft);
    else setMessage(useStore.getState().error ?? '文本未应用');
  };
  return <div className="text-content-editor">
    <label htmlFor={`text-content-${layer.id}`}>文本内容</label>
    <textarea id={`text-content-${layer.id}`} aria-label="编辑文本内容" rows={3} value={draft} disabled={disabled}
      onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => {
        if (e.nativeEvent.isComposing || e.keyCode === 229) return;
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); if (!disabled && dirty && !conflict) void apply(); }
      }} />
    <div className="text-content-actions"><small>{onCanvas ? '先完成画布文字输入' : conflict ? '原文已变化，请重新载入' : '⌘ / Ctrl + Enter 应用'}</small>
      {(dirty || conflict) && <button onClick={() => { setDraft(current); setBase(current); setMessage(''); }} disabled={busy}>{conflict ? '重新载入' : '取消'}</button>}
      <button disabled={disabled || !dirty || conflict} onClick={() => void apply()}>应用文本</button>
    </div>
    {message && <p className="ai-error" role="alert">{message}</p>}
  </div>;
}
