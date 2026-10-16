import { useState } from 'react';
import { useStore } from '../state/store';
import { NewDocument } from './NewDocument';
import { Icon } from './Icon';
import { selectCreationMode, openAICreation, useNavigation } from '../state/navigation';

export function EmptyCanvas() {
  const [creating, setCreating] = useState(false);
  const busy = useStore((s) => s.busy);
  const mode = useNavigation((s) => s.mode);
  if (mode !== 'manual') return <div className="studio-empty-preview">
    <div className="preview-artboard" aria-hidden="true">
      <div className="preview-artboard-mark"><Icon name="sparkles" size={26} /></div>
      <div className="preview-outline-line" /><div className="preview-outline-line short" />
      <div className="preview-outline-block" />
      <span>YOUR NEXT IDEA</span>
    </div>
    <h2>留白，等待一个好想法。</h2>
    <p>生成的设计会出现在这里</p>
    <button className="text-button" disabled={busy} onClick={() => document.querySelector<HTMLInputElement>('.topbar input[type=file]')?.click()}><Icon name="folder" size={14} />或打开已有作品</button>
  </div>;
  return (
    <div className="empty" onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      <div className="empty-content">
        <div className="empty-symbol"><Icon name="image" size={32} /><span><Icon name="plus" size={12} /></span></div>
        <h1>从一张图片开始</h1>
        <p>拖入文件开始编辑，也可以用 AI 完成设计或生成素材。</p>
        <div className="empty-actions"><button className="primary" disabled={busy} onClick={() => document.querySelector<HTMLInputElement>('.topbar input[type=file]')?.click()}><Icon name="folder" size={17} />打开文件</button><button disabled={busy} onClick={() => setCreating(true)}><Icon name="plus" size={17} />新建文档</button></div>
        <div className="empty-formats">PSD · PSB · PNG · JPG · PCRAFT</div>
        {mode === 'manual' && <div className="empty-ai-links"><button className="text-button" onClick={() => selectCreationMode('design')}><Icon name="sparkles" size={14} />让 AI 帮我设计</button><button className="text-button" onClick={() => openAICreation('asset')}><Icon name="image" size={14} />生成图片素材</button></div>}
        <div className="empty-shortcut"><kbd>⌘ / Ctrl</kbd><kbd>O</kbd><span>快速打开</span></div>
      </div>
      {creating && <NewDocument onClose={() => setCreating(false)} />}
    </div>
  );
}
