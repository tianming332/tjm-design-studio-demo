import { create } from 'zustand';
import type { TaskSummary } from '../ai/contract';
import { editingStep, finalPreviewIsCurrent } from '../ai/progress';
export type Activity = { id: number; docId?: string; at: number; phase: 'working' | 'complete' | 'error' | 'paused'; taskId?: string; message?: string };
export type DesignSignal = { color: 'gray' | 'yellow' | 'green' | 'red'; label: string };
let sequence = 0;
export const useDesignActivity = create<{ activity?: Activity; begin(docId?: string): number; update(id: number, patch: Partial<Activity>): void }>((set, get) => ({
  begin(docId) { const id = ++sequence; set({ activity: { id, docId, at: Date.now(), phase: 'working' } }); return id; },
  update(id, patch) { if (get().activity?.id === id) set({ activity: { ...get().activity!, ...patch } }); },
}));
export function designSignal(docId: string | undefined, task: TaskSummary | undefined, error: string | undefined, activity?: Activity): DesignSignal {
  const here = activity && activity.docId === docId ? activity : undefined;
  const relevant = task && task.target.docId === docId ? task : undefined;
  if (here && !here.taskId && (!relevant || here.at >= relevant.createdAt)) {
    return here.phase === 'error' ? { color: 'red', label: here.message || '设计出错' }
      : here.phase === 'complete' ? { color: 'green', label: '设计完成' } : { color: 'yellow', label: here.phase === 'paused' ? '已手动接管' : '设计执行中' };
  }
  if (relevant) {
    if (relevant.state === 'cancelled') return { color: 'gray', label: '已停止' };
    if (relevant.state === 'paused' && relevant.error?.code === 'USER_TAKEOVER') return { color: 'yellow', label: '已手动接管' };
    if (error || relevant.state === 'failed' || relevant.state === 'reconciling' || relevant.error) return { color: 'red', label: error || relevant.error?.message || '设计出错，待处理' };
    if (relevant.state === 'completed') {
      if (relevant.steps?.some(editingStep) && !finalPreviewIsCurrent(relevant)) return { color: 'yellow', label: '待最终核验' };
      return { color: 'green', label: '设计完成' };
    }
    return { color: 'yellow', label: relevant.state === 'paused' ? '设计已暂停' : relevant.state === 'waiting_confirmation' ? '等待确认' : '设计执行中' };
  }
  return { color: 'gray', label: '暂无设计任务' };
}
