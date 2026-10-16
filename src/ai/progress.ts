import type { Step, TaskSummary } from './contract';

export type PhaseState = 'pending' | 'running' | 'done' | 'error' | 'paused';
export const stepSucceeded = (s: Step) => s.status === 'done' && s.receipt?.status !== 'error' && !s.error;
export const editingStep = (s: Step) => s.where === 'client' && s.tool !== 'doc_read' && s.tool !== 'doc_preview';
export function finalPreviewIsCurrent(t: TaskSummary): boolean {
  const edits = t.steps.filter(editingStep);
  if (edits.some((s) => s.status === 'pending' || s.status === 'leased' || s.status === 'uncertain')) return false;
  const lastEdit = t.steps.reduce((last, s, i) => editingStep(s) && stepSucceeded(s) ? i : last, -1);
  const preview = t.steps.reduce((last, s, i) => s.tool === 'doc_preview' && stepSucceeded(s) && !s.args.region ? i : last, -1);
  if (preview < 0 || preview < lastEdit) return false;
  const receipt = t.steps[preview].receipt;
  return receipt?.preview?.revision === t.observedRevision && receipt.revisionAfter === t.observedRevision;
}

/** A successful intermediate edit/preview does NOT complete its entire phase. */
export function phaseRows(t: TaskSummary): { label: string; state: PhaseState; detail?: string }[] {
  const edits = t.steps.filter(editingStep), succeeded = edits.filter(stepSucceeded);
  const paused = t.state === 'paused' || t.state === 'reconciling';
  const failed = t.state === 'failed';
  const active: PhaseState = paused ? 'paused' : failed ? 'error' : 'running';
  const workflow = (tools: string[], phase: boolean): PhaseState => {
    const steps = t.steps.filter((s) => tools.includes(s.tool));
    if (steps.some((s) => ['pending', 'leased', 'uncertain'].includes(s.status))) return active;
    if (phase) return 'done';
    if (steps.length && !steps.some(stepSucceeded)) return 'error';
    return 'pending';
  };
  const wf = [
    workflow(['report_analysis'], t.phases.analyze),
    workflow(['assets_list'], t.phases.assets),
    workflow(['skill_list', 'skill_load'], t.phases.skills),
  ];
  const allPending = wf.every((s) => s === 'pending');
  if (allPending && !['cancelled', 'completed'].includes(t.state)) (wf as PhaseState[])[0] = active;
  const final = finalPreviewIsCurrent(t);
  const pendingReview = t.steps.some((s) => s.tool === 'doc_preview' && ['pending','leased'].includes(s.status));
  const complete = t.state === 'completed';
  const stopped = t.state === 'cancelled';
  return [
    { label: '分析需求', state: wf[0], detail: t.analysis?.goal },
    { label: '检查素材', state: wf[1], detail: wf[1] === 'done' ? '素材已读取' : undefined },
    { label: '匹配 Skill', state: wf[2], detail: t.skill ? `${t.skill.name} v${t.skill.version}` : t.phases.skills ? '按通用流程执行' : undefined },
    { label: '执行', state: complete ? succeeded.length === edits.length ? 'done' : 'error' : stopped ? 'paused' : edits.length || wf.every((s) => s === 'done') ? active : 'pending',
      detail: `${succeeded.length}/${edits.length} 步已执行${complete && succeeded.length !== edits.length ? ' · 存在失败或未执行记录，请核对' : !complete && !stopped && succeeded.length === edits.length && edits.length ? ' · 仍在规划／处理' : ''}` },
    { label: '最终检查', state: complete && final ? 'done' : failed ? 'error' : paused || stopped ? 'paused' : pendingReview || t.state === 'reviewing' ? 'running' : 'pending',
      detail: complete && final ? '已核对最后一次修改后的完整预览' : pendingReview ? '正在核对当前画布' : '等待执行完成后核验；中途预览不代表完成' },
  ];
}
