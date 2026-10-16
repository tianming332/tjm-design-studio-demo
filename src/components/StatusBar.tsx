import { useEffect } from 'react';
import { useStore } from '../state/store';
import { useAppearance } from '../state/appearance';
import { Icon } from './Icon';

export function StatusBar() {
  const doc = useStore((s) => s.doc);
  const backend = useStore((s) => s.backend);
  const warnings = useStore((s) => s.warnings);
  const error = useStore((s) => s.error);
  const notice = useStore((s) => s.notice);
  const busy = useStore((s) => s.busy);
  const displaying = useStore((s) => !!s.doc && s.render.nonce !== s.paintedNonce);
  const scale = useStore((s) => s.view.scale);
  const low = useAppearance((s) => s.preferences.lowOverhead);
  const appearanceError = useAppearance((s) => s.error);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => useStore.setState({ notice: undefined }), 6000);
    return () => clearTimeout(t);
  }, [notice]);
  return (
    <footer className="statusbar">
      <div className="zoom-controls" role="group" aria-label="画布缩放">
        <button disabled={!doc} aria-label="缩小画布" title="缩小画布" onClick={() => useStore.getState().zoomBy(0.8)}><Icon name="minus" size={13} /></button>
        <span className="zoom-value">{Math.round(scale * 100)}%</span>
        <button disabled={!doc} aria-label="放大画布" title="放大画布" onClick={() => useStore.getState().zoomBy(1.25)}><Icon name="plus" size={13} /></button>
        <button disabled={!doc} onClick={() => useStore.getState().fitView()} title="适配画布（Ctrl/⌘+0）">适配</button>
        <button disabled={!doc} className="actual-pixels" onClick={() => useStore.getState().actualPixels()} title="实际像素">1:1</button>
      </div>
      <span className="divider" />
      <span className="document-dimensions numeric">{doc ? `${doc.width} × ${doc.height} px` : '未打开文档'}</span>
      <span className="status-message" role="status">{busy ? '处理中…' : error ? '操作未完成，请查看错误提示' : displaying ? '正在显示文档…' : notice ?? (doc ? '空格拖动平移 · 滚轮缩放' : '就绪')}</span>
      {warnings.length > 0 && <span className="warn" title={warnings.join('\n')}>△ {warnings.length} 条提示</span>}
      <span className="status-meta">{low ? '低开销模式' : doc ? `${backend.toUpperCase()} 渲染` : '本地文件编辑'}</span>
      {(error || appearanceError) && <div className="status-error" role="alert"><Icon name="info" size={16} /><span>{error ? `错误：${error}` : appearanceError}</span><button className="icon-button" aria-label="关闭错误提示" onClick={() => { if (error) useStore.setState({ error: undefined }); else useAppearance.setState({ error: undefined }); }}><Icon name="close" size={14} /></button></div>}
    </footer>
  );
}
