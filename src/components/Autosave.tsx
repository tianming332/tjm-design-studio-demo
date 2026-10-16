import { useEffect, useRef } from 'react';
import { useStore } from '../state/store';
import { AUTOSAVE_DEBOUNCE_MS, autosaveDue } from '../engine/autosave';

const fmt = (t: number) => new Date(t).toLocaleTimeString();

/**
 * HIS-003: snapshots the root document after edits settle and, on start-up, offers to restore
 * the snapshot a previous (crashed or closed) session left behind.
 */
export function AutosaveController() {
  const nonce = useStore((s) => s.render.nonce);
  const session = useStore((s) => s.session);
  const recovery = useStore((s) => s.recovery);
  const busy = useStore((s) => s.busy);
  const checkRecovery = useStore((s) => s.checkRecovery);
  const recoverAutosave = useStore((s) => s.recoverAutosave);
  const discardRecovery = useStore((s) => s.discardRecovery);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const lastEditAt = useRef(0);

  useEffect(() => { void checkRecovery(); }, [checkRecovery]);

  // Every repaint signal is a potential edit: (re)arm the debounce when the root revision moved.
  useEffect(() => {
    const st = useStore.getState();
    const root = (st.tabs.find((t) => t.docId === st.activeDocId && !t.parent) ?? st.tabs.find((t) => !t.parent))?.session;
    if (!root) return;
    const revision = root.currentRevision;
    if (!autosaveDue({ revision, savedRevision: st.autosavedRevision, lastEditAt: 0, now: Infinity })) return;
    lastEditAt.current = Date.now();
    clearTimeout(timer.current);
    const tick = () => {
      const s = useStore.getState();
      const r = (s.tabs.find((t) => t.docId === s.activeDocId && !t.parent) ?? s.tabs.find((t) => !t.parent))?.session;
      if (!r) return;
      if (s.busy) { timer.current = setTimeout(tick, 1000); return; }
      if (autosaveDue({ revision: r.currentRevision, savedRevision: s.autosavedRevision, lastEditAt: lastEditAt.current, now: Date.now() })) {
        void s.autosaveNow();
      }
    };
    timer.current = setTimeout(tick, AUTOSAVE_DEBOUNCE_MS);
  }, [nonce, session]);

  useEffect(() => () => clearTimeout(timer.current), []);

  if (!recovery) return null;
  return (
    <div
      className="recovery-banner"
      role="alertdialog"
      aria-label="恢复未保存的工作"
      style={{
        position: 'fixed', top: 84, left: '50%', transform: 'translateX(-50%)', zIndex: 50,
        background: 'var(--panel-2)', border: '1px solid var(--accent-hi)', borderRadius: 4,
        padding: '8px 12px', display: 'flex', gap: 8, alignItems: 'center', fontSize: 12,
      }}
    >
      <span>检测到上次未保存的工作：{recovery.name}（自动保存于 {fmt(recovery.savedAt)}）</span>
      <button onClick={() => void recoverAutosave()} disabled={busy}>恢复</button>
      <button onClick={() => void discardRecovery()} disabled={busy}>丢弃</button>
    </div>
  );
}
