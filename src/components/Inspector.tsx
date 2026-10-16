import { useEffect } from 'react';
import { useStore, flatten, SELECT_TOOLS, PATH_TOOLS } from '../state/store';
import { TransformPanel } from './TransformPanel';
import { SelectionPanel } from './SelectionPanel';
import { TextPanel } from './TextPanel';
import { PathPanel } from './PathPanel';
import { Icon } from './Icon';
import { AlignBar } from './AlignBar';
import { CombineShapes } from './OptionsBar';
import { TextContentEditor } from './TextContentEditor';

const MODE_ZH: Record<string, string> = { Rgb: 'RGB', Grayscale: '灰度', Gray: '灰度', Cmyk: 'CMYK', Lab: 'Lab', Indexed: '索引', Bitmap: '位图', Duotone: '双色调', Multichannel: '多通道' };

export function DocumentProperties() {
  const doc = useStore((s) => s.doc);
  const tool = useStore((s) => s.activeTool);
  const layers = useStore((s) => s.layers);
  const selectedId = useStore((s) => s.selectedId);
  const busy = useStore((s) => s.busy);
  const selectedIds = useStore((s) => s.selectedIds);
  const docInfo = useStore((s) => s.docInfo);
  const activeDocId = useStore((s) => s.activeDocId);
  const refreshDocInfo = useStore((s) => s.refreshDocInfo);
  useEffect(() => { void refreshDocInfo(); }, [activeDocId, doc?.width, doc?.height, refreshDocInfo]);
  const selected = flatten(layers).find((l) => l.id === selectedId);
  const hasShapes = flatten(layers).some((l) => selectedIds.includes(l.id) && /shape/i.test(l.kind));
  if (!doc) return <div className="panel-empty"><Icon name="sliders" size={25} /><strong>暂无文档属性</strong><p>打开图片后，在这里查看文档<br />和当前选择的详细参数。</p></div>;
  return <>
    <section className="document-properties">
      <div className="section-title"><h3>文档</h3><span className="subtle-badge">图像</span></div>
      <dl className="property-grid"><div><dt>宽度</dt><dd>{doc.width}<small>px</small></dd></div><div><dt>高度</dt><dd>{doc.height}<small>px</small></dd></div></dl>
      <div className="document-meta"><div className="property-line"><span>分辨率</span><span className="numeric">{doc.resolution ?? 72} <small>ppi</small></span></div>
      <div className="property-line"><span>颜色模式</span><span>{MODE_ZH[docInfo?.mode ?? ''] ?? docInfo?.mode ?? '—'} · {docInfo?.depth ?? 8} 位</span></div>
      <div className="property-line"><span>配置文件</span><span title={docInfo?.profile}>{docInfo?.profile ?? '未标记'}</span></div></div>
    </section>
    {selected && <section className="document-properties">
      <div className="section-title"><h3>当前图层</h3><span className="selected-layer-name" title={selected.name}>{selected.name}</span></div>
      {/type/i.test(selected.kind) && activeDocId && <TextContentEditor key={`${activeDocId}:${selected.id}`} layer={selected} docId={activeDocId} />}
      {selected.bounds && <dl className="property-grid">{selected.bounds.map((v, i) => <div key={i}><dt>{['X', 'Y', '宽度', '高度'][i]}</dt><dd>{Math.round(v)}<small>px</small></dd></div>)}</dl>}
      <button className="wide-button" onClick={() => useStore.getState().enterTransform()} disabled={busy}><Icon name="transform" size={15} />自由变换<span className="shortcut">⌘ / Ctrl T</span></button>
    </section>}
    {selectedIds.length >= 1 && <section className="document-properties">
      <div className="section-title"><h3>对齐与分布</h3><span className="subtle-badge">{selectedIds.length > 1 ? `${selectedIds.length} 个图层` : '单个图层'}</span></div>
      <AlignBar />
      {hasShapes && <div className="property-shape-actions"><CombineShapes /></div>}
    </section>}
    <TransformPanel />
    {SELECT_TOOLS.includes(tool) && <SelectionPanel />}
    {PATH_TOOLS.includes(tool) && <PathPanel />}
    <TextPanel />
  </>;
}

