import { useStore } from '../state/store';
import { Icon } from './Icon';

export function DocTabs() {
  const tabs = useStore((s) => s.tabs);
  const activeDocId = useStore((s) => s.activeDocId);
  const busy = useStore((s) => s.busy);
  const switchTab = useStore((s) => s.switchTab);
  const closeTab = useStore((s) => s.closeTab);
  const saveSmartObject = useStore((s) => s.saveSmartObject);
  const autosavedRevision = useStore((s) => s.autosavedRevision);
  const autosaveAt = useStore((s) => s.autosaveAt);
  useStore((s) => s.render.nonce);
  const root = tabs.find((t) => t.docId === activeDocId && !t.parent) ?? tabs.find((t) => !t.parent);
  const saved = root && autosavedRevision === root.session.currentRevision;
  return (
    <div
      className="document-strip"
      onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); e.currentTarget.classList.add('drop-target'); } }}
      onDragLeave={(e) => e.currentTarget.classList.remove('drop-target')}
      onDrop={(e) => {
        // Dropped on the tab strip: open each file as a new document (multi-document).
        e.preventDefault(); e.stopPropagation(); e.currentTarget.classList.remove('drop-target');
        void (async () => { for (const f of Array.from(e.dataTransfer.files)) await useStore.getState().openFile(f); })();
      }}
      title="把文件拖到这里：作为新文档打开"
    >
      <div className="doc-tabs" role="tablist" aria-label="文档" onKeyDown={(e) => {
        if (!['ArrowLeft', 'ArrowRight'].includes(e.key) || !(e.target instanceof HTMLElement) || e.target.getAttribute('role') !== 'tab') return;
        e.preventDefault(); e.stopPropagation();
        const i = tabs.findIndex((t) => t.docId === activeDocId);
        const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
        if (next) { void switchTab(next.docId); document.getElementById(`doc-tab-${next.docId}`)?.focus(); }
      }}>
        {!tabs.length && <span className="document-placeholder"><Icon name="file" size={14} />文档工作区</span>}
        {tabs.map((t) => <div key={t.docId} className={`doc-tab${t.docId === activeDocId ? ' active' : ''}`}>
          <button id={`doc-tab-${t.docId}`} role="tab" tabIndex={t.docId === activeDocId ? 0 : -1} aria-selected={t.docId === activeDocId} disabled={busy} title={t.name} onClick={() => void switchTab(t.docId)}><Icon name={t.parent ? 'layers' : 'file'} size={14} /><span>{t.name}</span></button>
          {t.parent && t.docId === activeDocId && <button disabled={busy} onClick={() => void saveSmartObject()} aria-label="存储内容" title="存储内容"><Icon name="save" size={14} /></button>}
          <button disabled={busy} aria-label={`关闭 ${t.name}`} title={t.parent ? '关闭并存储到智能对象' : '关闭文档'} onClick={() => void closeTab(t.docId)}><Icon name="close" size={14} /></button>
        </div>)}
      </div>
      {root && <span className={`document-save-state${saved ? ' saved' : ''}`} title={saved ? (autosaveAt ? '当前版本已自动保存到本地恢复存储' : '当前版本已提交文件下载，请确认下载完成') : '当前版本尚未保存'}>
        <span className="status-dot" />{saved ? (autosaveAt ? '本地已保存' : '已提交下载') : '未保存'}
      </span>}
    </div>
  );
}
