import { describe, expect, it } from 'vitest';
import { designSignal, type Activity } from './designActivity';
import type { TaskSummary } from '../ai/contract';
const task = (state: TaskSummary['state'], error = false) => ({ id: 't1', target: { docId: 'doc' }, createdAt: 5, state, ...(error ? { error: { message: 'conflict' } } : {}) }) as TaskSummary;
describe('canvas design indicator', () => {
  it('uses gray/yellow/green/red for the document task, not just service connectivity', () => {
    expect(designSignal('doc', undefined, undefined).color).toBe('gray');
    for (const s of ['planning','waiting_asset','executing','reviewing','paused','waiting_confirmation'] as const) expect(designSignal('doc', task(s), undefined).color).toBe('yellow');
    expect(designSignal('doc', task('completed'), undefined).color).toBe('green');
    expect(designSignal('doc', task('failed'), undefined).color).toBe('red');
    expect(designSignal('doc', task('paused', true), undefined).color).toBe('red');
    expect(designSignal('doc', task('cancelled'), undefined).color).toBe('gray');
  });
  it('does not show another document task or an old success during new image generation', () => {
    expect(designSignal('other', task('completed'), undefined).color).toBe('gray');
    const activity: Activity = { id: 1, docId: 'doc', at: 10, phase: 'working' };
    expect(designSignal('doc', task('completed'), undefined, activity).color).toBe('yellow');
    expect(designSignal('doc', task('completed'), undefined, { ...activity, phase: 'error' }).color).toBe('red');
    expect(designSignal('doc', task('completed'), undefined, { ...activity, phase: 'complete' }).color).toBe('green');
  });
});
