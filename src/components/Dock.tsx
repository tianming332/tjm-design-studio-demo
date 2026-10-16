// Dockable / floating panels (A30 #18). Unlock the layout to drag panel tabs between groups,
// out into floating windows (drop over the canvas) or back into the dock; resize, collapse
// ("小窗口"), close and reopen from the 窗口 menu. Locked = fixed. Workspaces are saved.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useStore, SELECT_TOOLS, PATH_TOOLS } from '../state/store';
import { useAppearance } from '../state/appearance';
import {
  ALL_PANELS, PANEL_TITLES, PRESETS, closePanel, dockGroup, floatGroup, hiddenPanels, movePanel, updateGroup, useLayout, visiblePanelTabs,
  type DropTarget, type FloatGroup, type PanelGroup, type PanelId,
} from '../state/layout';
import { DocumentProperties } from './Inspector';
import { AssetsPanel } from './AssetsPanel';
import { Modal } from './Modal';
import { TaskPanel } from './TaskPanel';
import { LayersPanel } from './LayersPanel';
import { SelectionPanel } from './SelectionPanel';
import { FilterPanel } from './FilterPanel';
import { FxPanel } from './FxPanel';
import { PathPanel } from './PathPanel';
import { ExtrasPanel } from './ExtrasPanel';
import { HistoryPanel } from './HistoryPanel';
import { Icon } from './Icon';
import { Popover } from './Popover';
import { openPanel, selectPanelLayout, resetPanelLayout, useNavigation } from '../state/navigation';

export { openPanel } from '../state/navigation';

function Empty({ icon, title, text }: { icon: string; title: string; text: string }) {
  return <div className="panel-empty"><Icon name={icon} size={25} /><strong>{title}</strong><p>{text}</p></div>;
}

export function PanelContent({ id }: { id: PanelId }) {
  const hasDoc = useStore((s) => !!s.doc);
  const tool = useStore((s) => s.activeTool);
  switch (id) {
    case 'properties': return <DocumentProperties />;
    case 'task': return <TaskPanel />;
    case 'adjustments': return hasDoc ? <><FilterPanel /><FxPanel /></> : <Empty icon="sliders" title="调整你的图片" text="打开文档后使用滤镜与图层样式。" />;
    case 'more': return hasDoc ? <>
      <details className="panel-section" open={SELECT_TOOLS.includes(tool) || !PATH_TOOLS.includes(tool)}><summary>选区与编辑</summary><SelectionPanel /></details>
      <details className="panel-section" open={PATH_TOOLS.includes(tool)}><summary>路径与形状</summary><PathPanel /></details>
      <details className="panel-section"><summary>标尺、通道与参考线</summary><ExtrasPanel /></details>
    </> : <Empty icon="panel" title="更多编辑工具" text="打开文档后查看选区、路径和参考线。" />;
    case 'history': return hasDoc ? <HistoryPanel /> : <Empty icon="history" title="暂无历史记录" text="文档编辑操作会显示在这里。" />;
    case 'layers': return <LayersPanel />;
    case 'agent': case 'generate': return null;
    case 'assets': return <AssetsPanel />;
  }
}

