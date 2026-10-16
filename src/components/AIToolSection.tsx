// AI 工具 in the left toolbar (shown once an experience code is active, in both 手动编辑 and AI 制图):
// the same smart-selection, selection-operation, text-effect and layout-check actions the agent
// uses, so manual edits can reach them without going through the agent.
import { useState } from 'react';
import { useStore, flatten } from '../state/store';
import { useWb, hasAccess } from '../state/workbench';
import { TEXT_FX_PRESETS } from '../engine/textfx';
import type { LintIssue } from '../engine/layout';
import { GRADES } from './contextMenus';
import { Icon } from './Icon';
import { Popover } from './Popover';

type Panel = 'select' | 'region' | 'text' | 'lint';
const BUTTONS: { id: Panel; icon: string; label: string }[] = [
  { id: 'select', icon: 'sparkles', label: 'AI 智能选区' },
  { id: 'region', icon: 'mask', label: 'AI 选区操作' },
  { id: 'text', icon: 'fx', label: '特效字与立体字' },
  { id: 'lint', icon: 'check', label: '排版检查' },
];

export function AIToolSection({ side }: { side: 'left' | 'right' }) {
  const access = useWb(hasAccess);
  const st = useStore();
  const [open, setOpen] = useState<{ panel: Panel; top: number } | null>(null);
  const [issues, setIssues] = useState<LintIssue[] | null>(null);
  if (!access) return null;
  const off = !st.session || st.busy;
  const sel = !!st.selection;
  const layer = flatten(st.layers).find((l) => l.id === st.selectedId);
  const run = (p: Promise<unknown>) => { setOpen(null); void p; };
  const item = (label: string, onClick: () => void, disabled = false, hint?: string) =>
    <button key={label} className="menu-item" disabled={off || disabled} title={hint} onClick={onClick}><span>{label}</span>{hint && disabled && <small>{hint}</small>}</button>;
  const toggle = (panel: Panel, e: React.MouseEvent<HTMLButtonElement>) => {
    if (open?.panel === panel) { setOpen(null); return; }
    setOpen({ panel, top: Math.min(e.currentTarget.getBoundingClientRect().top, window.innerHeight - 360) });
    if (panel === 'lint') { setIssues(null); void st.lintDocument().then(setIssues); }
  };
  return <div className="tool-section ai-tool-section" aria-label="AI 工具">
    <span className="ai-tool-badge" aria-hidden="true">AI</span>
    {BUTTONS.map((b) => <div className="tool-slot" key={b.id}>
      <button className={'tool' + (open?.panel === b.id ? ' active' : '')} aria-label={b.label} title={b.label} aria-expanded={open?.panel === b.id} disabled={!st.session} onClick={(e) => toggle(b.id, e)}><Icon name={b.icon} /></button>
    </div>)}
    {open && <Popover label={BUTTONS.find((b) => b.id === open.panel)!.label} className="tool-popover ai-tool-popover" style={{ top: Math.max(84, open.top), ...(side === 'right' ? { right: 54, left: 'auto' } : { left: 54 }) }} onClose={() => setOpen(null)}>
      <div className="popover-heading">{BUTTONS.find((b) => b.id === open.panel)!.label}<button className="icon-button" aria-label="关闭" onClick={() => setOpen(null)}><Icon name="close" size={14} /></button></div>
      {open.panel === 'select' && <>
        {item('选择主体', () => run(st.smartSelect('subject')))}
        {item('焦点区域', () => run(st.smartSelect('focus')))}
        {item('识别框内物体', () => run(st.smartSelect('object')), !sel, '先框出大致范围')}
        {item('平滑边缘', () => run(st.refineSelection({ radius: 4, smooth: 20, feather: 1 })), !sel, '需要选区')}
        {item('取消选择', () => run(st.selectMenu('deselect')), !sel)}
      </>}
      {open.panel === 'region' && <>
        {item('抠出为图层', () => run(st.regionOp('cutout')), !sel, '需要选区')}
        {item('移除（内容识别）', () => run(st.regionOp('remove')), !sel, '需要选区')}
        <div className="popover-subheading">{sel ? '调色（仅选区）' : '调色（整体）'}</div>
        {GRADES.map((g) => item(g.label, () => run(st.regionAdjust(g.adjust))))}
      </>}
      {open.panel === 'text' && <>
        <div className="popover-subheading">{layer ? `应用到「${layer.name.slice(0, 12)}」` : '先选择一个图层'}</div>
        {Object.entries(TEXT_FX_PRESETS).map(([k, v]) => item(v.label, () => run(st.applyTextFx({ preset: k, accent: k === 'neon' || k === 'glow' ? st.foreground : undefined })), !layer))}
        {item('生成立体字', () => run(st.extrudeSelected({ sideColor: '#333333' })), !layer)}
        {item('弧形文字', () => run(st.applyTextFx({ warp: { style: 'arc', bend: 30 } })), layer?.kind !== 'Type', '需要文字图层')}
        {item('清除样式', () => run(st.clearLayerStyle()), !layer)}
      </>}
      {open.panel === 'lint' && <div className="ai-lint" data-testid="ai-lint">
        {issues == null ? <p>检查中…</p> : issues.length === 0 ? <p>没有发现越界、重叠、过小或对比度不足的文字。</p>
          : issues.map((i, n) => <button key={n} className={`menu-item lint-${i.severity}`} onClick={() => { if (i.layer != null) st.selectLayer(i.layer); setOpen(null); }}><span>{i.message}</span></button>)}
      </div>}
    </Popover>}
  </div>;
}
