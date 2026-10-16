// 素材 panel: 素材库 (user uploads / drops, AI results, web imports), 互联网素材 (admin-listed
// sites opened inside the page), AI 生成 (a compact AIStyle: backend styles → library + new layer).
import { useEffect, useState, type DragEvent } from 'react';
import { useAssets } from '../state/assets';
import { hasAccess, useWb } from '../state/workbench';
import { useStore } from '../state/store';
import { AccessGate } from './AccessGate';
import { wbApi } from '../ai/api';
import type { AssetRecord, Site } from '../ai/contract';
import { PanelIntro } from './PanelIntro';
import { openAICreation, useNavigation } from '../state/navigation';

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
  const items = st.items.filter((a) => filter === 'all' || a.kind === filter);
  return (
    <div className="ai-section">
      <label className={`asset-drop${over ? ' over' : ''}`} data-testid="asset-drop" onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setOver(true); } }} onDragLeave={() => setOver(false)} onDrop={onDrop}>
        把图片拖到这里，或<span className="link">选择文件</span>（PNG／JPEG／WebP）
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
  return (
    <div className="ai-section">
      <p className="ai-status">在页面内浏览，把图片拖进右侧导入区或粘贴图片地址，即可存入素材库。网站内容的许可以原站为准。</p>
      <ul className="site-list">{sites.map((s) => <li key={s.id}><button data-testid={`site-${s.id}`} onClick={() => { useNavigation.setState({ utility: undefined }); st.openSite(s); }}>{s.name}</button><small>{s.note}</small></li>)}</ul>
      {!sites.length && <p className="ai-status">还没有可用的素材网站。</p>}
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

/** In-page site browser (no new tab). Cross-origin pages load as credentialless iframes because
 *  the editor is cross-origin isolated; their images are imported by drag-and-drop or URL. */
export function SiteBrowser() {
  const site = useAssets((s) => s.browsing);
  const sites = useWb((s) => s.caps?.sites ?? []);
  const st = useAssets();
  const [url, setUrl] = useState('');
  const [over, setOver] = useState(false);
  if (!site) return null;
  const take = (e: DragEvent) => {
    e.preventDefault(); setOver(false);
    const uri = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
    const html = e.dataTransfer.getData('text/html');
    const src = /<img[^>]+src=["']([^"']+)/i.exec(html)?.[1];
    const pick = (src || uri || '').split('\n').find((l) => /^https:\/\//.test(l.trim()))?.trim();
    if (pick) void st.importUrl(site, pick);
  };
  return (
    <div className="site-browser" role="dialog" aria-label={`互联网素材 · ${site.name}`} data-testid="site-browser">
      <header>
        <nav>{sites.map((s: Site) => <button key={s.id} className={s.id === site.id ? 'active' : ''} onClick={() => st.openSite(s)}>{s.name}</button>)}</nav>
        <button aria-label="关闭" onClick={() => st.openSite(undefined)}>关闭</button>
      </header>
      <div className="site-body">
        <iframe key={site.id} src={site.url} title={site.name} {...{ credentialless: '' }} sandbox="allow-scripts allow-same-origin allow-forms" referrerPolicy="no-referrer" />
        <aside className={`site-drop${over ? ' over' : ''}`} data-testid="site-drop" onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={take}>
          <b>导入区</b>
          <p>从左侧网页把图片拖到这里</p>
          <form onSubmit={(e) => { e.preventDefault(); if (url.trim()) void st.importUrl(site, url.trim()); setUrl(''); }}>
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="或粘贴图片地址" aria-label="图片地址" />
            <button className="primary" disabled={!url.trim()}>导入</button>
          </form>
          {st.error && <p className="ai-error">{st.error}</p>}
          {st.notice && <p className="ai-note">{st.notice}</p>}
          <small>网页若空白，说明该站禁止被嵌入。</small>
        </aside>
      </div>
    </div>
  );
}