/** Starts a tab drag (unlocked only); the drop target follows the pointer. */
function useTabDrag() {
  return (p: PanelId, e: React.PointerEvent) => {
    if (useLayout.getState().locked || e.button !== 0) return;
    const sx = e.clientX, sy = e.clientY;
    let started = false;
    const move = (ev: PointerEvent) => {
      if (!started && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 5) return;
      started = true;
      useLayout.setState({ dragging: { panel: p, x: ev.clientX, y: ev.clientY, target: dropAt(ev.clientX, ev.clientY) } });
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      const d = useLayout.getState().dragging;
      useLayout.setState({ dragging: undefined });
      if (!started || !d) return;
      const t = dropAt(ev.clientX, ev.clientY);
      if (t) { const L = useLayout.getState(); L.set(movePanel(L.layout, p, t)); }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
}

/** Group tab bars and dock slots carry data attributes; anywhere over the workspace floats. */
function dropAt(x: number, y: number): DropTarget | undefined {
  const el = document.elementFromPoint(x, y) as HTMLElement | null;
  const g = el?.closest<HTMLElement>('[data-drop-group]');
  if (g) return { kind: 'group', group: g.dataset.dropGroup! };
  const slot = el?.closest<HTMLElement>('[data-drop-dock]');
  if (slot) return { kind: 'dock', index: Number(slot.dataset.dropDock) };
  const app = document.querySelector('.app')?.getBoundingClientRect();
  if (el?.closest('.workspace, .floating-layer') && app) return { kind: 'float', x: x - app.left - 40, y: y - app.top - 12 };
  return undefined;
}

function GroupView({ g: raw, floating, children }: { g: PanelGroup; floating?: boolean; children?: ReactNode }) {
  const g = { ...raw, active: raw.active === 'agent' || raw.active === 'generate' ? visiblePanelTabs(raw)[0] ?? 'properties' : raw.active };
  const locked = useLayout((s) => s.locked);
  const dragging = useLayout((s) => s.dragging);
  const startDrag = useTabDrag();
  const [visited, setVisited] = useState<PanelId[]>([g.active]);
  useEffect(() => { setVisited((panels) => panels.includes(g.active) ? panels : [...panels, g.active]); }, [g.active]);
  const visible = visiblePanelTabs(g);
  const L = () => useLayout.getState();
  const over = dragging?.target?.kind === 'group' && dragging.target.group === g.id;
  return (
    <section className={`panel-group${g.collapsed ? ' collapsed' : ''}${floating ? ' floating' : ''}`} data-group={g.id} aria-label={g.panels.map((p) => PANEL_TITLES[p]).join('、')}>
      <div className={`panel-tabs${over ? ' drop-over' : ''}`} role="tablist" aria-label="面板切换" data-drop-group={g.id}
        onKeyDown={(e) => {
          if (!(e.target instanceof HTMLElement) || e.target.getAttribute('role') !== 'tab' || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
          e.preventDefault(); e.stopPropagation();
          const tabs = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('[role=tab]'));
          const i = tabs.indexOf(e.target as HTMLButtonElement);
          const next = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
          tabs[next]?.focus(); tabs[next]?.click();
        }}>
        {children}
        {visible.map((p) => (
          <button
            key={p} role="tab" aria-selected={g.active === p} data-panel={p}
            id={`tab-${g.id}-${p}`} aria-controls={`body-${g.id}-${p}`} tabIndex={g.active === p ? 0 : -1}
            className={`panel-tab${g.active === p ? ' active' : ''}${!locked ? ' draggable' : ''}`}
            title={locked ? PANEL_TITLES[p] : `${PANEL_TITLES[p]} · 拖动可移到其他面板组或拖到画布上成为浮动窗口`}
            onClick={() => openPanel(p)}
            onPointerDown={(e) => startDrag(p, e)}
          >
            {PANEL_TITLES[p]}
            {!locked && <span className="tab-close" role="button" aria-label={`关闭${PANEL_TITLES[p]}面板`} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); L().set(closePanel(L().layout, p)); }}>×</span>}
          </button>
        ))}
        <span className="panel-tabs-spacer" />
        <button className="icon-button group-btn" aria-label={g.collapsed ? '展开面板组' : '折叠面板组'} title={g.collapsed ? '展开' : '折叠为小窗口'} onClick={() => L().set(updateGroup(L().layout, g.id, { collapsed: !g.collapsed }))}>
          <Icon name="chevron" size={13} style={{ transform: g.collapsed ? 'rotate(-90deg)' : undefined }} />
        </button>
        {!locked && !floating && (
          <button className="icon-button group-btn" aria-label="浮动此面板组" title="变成浮动窗口" onClick={() => { const r = document.querySelector(`[data-group="${g.id}"]`)?.getBoundingClientRect(); const a = document.querySelector('.app')?.getBoundingClientRect(); L().set(floatGroup(L().layout, g.id, (r?.left ?? 300) - (a?.left ?? 0) - 320, (r?.top ?? 100) - (a?.top ?? 0))); }}>
            <Icon name="image2" size={13} />
          </button>
        )}
      </div>
      {visible.map((p) => (
        <div key={p} id={`body-${g.id}-${p}`} className="panel-body" role="tabpanel" aria-label={PANEL_TITLES[p]} hidden={g.collapsed || g.active !== p} data-panel-body={p}>
          {(visited.includes(p) || g.active === p) && <PanelContent id={p} />}
        </div>
      ))}
    </section>
  );
}

