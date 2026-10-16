import { describe, expect, it } from 'vitest';
import { finalPreviewIsCurrent, phaseRows } from './progress';
import type { Step, TaskSummary } from './contract';
const step = (tool: string, status: Step['status'], revision = 2) => ({ tool, args: {}, where: 'client', status, receipt: { status:'ok', revisionAfter:revision, ...(tool === 'doc_preview' ? {preview:{revision}} : {}) } }) as Step;
const task = (steps: Step[], state: TaskSummary['state'] = 'waiting_client'): TaskSummary => ({ state, steps, phases: {analyze:true,assets:true,skills:true}, skill:null, analysis:null, observedRevision:3 }) as TaskSummary;
describe('honest progress phases', () => {
  it('22/25 edits never means execution and final review are complete', () => {
    const t = task([...Array.from({length:22},()=>step('layer_move','done')),step('doc_preview','done'),...Array.from({length:3},()=>step('layer_move','pending'))]);
    const rows = phaseRows(t);
    expect(rows[3].state).toBe('running'); expect(rows[3].detail).toContain('22/25'); expect(rows[4].state).toBe('pending');
    expect(rows.filter(r=>r.state==='done')).toHaveLength(3);
  });
  it('all currently known edits can be done while the model is still planning', () => {
    const rows = phaseRows(task([step('layer_move','done',3),step('doc_preview','done',3)],'planning'));
    expect(rows[3].state).toBe('running'); expect(rows[4].state).toBe('pending');
  });
  it('completion needs a full, revision-current preview after the final edit', () => {
    expect(finalPreviewIsCurrent(task([step('doc_preview','done',2),step('layer_move','done',3)],'completed'))).toBe(false);
    const t = task([step('layer_move','done',3),step('doc_preview','done',3)],'completed');
    expect(finalPreviewIsCurrent(t)).toBe(true); expect(phaseRows(t)[4].state).toBe('done');
    t.steps[1].args.region = {x:0,y:0,w:10,h:10}; expect(finalPreviewIsCurrent(t)).toBe(false);
  });
  it('paused/failed work has no misleading completed badge', () => {
    expect(phaseRows(task([step('layer_move','done')],'paused'))[3].state).toBe('paused');
    expect(phaseRows(task([step('layer_move','failed')],'failed'))[3].state).toBe('error');
  });
});
