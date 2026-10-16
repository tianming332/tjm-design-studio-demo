import { create } from 'zustand';
import { useState } from 'react';
import { useAgent } from '../state/agent';
import { useStore } from '../state/store';
import { selectCreationMode } from '../state/navigation';
import { useDesignActivity } from '../state/designActivity';
import { useAIControl } from '../state/aiControl';
import { TERMINAL } from '../ai/contract';
import { Modal } from './Modal';

const useTakeover = create<{ docId?: string }>(() => ({}));
export function AIControlsDocument(docId: string | undefined): boolean {
  const { task } = useAgent.getState();
  const { activity } = useDesignActivity.getState();
  return !!docId && ((task?.target.docId === docId && !TERMINAL.includes(task.state) && task.state !== 'paused')
    || (activity?.phase === 'working' && activity.docId === docId && !activity.taskId)
    || useAIControl.getState().writes > 0);
}
export function requestManualEdit() {
  const docId = useStore.getState().activeDocId;
  if (AIControlsDocument(docId)) useTakeover.setState({ docId });
  else selectCreationMode('manual');
}
export function ManualTakeover() {
  const docId = useTakeover((s) => s.docId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!docId) return null;
  const close = () => { useTakeover.setState({ docId: undefined }); setError(''); };
  return <Modal title="暂停 AI 并手动编辑？" onClose={close} dismissDisabled={busy} className="takeover-dialog">
    <div className="modal-body">
      <p>AI 正在处理这张画布。接管后会暂停后续执行，已完成的修改保留，可用撤销恢复。</p>
      <p className="muted">当前已发出的模型请求可能仍会完成或计费；生成结果会保留在素材库，不会在接管后自动放入画布。</p>
      {error && <p role="alert" className="ai-error">{error}</p>}
    </div>
    <footer className="modal-footer"><button disabled={busy} onClick={close}>继续由 AI 设计</button>
      <button className="primary" disabled={busy} onClick={() => {
        setBusy(true); setError('');
        void useAgent.getState().pauseForManual(docId).then(() => {
          const a = useDesignActivity.getState().activity;
          if (a?.docId === docId && !a.taskId) useDesignActivity.getState().update(a.id, { phase: 'paused', message: '已手动接管' });
          if (useStore.getState().activeDocId !== docId) throw new Error('当前文档已切换，请重新确认目标画布。');
          selectCreationMode('manual'); close();
        }).catch((e) => setError((e as Error).message)).finally(() => setBusy(false));
      }}>{busy ? '等待当前步骤结束…' : '暂停并接管'}</button>
    </footer>
  </Modal>;
}