/** Right (or left) dock: groups stacked vertically; unlocked shows drop slots and size handles. */
export function DockArea() {
  const layout = useLayout((s) => s.layout);
  const locked = useLayout((s) => s.locked);
  const dragging = useLayout((s) => s.dragging);
  const drawer = useAppearance((s) => s.drawerOpen);
  const dock = layout.dock.filter((g) => visiblePanelTabs(g).length);
  const size = (g: PanelGroup) => g.size ?? (g.panels.includes('layers') ? 1.3 : 1.1);
  const width = useAppearance((s) => s.preferences.panelWidth);
  const update = useAppearance((s) => s.update);
  const closeDrawer = () => { useAppearance.setState({ drawerOpen: false }); document.querySelector<HTMLButtonElement>('.panel-toggle')?.focus(); };
  useEffect(() => {
    if (!drawer) return;
    const close = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && window.innerWidth < 1100 && !document.querySelector('dialog[open], [data-editor-popover]')) closeDrawer();
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [drawer]);
  const widthDrag = useRef<{ start: number; width: number; next: number }>();
  useEffect(() => { document.documentElement.style.setProperty('--panel-width', `${width}px`); }, [width]);
  const sizeDrag = (i: number) => (e: React.PointerEvent) => {
    const groups = dock;
    const a = groups[i], b = groups[i + 1];
    const els = Array.from(document.querySelectorAll<HTMLElement>('.dock-area > .dock-cell > .panel-group'));
    const ha = els[i]?.offsetHeight ?? 200, hb = els[i + 1]?.offsetHeight ?? 200;
    const total = size(a) + size(b);
    const sy = e.clientY;
    (e.target as Element).setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const d = ev.clientY - sy;
      const na = Math.max(60, ha + d), nb = Math.max(60, hb - d);
      const sa = (na / (na + nb)) * total;
      const L = useLayout.getState();
      let l = updateGroup(L.layout, a.id, { size: sa });
      l = updateGroup(l, b.id, { size: total - sa });
      useLayout.setState({ layout: l });
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); useLayout.getState().set(useLayout.getState().layout); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  // Drop slots overlay the group edges (absolutely positioned) so nothing shifts mid-drag.
  const slot = (i: number, last = false) => (!locked && dragging ? (
    <div key={`slot-${i}`} className={`dock-slot${last ? ' last' : ''}${dragging.target?.kind === 'dock' && dragging.target.index === i ? ' drop-over' : ''}`} data-drop-dock={i}>放到这里：新面板组</div>
  ) : null);
  return (
    <aside className={`rightrail dock-area${drawer ? ' drawer-open' : ''}${locked ? '' : ' unlocked'}`} aria-label="面板">
      <div className="panel-resizer" role="separator" tabIndex={0} aria-label="调整面板宽度" aria-orientation="vertical" aria-valuemin={260} aria-valuemax={400} aria-valuenow={width}
        onKeyDown={(e) => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); update({ panelWidth: Math.max(260, Math.min(400, width + (e.key === 'ArrowLeft' ? 10 : -10) * (layout.dockSide === 'left' ? -1 : 1))) }); } }}
        onPointerDown={(e) => { widthDrag.current = { start: e.clientX, width, next: width }; e.currentTarget.setPointerCapture(e.pointerId); }}
        onPointerMove={(e) => { const d = widthDrag.current; if (!d) return; d.next = Math.max(260, Math.min(400, d.width + (d.start - e.clientX) * (layout.dockSide === 'left' ? -1 : 1))); document.documentElement.style.setProperty('--panel-width', `${d.next}px`); }}
        onPointerUp={() => { if (widthDrag.current) update({ panelWidth: widthDrag.current.next }); widthDrag.current = undefined; }}
        onPointerCancel={() => { widthDrag.current = undefined; document.documentElement.style.setProperty('--panel-width', `${width}px`); }}
      />
      <div className="drawer-heading"><strong>工具与图层</strong><button className="icon-button" aria-label="关闭属性面板" onClick={closeDrawer}><Icon name="close" size={16} /></button></div>
      <LayoutLockBar />
      {dock.map((g, i) => (
        <div key={g.id} className="dock-cell" style={{ flex: g.collapsed ? '0 0 auto' : `${size(g)} 1 0` }}>
          {slot(i)}
          <GroupView g={g} />
          {i < dock.length - 1 && !g.collapsed && !dock[i + 1].collapsed && <div className="group-resizer" role="separator" aria-label="调整面板组高度" aria-orientation="horizontal" tabIndex={0}
            onKeyDown={(e) => {
              if (!['ArrowUp', 'ArrowDown'].includes(e.key)) return;
              e.preventDefault(); e.stopPropagation();
              const a = size(g), next = dock[i + 1], b = size(next);
              const value = Math.max(.25, Math.min(a + b - .25, a + (e.key === 'ArrowDown' ? .15 : -.15)));
              useLayout.getState().set(updateGroup(updateGroup(layout, g.id, { size: value }), next.id, { size: a + b - value }));
            }} onPointerDown={sizeDrag(i)} />}
        </div>
      ))}
      {slot(layout.dock.length, true)}
      {!layout.dock.length && <div className="panel-empty"><p>所有面板都已关闭或浮动。<br />从顶栏「窗口」菜单重新打开。</p></div>}
    </aside>
  );
}

