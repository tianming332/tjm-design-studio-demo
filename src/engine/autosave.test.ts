import { describe, expect, it } from 'vitest';
import { autosaveDue, recoveryFileName } from './autosave';

describe('autosaveDue', () => {
  const base = { revision: 3, savedRevision: 1, lastEditAt: 1000, now: 6000, debounceMs: 4000 };
  it('fires once edits have settled past the debounce', () => {
    expect(autosaveDue(base)).toBe(true);
  });
  it('waits while edits are still arriving', () => {
    expect(autosaveDue({ ...base, now: 4000 })).toBe(false);
  });
  it('skips when nothing changed since the last snapshot', () => {
    expect(autosaveDue({ ...base, savedRevision: 3 })).toBe(false);
  });
  it('does not snapshot a freshly opened, untouched document', () => {
    expect(autosaveDue({ ...base, revision: 0, savedRevision: null })).toBe(false);
  });
  it('snapshots the first edit of a new session', () => {
    expect(autosaveDue({ ...base, revision: 1, savedRevision: null })).toBe(true);
  });
});

describe('recoveryFileName', () => {
  it('re-opens as a project file so the bridge decodes .pcraft', () => {
    expect(recoveryFileName('compat-test.psd')).toBe('compat-test（恢复）.pcraft');
    expect(recoveryFileName('a.b.pcraft')).toBe('a.b（恢复）.pcraft');
    expect(recoveryFileName('poster')).toBe('poster（恢复）.pcraft');
  });
});
