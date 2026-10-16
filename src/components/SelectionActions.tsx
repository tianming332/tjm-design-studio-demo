// Floating bar under the selection: AI operations scoped to the selection (智能选区＋AI 操作).
// Buttons run the same engine batches as the agent's region tools; the text box hands the
// request to the Design Agent with the selection as its scope.
import { useState } from 'react';
import { useStore } from '../state/store';
import { useAgent } from '../state/agent';
import { creationPrompt } from '../ai/creation';
import { GRADES } from './contextMenus';

export function SelectionActions({ view }: { view: { tx: number; ty: number; scale: number } }) {
  const st = useStore();
  const ag = useAgent();
  const [text, setText] = useState('');
  const sel = st.selection;
  if (!sel || !st.session || st.transformSession || st.typeEditing || st.cropSession) return null;
  const left = view.tx + (sel.x + sel.width / 2) * view.scale, top = view.ty + (sel.y + sel.height) * view.scale + 10;
  const off = st.busy;
  const ask = () => {
    const brief = text.trim();
    if (!brief) return;
    setText('');
    void ag.start(creationPrompt('layered', `（用户已框选区域 [${sel.x},${sel.y},${sel.width},${sel.height}]，只修改选区内，选区外保持不变）${brief}`), false);
  };
  return <div className="selection-actions" data-testid="selection-actions" role="toolbar" aria-label="选区 AI 操作"
    style={{ left, top }} onPointerDown={(e) => e.stopPropagation()} onContextMenu={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
    <button disabled={off} onClick={() => void st.smartSelect('object')} title="在框选范围内识别物体并精确选中">识别物体</button>
    <button disabled={off} onClick={() => void st.regionOp('cutout')}>抠出</button>
    <button disabled={off} onClick={() => void st.regionOp('remove')}>移除</button>
    <select aria-label="选区调色" disabled={off} value="" onChange={(e) => { const g = GRADES[Number(e.target.value)]; if (g) void st.regionAdjust(g.adjust); }}>
      <option value="" disabled>调色</option>
      {GRADES.map((g, i) => <option key={g.label} value={i}>{g.label}</option>)}
    </select>
    <input aria-label="一句话修改选区" placeholder="一句话修改选区…" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') ask(); }} />
    <button disabled={!text.trim() || !!ag.task && !['completed', 'failed', 'cancelled'].includes(ag.task.state)} onClick={ask}>交给 Agent</button>
  </div>;
}
