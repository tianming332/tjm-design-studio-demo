// 素材 panel: 素材库 (user uploads / drops, AI results, web imports), 互联网素材 (admin-listed
// sites opened inside the page), AI 生成 (a compact AIStyle: backend styles → library + new layer).
import { useEffect, useState, type DragEvent } from 'react';
import { useAssets } from '../state/assets';
import { hasAccess, useWb } from '../state/workbench';
import { useStore } from '../state/store';
import { AccessGate } from './AccessGate';
import { wbApi } from '../ai/api';
import type { AssetRecord } from '../ai/contract';
import { PanelIntro } from './PanelIntro';
import { openAICreation } from '../state/navigation';

export const ASSET_DRAG_TYPE = 'application/x-tjm-asset';
const KIND_LABEL: Record<AssetRecord['kind'], string> = { upload: '我的', generated: 'AI', web: '网络' };

function Thumb({ asset }: { asset: AssetRecord }) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    let u: string | undefined;
    let live = true;
    void wbApi.assetBlob(asset.id).then((b) => { if (!live) return; u = URL.createObjectURL(b); setUrl(u); }).catch(() => undefined);
    return () => { live = false; if (u) URL.revokeObjectURL(u); };
  }, [asset.id]);
  const st = useAssets();
  const hasDoc = useStore((s) => !!s.session);
  const title = [asset.name, `${asset.width}×${asset.height}`, asset.source.site ? `来源：${asset.source.site}（许可未知）` : '', asset.source.styleName ? `画风：${asset.source.styleName}` : ''].filter(Boolean).join('\n');
  return (
    <figure className="asset-card" data-testid="asset-card" data-kind={asset.kind} title={title} draggable
      onDragStart={(e) => { e.dataTransfer.setData(ASSET_DRAG_TYPE, asset.id); e.dataTransfer.effectAllowed = 'copy'; }}
      onDoubleClick={() => void st.place(asset.id)}>
      {url ? <img src={url} alt={asset.name || asset.id} /> : <div className="asset-ph" />}
      <figcaption><span className="asset-kind">{KIND_LABEL[asset.kind]}</span>{asset.name || asset.id}</figcaption>
      <div className="asset-actions">
        <button onClick={() => void st.place(asset.id)} title={hasDoc ? '放入当前文档为新图层' : '新建文档并打开'}>放入画布</button>
        <button onClick={() => void st.remove(asset.id)} aria-label={`删除 ${asset.name || asset.id}`}>删除</button>
      </div>
    </figure>
  );
}

function Library() {
  const st = useAssets();
  const [over, setOver] = useState(false);
  const [filter, setFilter] = useState<'all' | AssetRecord['kind']>('all');
  const onDrop = (e: DragEvent) => { e.preventDefault(); setOver(false); void st.uploadFiles(Array.from(e.dataTransfer.files ?? [])); };
  // Paste a copied image straight into the library (works for images saved from any site / app).
  const onPaste = (e: React.ClipboardEvent) => {
    const files = Array.from(e.clipboardData.files ?? []).filter((f) => /^image\//.test(f.type));
    if (files.length) { e.preventDefault(); void st.uploadFiles(files); }
  };
  const items = st.items.filter((a) => filter === 'all' || a.kind === filter);
  return (
    <div className="ai-section" onPaste={onPaste}>
      <label className={`asset-drop${over ? ' over' : ''}`} data-testid="asset-drop" onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setOver(true); } }} onDragLeave={() => setOver(false)} onDrop={onDrop}>
        把图片拖到这里、<span className="link">选择文件</span>，或 Ctrl/⌘+V 粘贴（PNG／JPEG／WebP）
        <input type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={(e) => { const f = Array.from(e.target.files ?? []); e.target.value = ''; void st.uploadFiles(f); }} />
      </label>
      <div className="ai-row asset-filter">{(['all', 'upload', 'generated', 'web'] as const).map((k) => <button key={k} className={filter === k ? 'active' : ''} onClick={() => setFilter(k)}>{k === 'all' ? '全部' : KIND_LABEL[k]}</button>)}</div>
      <div className="asset-grid" data-testid="asset-grid">{items.map((a) => <Thumb key={a.id} asset={a} />)}</div>
      {!items.length && !st.loading && <p className="ai-status">素材库为空。AI 制图会优先使用这里的素材。</p>}
      <small className="ai-note">双击或拖到画布即可新建图层。</small>
    </div>
  );
}

function Internet() {
  const sites = useWb((s) => s.caps?.sites ?? []);
  const st = useAssets();
  const [url, setUrl] = useState('');
  return (
    <div className="ai-section">
      <p className="ai-status">点开网站会在新标签打开。登录、找到图片后：右键保存到电脑再拖进「我的素材」，或复制图片后在「我的素材」里 Ctrl/⌘+V 粘贴。</p>
      <ul className="site-list">{sites.map((s) => <li key={s.id}><button data-testid={`site-${s.id}`} onClick={() => st.openSite(s)}>{s.name} ↗</button><small>{s.note}</small></li>)}</ul>
      {!sites.length && <p className="ai-status">还没有可用的网站，可在后台「素材网站」添加。</p>}
      <form className="asset-url-form" onSubmit={(e) => { e.preventDefault(); if (url.trim()) { void st.importImageUrl(url.trim()); setUrl(''); } }}>
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="粘贴图片地址直接导入（限后台登记的域名）" aria-label="图片地址" />
        <button className="primary" disabled={!url.trim()}>导入</button>
      </form>
      {st.error && <p className="ai-error">{st.error}</p>}
      {st.notice && <p className="ai-note">{st.notice}</p>}
    </div>
  );
}

export function AssetsPanel() {
  const [tab, setTab] = useState<'library' | 'internet'>('library');
  const st = useAssets();
  const access = useWb(hasAccess);
  useEffect(() => { if (access) void useAssets.getState().refresh(); }, [access]);
  return (
    <div className="ai-panel" data-testid="assets-panel">
      <PanelIntro icon="folder" title="素材库">集中管理上传、生成和导入的图片，随时放入当前设计。</PanelIntro>
      <div className="ai-tabs" role="tablist" aria-label="素材来源">
        {([['library', '我的素材'], ['internet', '网络素材']] as const).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'active' : ''} data-testid={`assets-tab-${id}`} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>
      <AccessGate />
      {st.error && <p className="ai-error" role="alert">{st.error}</p>}
      {st.notice && <p className="ai-note" data-testid="assets-notice">{st.notice}</p>}
      {access && tab === 'library' && <Library />}
      {tab === 'internet' && <Internet />}
      <button className="wide-button" onClick={() => openAICreation('asset')}>用 AI 生成素材 →</button>
    </div>
  );
}
