import { useEffect } from 'react';
import { useStore } from '../state/store';
import { setWorkMode } from './WorkMode';

/** Floating feedback near the bottom of the canvas (shortcut hints, eyedropper, work mode). */
export function Toast() {
  const t = useStore((s) => s.toast);
  useEffect(() => {
    if (!t) return;
    const timer = setTimeout(() => { if (useStore.getState().toast?.id === t.id) useStore.setState({ toast: undefined }); }, t.action ? 7000 : 2200);
    return () => clearTimeout(timer);
  }, [t]);
  if (!t) return null;
  return (
    <div className="toast" role="status" aria-live="polite" data-toast={t.id}>
      {t.swatch && <span className="toast-swatch" style={{ background: t.swatch }} />}
      <span>{t.text}</span>
      {t.action === 'workMode' && (
        <button className="primary" onClick={() => { useStore.setState({ toast: undefined }); void setWorkMode(true); }}>开启工作模式</button>
      )}
    </div>
  );
}