export function LayoutLockBar() {
  const locked = useLayout((s) => s.locked);
  const current = useLayout((s) => s.current);
  const setLocked = useLayout((s) => s.setLocked);
  const ai = useNavigation((s) => s.mode === 'design');
  return (
    <div className={`layout-lockbar${locked ? '' : ' editing'}`}>
      <span className="layout-name" title="解锁后可以调整面板位置与大小">{ai ? 'AI需求分解框' : current}</span>
      <button className="quiet-button" aria-pressed={!locked} aria-label={locked ? '解锁布局' : '锁定布局'} onClick={() => setLocked(!locked)}
        title={locked ? '点击解锁后，可拖动标题移动面板、拖动边缘调整大小。' : '锁定布局：面板固定，不再拖动'}>
        <Icon name={locked ? 'lock' : 'unlock'} size={13} />{locked ? '布局已锁定' : '完成布局'}
      </button>
    </div>
  );
}

function FloatWindow({ g }: { g: FloatGroup }) {
  const locked = useLayout((s) => s.locked);
  const L = () => useLayout.getState();
  const drag = (kind: 'move' | 'resize') => (e: React.PointerEvent) => {
    if (locked && kind === 'resize') return;
    if ((e.target as HTMLElement).closest('button, [role=tab]') && kind === 'move') return;
    if (locked) return;
    e.preventDefault();
    const sx = e.clientX, sy = e.clientY, g0 = { ...g };
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - sx, dy = ev.clientY - sy;
      const patch = kind === 'move' ? { x: Math.max(0, g0.x + dx), y: Math.max(0, g0.y + dy) } : { w: Math.max(220, g0.w + dx), h: Math.max(120, g0.h + dy) };
      useLayout.setState({ layout: updateGroup(L().layout, g.id, patch) });
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      // Dropping a window's title bar on the dock docks the whole group.
      const el = document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null;
      const slot = el?.closest<HTMLElement>('[data-drop-dock]');
      if (kind === 'move' && slot) L().set(dockGroup(L().layout, g.id, Number(slot.dataset.dropDock)));
      else L().set(L().layout);
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  return (
    <div className={`floating-window${g.collapsed ? ' collapsed' : ''}`} style={{ left: g.x, top: g.y, width: g.w, height: g.collapsed ? undefined : g.h }} role="dialog" aria-label={`浮动面板：${g.panels.map((p) => PANEL_TITLES[p]).join('、')}`}>
      <div className="float-titlebar" onPointerDown={drag('move')} title={locked ? '布局已锁定' : '拖动移动；拖到右侧面板区停靠'}>
        <GroupView g={g} floating>
          {!locked && <span className="float-grip" aria-hidden="true">⠿</span>}
        </GroupView>
        {!locked && (
          <div className="float-actions">
            <button className="icon-button" aria-label="停靠到面板区" title="停靠到面板区" onClick={() => L().set(dockGroup(L().layout, g.id))}><Icon name="panel" size={13} /></button>
          </div>
        )}
      </div>
      {!locked && !g.collapsed && <div className="float-resize" aria-label="调整浮动窗口大小" onPointerDown={drag('resize')} />}
    </div>
  );
}

/** Floating windows and the drag ghost, above the canvas. */
export function FloatingLayer() {
  const floating = useLayout((s) => s.layout.floating);
  const dragging = useLayout((s) => s.dragging);
  return (
    <div className="floating-layer" aria-hidden={floating.length ? undefined : true}>
      {floating.map((g) => <FloatWindow key={g.id} g={g} />)}
      {dragging && <div className="tab-ghost" style={{ left: dragging.x + 8, top: dragging.y + 8 }}>{PANEL_TITLES[dragging.panel]}{dragging.target?.kind === 'float' ? ' · 浮动窗口' : dragging.target ? ' · 放入面板组' : ''}</div>}
    </div>
  );
}

/** Top-bar 窗口 menu: panels, workspaces (switch / save / reset / delete), lock, sides. */
export function WindowMenu() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const S = useLayout();
  const ai = useNavigation((s) => s.mode === 'design');
  const hidden = hiddenPanels(S.layout);
  const names = [...Object.keys(PRESETS), ...Object.keys(S.saved).filter((k) => !(k in PRESETS))];
  return (
    <div className="export-anchor">
      <button className="quiet-button" aria-expanded={open} onClick={() => setOpen(!open)}>窗口<Icon name="chevron" size={12} /></button>
      {open && (
        <Popover label="窗口菜单" className="file-menu window-menu" onClose={() => setOpen(false)}>
          <div className="popover-heading">{ai ? '打开工具面板' : '显示 / 隐藏面板'}</div>
          {ALL_PANELS.filter((p) => p !== 'agent' && p !== 'generate').map((p) => (
            <button key={p} className="menu-item" role={ai ? 'menuitem' : 'menuitemcheckbox'} aria-checked={ai ? undefined : !hidden.includes(p)}
              onClick={() => { if (ai) { openPanel(p); setOpen(false); } else if (hidden.includes(p)) openPanel(p); else S.set(closePanel(S.layout, p)); }}>
              <span>{ai ? '' : hidden.includes(p) ? '　' : '✓'} {PANEL_TITLES[p]}</span>
            </button>
          ))}
          <hr />
          <div className="popover-heading">面板布局</div>
          <p className="menu-help">仅改变面板摆放，不切换创作方式或编辑场景。</p>
          {names.map((n) => (
            <div key={n} className="menu-row">
              <button className="menu-item" role="menuitemradio" aria-checked={S.current === n} onClick={() => { selectPanelLayout(n); setOpen(false); }}><span>{S.current === n ? '✓' : '　'} {n}</span></button>
              {n in S.saved && !(n in PRESETS) && <button className="icon-button" aria-label={`删除面板布局 ${n}`} onClick={() => S.remove(n)}><Icon name="trash" size={13} /></button>}
            </div>
          ))}
          <button className="menu-item" onClick={() => { resetPanelLayout(); setOpen(false); }}><span>复位「{S.current}」</span></button>
          <details><summary>保存为自定义布局</summary><div className="menu-row">
            <input aria-label="新面板布局名称" placeholder="输入布局名称" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) { S.saveAs(name); setName(''); } }} />
            <button disabled={!name.trim()} onClick={() => { S.saveAs(name); setName(''); }}>保存</button>
          </div></details>
          <hr />
          <button className="menu-item" aria-pressed={!S.locked} onClick={() => S.setLocked(!S.locked)}><span>{S.locked ? '解锁布局（编辑面板位置）' : '锁定布局'}</span></button>
          <button className="menu-item" onClick={() => S.set({ ...S.layout, toolbarSide: S.layout.toolbarSide === 'left' ? 'right' : 'left' })}><span>工具栏放到{S.layout.toolbarSide === 'left' ? '右侧' : '左侧'}</span></button>
          <button className="menu-item" onClick={() => S.set({ ...S.layout, dockSide: S.layout.dockSide === 'right' ? 'left' : 'right' })}><span>面板区放到{S.layout.dockSide === 'right' ? '左侧' : '右侧'}</span></button>
        </Popover>
      )}
    </div>
  );
}

/** Temporary utility window: opening assets/history does not navigate away from the AI brief. */
export function UtilityWindow() {
  const utility = useNavigation((s) => s.utility);
  if (!utility) return null;
  return <Modal title={PANEL_TITLES[utility]} className="utility-window" onClose={() => useNavigation.setState({ utility: undefined })}>
    <div className="utility-content"><PanelContent id={utility} /></div>
  </Modal>;
}
