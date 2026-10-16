import { useEffect, useRef, useState } from 'react';
import { useAppearance } from '../state/appearance';

/**
 * Design Agent backdrop: the vgpu "Optimized Black Hole" (WebGPU, MIT — see ai/blackhole/README.md).
 * Loaded lazily; capped at 30 fps; a still frame under reduced motion; not created at all in
 * 低开销模式 or without WebGPU (the starfield stays as the fallback).
 */
export function AgentBlackHole() {
  const low = useAppearance((s) => s.preferences.lowOverhead);
  const reduced = useAppearance((s) => s.preferences.reducedMotion);
  const ref = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const supported = typeof navigator !== 'undefined' && 'gpu' in navigator;
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || low || !supported) return;
    let cancelled = false;
    let dispose: (() => void) | undefined;
    const still = reduced || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setReady(false);
    void import('../ai/blackhole/renderer').then(({ createRenderer }) => {
      if (cancelled) return;
      const r = createRenderer({
        canvas, fps: 30, still,
        // Lower in the panel, behind the composer (ndc y: +1 top, -1 bottom).
        layout: { centerX: 0, centerY: -0.2, cameraRoll: -0.12, mouseYaw: 0.08, centerFade: 0.35, distance: 26 },
        onFailure: () => { if (!cancelled) setFailed(true); },
      });
      dispose = r.dispose;
      void r.ready.then(() => { if (!cancelled) setReady(true); });
    }).catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; dispose?.(); };
  }, [low, reduced, supported]);
  if (low || !supported || failed) return null;
  return <canvas ref={ref} className={`agent-blackhole${ready ? ' is-ready' : ''}`} data-testid="agent-blackhole" aria-hidden="true" />;
}
