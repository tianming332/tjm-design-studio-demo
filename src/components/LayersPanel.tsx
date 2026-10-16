import { useContextMenu } from './ContextMenu';
import { layerMenu } from './contextMenus';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../state/store';
import { Icon } from './Icon';
import { openPanel } from './Dock';
import { beginGesture, liveProps } from '../state/live';
import type { LayerNode } from '../engine/protocol';
import { Popover } from './Popover';
import { layerDropProblem, type LayerDropPosition } from '../engine/layerOrder';
import { ValueSlider } from './ValueSlider';

const BLEND_MODES = [
  'Normal', 'Multiply', 'Screen', 'Overlay', 'Darken', 'Lighten',
  'Color Dodge', 'Color Burn', 'Hard Light', 'Soft Light',
  'Difference', 'Exclusion', 'Hue', 'Saturation', 'Color', 'Luminosity',
];

function flattenWithDepth(nodes: LayerNode[], depth = 0, out: { node: LayerNode; depth: number }[] = []) {
  for (const n of nodes) { out.push({ node: n, depth }); if (n.children) flattenWithDepth(n.children, depth + 1, out); }
  return out;
}

export function LayersPanel() {
  const layers = useStore((s) => s.layers);
  const selectedId = useStore((s) => s.selectedId);
  const selectedIds = useStore((s) => s.selectedIds);
  const selectLayer = useStore((s) => s.selectLayer);
  const setProps = useStore((s) => s.setProps);
  const busy = useStore((s) => s.busy);
  const addMask = useStore((s) => s.addMask);
  const deleteMask = useStore((s) => s.deleteMask);
  const applyMask = useStore((s) => s.applyMask);
  const maskEditing = useStore((s) => s.maskEditing);
  const setMaskEditing = useStore((s) => s.setMaskEditing);
  const selection = useStore((s) => s.selection);
  const convertToSmartObject = useStore((s) => s.convertToSmartObject);
  const soViaCopy = useStore((s) => s.soViaCopy);
  const rasterizeSmartObject = useStore((s) => s.rasterizeSmartObject);
  const soToLayers = useStore((s) => s.soToLayers);
  const editSmartObject = useStore((s) => s.editSmartObject);
  const vectorMask = useStore((s) => s.vectorMask);
  const refreshVectorMask = useStore((s) => s.refreshVectorMask);
  const addVectorMaskFromPath = useStore((s) => s.addVectorMaskFromPath);
  const deleteVectorMask = useStore((s) => s.deleteVectorMask);
  const setVectorMaskEnabled = useStore((s) => s.setVectorMaskEnabled);
  useEffect(() => { void refreshVectorMask(); }, [selectedId, refreshVectorMask]);
  const newLayer = useStore((s) => s.newLayer);
  const duplicateLayer = useStore((s) => s.duplicateLayer);
  const deleteLayer = useStore((s) => s.deleteLayer);
  const layerFromBackground = useStore((s) => s.layerFromBackground);
  const groupLayers = useStore((s) => s.groupLayers);
  const setLocks = useStore((s) => s.setLocks);
  const mergeDown = useStore((s) => s.mergeDown);
  const mergeVisible = useStore((s) => s.mergeVisible);
  const flattenImage = useStore((s) => s.flattenImage);
  const newFillLayer = useStore((s) => s.newFillLayer);
  const createClippingMask = useStore((s) => s.createClippingMask);
  const releaseClippingMask = useStore((s) => s.releaseClippingMask);
  const hasDoc = useStore((s) => !!s.session);

  const rows = flattenWithDepth(layers);
  const selected = rows.find((r) => r.node.id === selectedId)?.node;
  const isBackground = !!selected && /^pixel$/i.test(selected.kind) && /^(背景|background)$/i.test(selected.name);
  const locks = selected?.locks;

  const [opacity, setOpacity] = useState(100);
  useEffect(() => { setOpacity(Math.round((selected?.opacity ?? 1) * 100)); }, [selectedId, selected?.opacity]);
  const [fillPct, setFillPct] = useState(100);
  useEffect(() => { setFillPct(Math.round((selected?.fill ?? 1) * 100)); }, [selectedId, selected?.fill]);
  const [renaming, setRenaming] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const [opsMenu, setOpsMenu] = useState<{ top: number; left: number }>();
  const list = useRef<HTMLDivElement>(null);
  const dragging = useRef<{ ids: number[]; startX: number; startY: number; active: boolean; docId: string; revision: number; target?: number; position?: LayerDropPosition; problem?: string }>();
  const [drop, setDrop] = useState<{ target: number; position: LayerDropPosition; problem?: string }>();
  const [dragCount, setDragCount] = useState(0);
  const suppressClick = useRef(false);
  const stopListeners = useRef<() => void>();
  useEffect(() => () => stopListeners.current?.(), []);
  const startReorder = (node: LayerNode, e: React.PointerEvent) => {
    if (busy || renaming !== null || e.button !== 0 || (e.target as HTMLElement).closest('button,input,select,textarea')) return;
    const st = useStore.getState();
    if (!st.activeDocId || !st.session) return;
    const ids = selectedIds.includes(node.id) ? [...selectedIds] : [node.id];
    stopListeners.current?.();
    dragging.current = { ids, startX: e.clientX, startY: e.clientY, active: false, docId: st.activeDocId, revision: st.session.currentRevision };
    const move = (ev: PointerEvent) => {
      const d = dragging.current; if (!d) return;
      if (!d.active && Math.hypot(ev.clientX - d.startX, ev.clientY - d.startY) < 5) return;
      d.active = true; ev.preventDefault(); suppressClick.current = true; setDragCount(d.ids.length);
      const box = list.current?.getBoundingClientRect();
      if (box && ev.clientX >= box.left && ev.clientX <= box.right) {
        if (ev.clientY < box.top + 30) list.current!.scrollTop -= 14;
        else if (ev.clientY > box.bottom - 30) list.current!.scrollTop += 14;
      }
      const row = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>('[data-layer-id]');
      if (!row || !list.current?.contains(row)) { d.target = undefined; setDrop(undefined); return; }
      const target = Number(row.dataset.layerId), bounds = row.getBoundingClientRect();
      const fraction = (ev.clientY - bounds.top) / bounds.height;
      const group = row.dataset.layerKind === 'group';
      const position: LayerDropPosition = group && fraction > .3 && fraction < .7 ? 'into' : fraction < .5 ? 'above' : 'below';
      const problem = layerDropProblem(useStore.getState().layers, d.ids, target, position);
      Object.assign(d, { target, position, problem });
      setDrop({ target, position, problem });
    };
    const cleanup = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel); window.removeEventListener('keydown', key);
      dragging.current = undefined; setDrop(undefined); setDragCount(0); stopListeners.current = undefined;
    };
    const cancel = () => { cleanup(); suppressClick.current = false; };
    const key = (ev: KeyboardEvent) => { if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); cancel(); } };
    const up = () => {
      const d = dragging.current;
      cleanup();
      if (d?.active && d.target !== undefined && d.position && !d.problem) void useStore.getState().reorderLayers(d.ids, d.target, d.position, d.docId, d.revision);
      if (d?.active) window.setTimeout(() => { suppressClick.current = false; }, 0);
    };
    window.addEventListener('pointermove', move, { passive: false }); window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel); window.addEventListener('keydown', key); stopListeners.current = cleanup;
  };
  const commitRename = (id: number) => {
    const name = draft.trim();
    setRenaming(null);
    const node = rows.find((r) => r.node.id === id)?.node;
    if (name && node && name !== node.name) void setProps(id, { name });
  };

  return (
    <section className="layers" aria-label="图层面板">
      <div className="layers-heading"><h3>全部图层 <span>{rows.length}</span></h3><span className="layers-selection-name" title={selected?.name}>{selected?.name ?? '未选择图层'}</span>
        <button className="quiet-button layer-command-trigger" disabled={!hasDoc} aria-label="合并与填充" aria-expanded={!!opsMenu} title="打开合并与填充窗口"
          onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setOpsMenu(opsMenu ? undefined : { top: Math.max(8, Math.min(r.bottom + 4, innerHeight - 245)), left: Math.max(8, Math.min(r.right - 260, innerWidth - 268)) }); }}>合并 / 填充</button>
      </div>
      {opsMenu && createPortal(
        <Popover label="合并与填充" className="panel-overflow-menu" style={{ position: 'fixed', ...opsMenu, width: 260 }} onClose={() => setOpsMenu(undefined)}>
          <div className="popover-heading">合并与填充</div>
          <div className="layer-menu-actions" onClick={(e) => { if ((e.target as HTMLElement).closest('button')) setOpsMenu(undefined); }}>
          <button onClick={() => void mergeDown()} disabled={busy || !selected} title="向下合并">向下合并</button>
          <button onClick={() => void mergeVisible()} disabled={busy} title="合并可见图层">合并可见</button>
          <button onClick={() => void flattenImage()} disabled={busy} title="拼合图像">拼合</button>
          <button onClick={() => void newFillLayer('solid')} disabled={busy} title="纯色填充图层">纯色层</button>
          <button onClick={() => void newFillLayer('gradient')} disabled={busy} title="渐变填充图层">渐变层</button>
          {isBackground && <button onClick={() => void layerFromBackground()} disabled={busy} title="背景转普通图层">背景转普通</button>}
          </div>
        </Popover>, document.body
      )}
      {selected && (
        <div className="layer-properties">
          <div className="layer-property-row">
            <span>混合模式</span>
            <select
              aria-label="图层混合模式"
              value={selected.blend ?? 'Normal'}
              disabled={busy}
              onChange={(e) => void setProps(selected.id, { blend: e.target.value })}
            >
              {BLEND_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div className="layer-sliders">
          <ValueSlider label="图层不透明度" min={0} max={100} value={opacity} unit="%" disabled={busy} onGestureStart={beginGesture} onChange={(v) => { setOpacity(v); liveProps(selected.id, { opacity: v / 100 }); }} />
          <ValueSlider label="填充不透明度" min={0} max={100} value={fillPct} unit="%" disabled={busy} onGestureStart={beginGesture} onChange={(v) => { setFillPct(v); liveProps(selected.id, { fill: v / 100 }); }} />
          </div>
          <div className="layer-locks" role="group" aria-label="锁定">
            <span>锁定</span>
            {LOCKS.map(([k, label, title]) => {
              const on = !!locks?.[k];
              return <button key={k} className={on ? 'on' : ''} aria-pressed={on} aria-label={`锁定${label}`} title={title}
                disabled={busy} onClick={() => void setLocks({ [k]: !on })}>{label}</button>;
            })}
          </div>
          <details className="layer-advanced"><summary>蒙版与智能对象</summary>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {!selected.hasMask && (
              <>
                <button onClick={() => void addMask('revealAll')} disabled={busy}>加白蒙版</button>
                <button onClick={() => void addMask('hideAll')} disabled={busy}>加黑蒙版</button>
                {selection && <button onClick={() => void addMask('revealSelection')} disabled={busy}>由选区</button>}
              </>
            )}
            {selected.hasMask && (
              <>
                <button
                  onClick={() => setMaskEditing(!maskEditing)}
                  style={{ background: maskEditing ? 'var(--accent-hi)' : undefined }}
                >
                  {maskEditing ? '编辑蒙版中' : '编辑蒙版'}
                </button>
                <button onClick={() => void applyMask()} disabled={busy}>应用</button>
                <button onClick={() => void deleteMask()} disabled={busy}>删除蒙版</button>
              </>
            )}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
            {vectorMask ? (
              <>
                <span className="vmask-badge" style={{ fontSize: 11, color: 'var(--text-dim)', alignSelf: 'center' }}>
                  矢量蒙版{vectorMask.enabled ? '' : '（停用）'}·{vectorMask.subpaths} 子路径
                </span>
                <button onClick={() => void setVectorMaskEnabled(!vectorMask.enabled)} disabled={busy}>
                  {vectorMask.enabled ? '停用矢量蒙版' : '启用矢量蒙版'}
                </button>
                <button onClick={() => void deleteVectorMask()} disabled={busy}>删除矢量蒙版</button>
              </>
            ) : (
              <button onClick={() => void addVectorMaskFromPath()} disabled={busy} title="用当前工作路径生成矢量蒙版">工作路径→矢量蒙版</button>
            )}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
            {selected.clipped
              ? <button onClick={() => void releaseClippingMask()} disabled={busy}>释放剪贴蒙版</button>
              : <button onClick={() => void createClippingMask()} disabled={busy}>剪贴到下层</button>}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
            {/smart.?object/i.test(selected.kind) ? (
              <>
                <button onClick={() => void editSmartObject()} disabled={busy}>编辑内容</button>
                <button onClick={() => void rasterizeSmartObject()} disabled={busy}>栅格化</button>
                <button onClick={() => void soToLayers()} disabled={busy}>转为图层</button>
                <button onClick={() => void soViaCopy()} disabled={busy}>拷贝新建</button>
              </>
            ) : (
              <button onClick={() => void convertToSmartObject()} disabled={busy}>转为智能对象</button>
            )}
          </div>
          </details>
        </div>
      )}
      {dragCount > 0 && <div className={`layer-drag-hint${drop?.problem ? ' invalid' : ''}`} role="status">{drop?.problem ?? `移动 ${dragCount} 个图层 · ${drop?.position === 'into' ? '放入编组' : drop?.position === 'above' ? '插入上方' : '插入下方'}`}</div>}
      <div ref={list} className={`layer-list${dragCount ? ' reordering' : ''}`} role="tree" aria-label="文档图层" aria-multiselectable="true">
      {rows.length === 0 && <div className="panel-empty layers-empty"><Icon name="layers" size={26} /><strong>图层将在这里显示</strong><p>用图层组织图片、文字和形状。</p></div>}
      {rows.map(({ node, depth }) => (
        <div
          key={node.id}
          className={'layer-row' + (selectedIds.includes(node.id) ? ' selected' : '') + (node.visible === false ? ' is-hidden' : '') + (drop?.target === node.id ? ` drop-${drop.position}${drop.problem ? ' drop-invalid' : ''}` : '')}
          data-layer-id={node.id} data-layer-kind={/group/i.test(node.kind) ? 'group' : 'layer'}
          onPointerDown={(e) => startReorder(node, e)}
          role="treeitem" aria-selected={selectedIds.includes(node.id)} aria-level={depth + 1} tabIndex={selectedId === node.id || (!selectedId && rows[0]?.node.id === node.id) ? 0 : -1}
          onKeyDown={(e) => {
            if (e.target instanceof HTMLInputElement) return;
            if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
              e.preventDefault(); e.stopPropagation();
              const i = rows.findIndex((r) => r.node.id === node.id);
              const next = e.key === 'Home' ? 0 : e.key === 'End' ? rows.length - 1 : Math.max(0, Math.min(rows.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)));
              selectLayer(rows[next].node.id, e.shiftKey);
              e.currentTarget.parentElement?.querySelectorAll<HTMLElement>('.layer-row')[next]?.focus();
            } else if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); e.stopPropagation(); selectLayer(node.id, e.shiftKey); }
          }}
          onClick={(e) => { if (!suppressClick.current) selectLayer(node.id, e.metaKey || e.ctrlKey || e.shiftKey); }}
          onContextMenu={(e) => {
            e.preventDefault(); e.stopPropagation();
            if (!useStore.getState().selectedIds.includes(node.id)) selectLayer(node.id, false);
            useContextMenu.getState().open(e.clientX, e.clientY, layerMenu(node, () => { setDraft(node.name); setRenaming(node.id); }), `图层「${node.name}」`);
          }}
          style={{ paddingLeft: 8 + depth * 14 }}
        >
          <button
            className="eye" disabled={busy} aria-label={`${node.visible === false ? '显示' : '隐藏'} ${node.name}`} title={node.visible === false ? '图层已隐藏' : '图层可见'}
            onClick={(e) => { e.stopPropagation(); void setProps(node.id, { visible: !(node.visible ?? true) }); }}
          >
            <Icon name={node.visible === false ? 'eyeOff' : 'eye'} size={15} />
          </button>
          <span className="layer-thumbnail" aria-hidden="true"><Icon name={/type/i.test(node.kind) ? 'type' : /group/i.test(node.kind) ? 'folder' : /shape|fill/i.test(node.kind) ? 'shape' : 'image'} size={15} /></span>
          {renaming === node.id ? (
            <input
              className="rename" autoFocus value={draft} aria-label="图层名称"
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => commitRename(node.id)}
              onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') commitRename(node.id); else if (e.key === 'Escape') setRenaming(null); }}
              style={{ flex: 1, minWidth: 0 }}
            />
          ) : (
            <span
              className="name" title={`${node.name}（拖动排序 · 双击重命名）`}
              onDoubleClick={(e) => { e.stopPropagation(); setDraft(node.name); setRenaming(node.id); }}
            >
              {node.name}
            </span>
          )}
          <button
            className={`lock-badge${isLocked(node) ? ' locked' : ''}`} disabled={busy}
            aria-label={isLocked(node) ? `解锁 ${node.name}` : `锁定 ${node.name}`} aria-pressed={isLocked(node)}
            title={isLocked(node) ? `${lockTitle(node)} · 点击解锁` : '点击锁定全部'}
            onClick={(e) => {
              e.stopPropagation();
              const unlock = isLocked(node);
              // Photoshop: clicking the Background's lock turns it into a normal layer.
              if (unlock && /^pixel$/i.test(node.kind) && /^(背景|background)$/i.test(node.name) && node.locks?.transparency) {
                selectLayer(node.id); void layerFromBackground(); return;
              }
              void setProps(node.id, { locks: unlock ? { transparency: false, pixels: false, position: false, all: false } : { all: true } });
            }}
          >
            <Icon name={isLocked(node) ? 'lock' : 'unlock'} size={13} />
          </button>
          {node.hasMask && <span title="图层蒙版" style={{ color: 'var(--text-dim)', fontSize: 11 }}>⬚</span>}
          
        </div>
      ))}
      </div>
      <div className="layers-actionbar" role="toolbar" aria-label="图层操作">
        <button aria-label="新建图层" title="新建图层（Ctrl/⌘+Alt+Shift+N）" disabled={!hasDoc || busy} onClick={() => void newLayer()}><Icon name="plus" size={16} /><span>新建</span></button>
        <button aria-label="复制图层" title="复制图层（Ctrl/⌘+J）" disabled={!hasDoc || busy || !selected} onClick={() => void duplicateLayer()}><Icon name="copy" size={16} /><span>复制</span></button>
        <button aria-label="添加蒙版" title="添加图层蒙版（有选区时按选区）" disabled={!hasDoc || busy || !selected || !!selected?.hasMask} onClick={() => void addMask(selection ? 'revealSelection' : 'revealAll')}><Icon name="mask" size={16} /><span>蒙版</span></button>
        <button aria-label="打开调整与效果" title="打开滤镜与图层样式；添加调整图层请到照片处理" disabled={!hasDoc} onClick={() => openPanel('adjustments')}><Icon name="adjust" size={16} /><span>效果</span></button>
        <button aria-label="编组" title="编组（Ctrl/⌘+G）" disabled={!hasDoc || busy || !selectedIds.length} onClick={() => void groupLayers()}><Icon name="folder" size={16} /><span>编组</span></button>
        <button aria-label="删除所选图层" title="删除图层（Delete）" disabled={!hasDoc || busy || !selected} onClick={() => void deleteLayer()}><Icon name="trash" size={16} /><span>删除</span></button>
      </div>
      <div className="layers-footer"><span>{selectedIds.length ? `已选 ${selectedIds.length} 个` : '尚未选择图层'}</span><span title="Shift / Ctrl / ⌘ 点击图层可多选">Shift / ⌘ 多选</span></div>
    </section>
  );
}

const LOCKS: ['transparency' | 'pixels' | 'position' | 'all', string, string][] = [
  ['transparency', '透明', '锁定透明像素：只能在已有像素上绘制'],
  ['pixels', '像素', '锁定图像像素：禁止绘制与滤镜'],
  ['position', '位置', '锁定位置：禁止移动与变换'],
  ['all', '全部', '锁定全部'],
];

function isLocked(n: LayerNode): boolean {
  const l = n.locks;
  return !!l && (l.all || l.pixels || l.position || l.transparency);
}

function lockTitle(n: LayerNode): string {
  const l = n.locks;
  if (!l) return '';
  if (l.all) return '已锁定全部';
  return '已锁定：' + LOCKS.filter(([k]) => k !== 'all' && l[k]).map(([, label]) => label).join('、');
}
