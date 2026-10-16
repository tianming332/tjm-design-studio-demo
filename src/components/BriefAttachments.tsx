import { useState } from 'react';
import { useBriefAttachments } from '../state/briefAttachments';
import { useStore } from '../state/store';
import { Icon } from './Icon';
import { Modal } from './Modal';

export function BriefAttachments({ disabled }: { disabled: boolean }) {
  const attachments = useBriefAttachments();
  const busy = useStore((s) => s.busy);
  const [inspecting, setInspecting] = useState<string>();
  const current = attachments.files.find((f) => f.id === inspecting);
  return <>
    {attachments.files.length > 0 && <div className="brief-attachments" role="list" aria-label="设计附件">
      {attachments.files.map((f) => <div key={f.id} className={`brief-file ${f.status}`} role="listitem" data-testid="brief-file" data-status={f.status}>
        {f.thumbnail ? <img src={f.thumbnail} alt="" /> : <Icon name={f.kind === 'text' ? 'type' : 'file'} size={19} />}
        <div><strong title={f.name}>{f.name}</strong><small>{f.status === 'reading' ? '正在读取…' : f.status === 'uploading' ? '正在上传…' : f.error || f.note}</small>
          <div className="brief-file-actions">
            {f.text && <button type="button" onClick={() => setInspecting(f.id)}>查看内容</button>}
            {f.kind === 'design' && f.status === 'ready' && <button type="button" disabled={disabled || busy} title="在新文档标签打开原 PSD，保留图层，不替换当前文档" onClick={() => void useStore.getState().openFile(f.file)}>作为文档打开</button>}
          </div>
        </div>
        <button type="button" className="icon-button" aria-label={`移除附件 ${f.name}`} disabled={disabled || attachments.preparing} onClick={() => attachments.remove(f.id)}><Icon name="close" size={13} /></button>
      </div>)}
    </div>}
    {attachments.error && <p className="ai-error" role="alert">{attachments.error}</p>}
    {current && <Modal title={`附件内容 · ${current.name}`} className="attachment-preview" onClose={() => setInspecting(undefined)}><div className="modal-body"><p>{current.note}</p><pre>{current.text}</pre></div></Modal>}
  </>;
}
