import { useEffect, useRef, useState } from 'react';
import { useNavigation, openPanel, setAgentSide } from '../state/navigation';
import { useStore } from '../state/store';
import { AgentPanel } from './AgentPanel';
import { Icon } from './Icon';
import { LayoutLockBar, PanelContent } from './Dock';
import { PANEL_TITLES, useLayout, type PanelId } from '../state/layout';
import { useStudioLayout } from '../state/studioLayout';
import { useAgent } from '../state/agent';
import { designSignal, useDesignActivity } from '../state/designActivity';
import { useAppearance } from '../state/appearance';

const PRIMARY_PANELS: PanelId[] = ['agent', 'assets'];
const EXTRA_PANELS: PanelId[] = ['task', 'adjustments', 'more', 'history'];
const panelTitle = (id: PanelId) => id === 'agent' ? '对话' : id === 'generate' ? 'AI 生图' : PANEL_TITLES[id];

/** Keep forms mounted after first use so switching never discards an unfinished brief. */
export function AIStudio() {
  const mode = useNavigation((s) => s.mode);
  const preview = useNavigation((s) => s.preview);
  const agentSide = useNavigation((s) => s.agentSide);
  const preferenceError = useNavigation((s) => s.preferenceError);
  const panel = useNavigation((s) => s.studioPanel);
  const panels = [...PRIMARY_PANELS, ...EXTRA_PANELS.filter((p) => p === panel)];
  const locked = useLayout((s) => s.locked);
  const share = useStudioLayout((s) => s.agentShare);
  const layoutError = useStudioLayout((s) => s.error);
  const drag = useRef<{ x: number; start: number; next: number }>();
  const headingDrag = useRef<number>();
  const [visited, setVisited] = useState(mode === 'design');
  useEffect(() => { if (mode === 'design') setVisited(true); }, [mode]);
  return <aside className="ai-studio" aria-label="AI 创作空间" hidden={mode === 'manual' || preview}>
    <LayoutLockBar />
    {!locked && <p className="studio-layout-tip">拖动标题换边 · 拖动边缘调宽 · 画布面板可拖动</p>}
    <div className="studio-toolbar">
      <span className={`studio-kicker${locked ? '' : ' draggable'}`} role="button" aria-label="移动 Agent 面板" aria-disabled={locked} tabIndex={locked ? -1 : 0}
        title={locked ? '解锁布局后可拖动' : '拖到工作区另一侧；也可按左右方向键'}
        onKeyDown={(e) => { if (!locked && ['ArrowLeft','ArrowRight'].includes(e.key)) { e.preventDefault(); e.stopPropagation(); setAgentSide(e.key === 'ArrowLeft' ? 'left' : 'right'); } }}
        onPointerDown={(e) => { if (!locked && e.button === 0) { e.currentTarget.setPointerCapture(e.pointerId); headingDrag.current = e.clientX; e.preventDefault(); } }}
        onPointerUp={(e) => { if (!locked && headingDrag.current !== undefined && Math.abs(e.clientX - headingDrag.current) > 50) setAgentSide(e.clientX < window.innerWidth / 2 ? 'left' : 'right'); headingDrag.current = undefined; }}
        onPointerCancel={() => { headingDrag.current = undefined; }}><span className="studio-status-dot" />TJM-DESIGN AGENT</span>
      <div>
        <button className="quiet-button studio-mobile-preview" onClick={() => useNavigation.setState({ preview: true })}><Icon name="image" size={15} />看画布</button></div>
    </div>
    <div className="studio-panel-tabs" role="tablist" aria-label="AI 工具面板"
      onKeyDown={(e) => {
        if (!(e.target instanceof HTMLButtonElement) || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
        e.preventDefault(); e.stopPropagation();
        const tabs = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('[role=tab]'));
        const i = tabs.indexOf(e.target);
        const next = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
        tabs[next]?.focus(); tabs[next]?.click();
      }}>
      {panels.map((p) => {
        const selected = panel === p;
        return <button key={p} role="tab" aria-selected={selected} tabIndex={selected ? 0 : -1} id={`studio-tab-${p}`}
          aria-controls={p === 'generate' || p === 'agent' ? 'studio-body-agent' : `studio-body-${p}`} data-studio-panel={p}
          onClick={() => openPanel(p)}>{panelTitle(p)}</button>;
      })}
    </div>
    {(preferenceError || layoutError) && <p className="studio-preference-error" role="status">{preferenceError || layoutError}</p>}
    <div className="studio-surface" role="tabpanel" id="studio-body-agent" aria-label="AI 需求与对话" hidden={panel !== 'agent'}>{(visited || mode === 'design') && <AgentPanel />}</div>
    {mode === 'design' && panel !== 'agent' && <div className={`studio-inspector studio-inspector-${panel}`} role="tabpanel" aria-label={PANEL_TITLES[panel]} id={`studio-body-${panel}`}>
      <PanelContent id={panel} />
    </div>}
    {!locked && <div className="studio-edge-resizer" role="separator" aria-label="调整 Agent 宽度" aria-orientation="vertical" aria-valuemin={30} aria-valuemax={55} aria-valuenow={share} tabIndex={0}
      onKeyDown={(e) => { if (!['ArrowLeft','ArrowRight'].includes(e.key)) return; e.preventDefault(); e.stopPropagation(); useStudioLayout.getState().update({ agentShare: share + (e.key === 'ArrowLeft' ? -2 : 2) * (agentSide === 'right' ? -1 : 1) }); }}
      onPointerDown={(e) => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); drag.current = { x: e.clientX, start: share, next: share }; }}
      onPointerMove={(e) => { if (!drag.current) return; const next = drag.current.start + (e.clientX - drag.current.x) / window.innerWidth * 100 * (agentSide === 'right' ? -1 : 1); drag.current.next = Math.max(30, Math.min(55, next)); useStudioLayout.setState({ agentShare: drag.current.next }); }}
      onPointerUp={() => { if (drag.current) useStudioLayout.getState().update({ agentShare: drag.current.next }); drag.current = undefined; }}
      onPointerCancel={() => { if (drag.current) useStudioLayout.setState({ agentShare: drag.current.start }); drag.current = undefined; }} />}
  </aside>;
}

