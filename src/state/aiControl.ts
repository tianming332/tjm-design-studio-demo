import { create } from 'zustand';

/** Local write barrier. Server pause alone cannot stop an already-issued lease or image download. */
export const useAIControl = create<{ held: boolean; docId?: string; epoch: number; writes: number }>(() => ({ held: false, epoch: 0, writes: 0 }));
export function holdAI(docId?: string) {
  useAIControl.setState((s) => ({ held: true, docId, epoch: s.epoch + 1 }));
}
export function releaseAI(docId?: string) {
  const s = useAIControl.getState();
  if (s.held && (s.docId === docId || s.docId === undefined)) useAIControl.setState({ held: false, docId: undefined });
}
export const aiHeld = (docId?: string) => { const s = useAIControl.getState(); return s.held && (s.docId === docId || s.docId === undefined); };
export async function trackAIWrite<T>(run: () => Promise<T>): Promise<T> {
  useAIControl.setState((s) => ({ writes: s.writes + 1 }));
  try { return await run(); } finally { useAIControl.setState((s) => ({ writes: Math.max(0, s.writes - 1) })); }
}
export async function drainAIWrites(): Promise<void> {
  if (!useAIControl.getState().writes) return;
  return new Promise((resolve, reject) => {
    const done = () => { clearTimeout(timer); unsubscribe(); resolve(); };
    const unsubscribe = useAIControl.subscribe((s) => { if (!s.writes) done(); });
    const timer = setTimeout(() => { unsubscribe(); reject(new Error('当前编辑步骤仍未结束，请稍后再接管。AI 后续写入已暂停。')); }, 30000);
    if (!useAIControl.getState().writes) done();
  });
}
