import { useStore } from '../state/store';
import { Icon } from './Icon';

const ALIGN: [string, string, string][] = [
  ['leftEdges', 'alignLeft', '左对齐'], ['horizontalCenters', 'alignHCenter', '水平居中'], ['rightEdges', 'alignRight', '右对齐'],
  ['topEdges', 'alignTop', '顶对齐'], ['verticalCenters', 'alignVCenter', '垂直居中'], ['bottomEdges', 'alignBottom', '底对齐'],
];

/** Align / distribute the selected layers (to the canvas or selection when only one is chosen). */
export function AlignBar({ compact = false }: { compact?: boolean }) {
  const ids = useStore((s) => s.selectedIds);
  const busy = useStore((s) => s.busy);
  const hasSel = useStore((s) => !!s.selection);
  const align = useStore((s) => s.align);
  const distribute = useStore((s) => s.distribute);
  const target = ids.length > 1 ? `${ids.length} 个图层` : hasSel ? '选区' : '画布';
  return (
    <div className={`align-bar${compact ? ' compact' : ''}`} role="group" aria-label="对齐与分布">
      {!compact && <span className="align-target">对齐到：{target}</span>}
      {ALIGN.map(([edge, icon, label]) => (
        <button key={edge} className="icon-button" aria-label={label} title={`${label}（对齐到${target}）`} disabled={busy || !ids.length} onClick={() => void align(edge)}>
          <Icon name={icon} size={16} />
        </button>
      ))}
      <span className="divider" />
      <button className="icon-button" aria-label="水平分布" title="水平分布（需选中 3 个及以上图层）" disabled={busy || ids.length < 3} onClick={() => void distribute('horizontally')}><Icon name="distH" size={16} /></button>
      <button className="icon-button" aria-label="垂直分布" title="垂直分布（需选中 3 个及以上图层）" disabled={busy || ids.length < 3} onClick={() => void distribute('vertically')}><Icon name="distV" size={16} /></button>
    </div>
  );
}