/** Two icons in the canvas header that show / hide the floating 属性 and 图层 windows. */
function CanvasToolToggles() {
  const showProperties = useStudioLayout((s) => s.showProperties);
  const showLayers = useStudioLayout((s) => s.showLayers);
  const focus = useAppearance((s) => s.focus);
  if (focus) return null;
  return <div className="canvas-tool-toggles" role="group" aria-label="画布面板">
    <button className="icon-button" aria-pressed={showProperties} aria-label={showProperties ? '隐藏属性' : '显示属性'} title={showProperties ? '隐藏属性' : '显示属性'}
      onClick={() => useStudioLayout.getState().update({ showProperties: !showProperties })}><Icon name="sliders" size={16} /></button>
    <button className="icon-button" aria-pressed={showLayers} aria-label={showLayers ? '隐藏图层' : '显示图层'} title={showLayers ? '隐藏图层' : '显示图层'}
      onClick={() => useStudioLayout.getState().update({ showLayers: !showLayers })}><Icon name="layers" size={16} /></button>
  </div>;
}

export function AIPreviewHeader() {
  const hasDoc = useStore((s) => !!s.doc);
  const tabs = useStore((s) => s.tabs);
  const activeDocId = useStore((s) => s.activeDocId);
  const busy = useStore((s) => s.busy);
  const mode = useNavigation((s) => s.mode);
  const task = useAgent((s) => s.task);
  const error = useAgent((s) => s.error);
  const activity = useDesignActivity((s) => s.activity);
  const signal = designSignal(activeDocId, task, error, activity);
  if (mode === 'manual') return null;
  return <div className="ai-preview-heading">
    <div><span className="preview-caption">设计画布</span>{hasDoc
      ? <select className="preview-document" aria-label="预览文档" disabled={busy} value={activeDocId} onChange={(e) => void useStore.getState().switchTab(e.target.value)}>{tabs.map((t) => <option key={t.docId} value={t.docId}>{t.name}</option>)}</select>
      : null}
      <span className={`design-signal ${signal.color}`} data-testid="design-signal" data-color={signal.color} role="status" title={signal.label}><i aria-hidden="true" />{signal.label}</span>
    </div>
    <div className="preview-actions">
      <CanvasToolToggles />
      <button className="quiet-button studio-mobile-preview" onClick={() => useNavigation.setState({ preview: false })}>返回 AI</button>
    </div>
  </div>;
}
