import { useEffect, useRef } from 'react';
import { useAppearance } from '../state/appearance';

/**
 * Pre-conversation backdrop for the Design Agent (Krea-style starfield): slowly twinkling stars
 * and faint light trails streaking outward from the prompt box. Off in 低开销模式; static under
 * reduced motion; paused while the tab is hidden. Purely decorative (aria-hidden, no pointer events).
 */
export function AgentStarfield({ anchor, burstAt }: { anchor: React.RefObject<HTMLElement>; burstAt?: number }) {
  const low = useAppearance((s) => s.preferences.lowOverhead);
  const reduced = useAppearance((s) => s.preferences.reducedMotion);
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || low) return;
    const motion = !reduced && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let w = 0, h = 0, raf = 0, last = performance.now();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    type Star = { x: number; y: number; r: number; a: number; s: number };
    type Trail = { angle: number; d: number; v: number; len: number; life: number };
    let stars: Star[] = [];
    const trails: Trail[] = [];
    const resize = () => {
      const r = canvas.getBoundingClientRect();
      w = r.width; h = r.height;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      stars = Array.from({ length: Math.round((w * h) / 2600) }, () => ({ x: Math.random() * w, y: Math.random() * h, r: Math.random() * 1.1 + 0.25, a: Math.random(), s: 0.4 + Math.random() * 1.4 }));
    };
    const origin = () => {
      const a = anchor.current?.getBoundingClientRect(), c = canvas.getBoundingClientRect();
      return a ? { x: a.left - c.left + a.width / 2, y: a.top - c.top + a.height / 2, rx: a.width / 2, ry: a.height / 2 } : { x: w / 2, y: h * 0.6, rx: 120, ry: 40 };
    };
    const draw = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      ctx.clearRect(0, 0, w, h);
      const o = origin();
      // Opening warp (after the experience code): stars stream out of the prompt box, then settle.
      const warp = burstAt && motion ? Math.max(0, 1 - (Date.now() - burstAt) / 1600) : 0;
      if (warp > 0) {
        ctx.fillStyle = `rgba(4,7,12,${0.5 * warp})`; ctx.fillRect(0, 0, w, h);
        for (const s of stars) {
          const dx = s.x - o.x, dy = s.y - o.y, d = Math.hypot(dx, dy) || 1;
          const len = (12 + d * 0.22) * warp * warp;
          ctx.strokeStyle = `rgba(200,220,250,${0.55 * warp * s.a + 0.1})`; ctx.lineWidth = s.r;
          ctx.beginPath(); ctx.moveTo(s.x - (dx / d) * len, s.y - (dy / d) * len); ctx.lineTo(s.x, s.y); ctx.stroke();
        }
      }
      const glow = ctx.createRadialGradient(o.x, o.y, 0, o.x, o.y, Math.max(w, h) * 0.55);
      glow.addColorStop(0, 'rgba(98,130,179,0.16)'); glow.addColorStop(1, 'rgba(98,130,179,0)');
      ctx.fillStyle = glow; ctx.fillRect(0, 0, w, h);
      for (const s of stars) {
        const tw = motion ? 0.55 + 0.45 * Math.sin(now / 1000 * s.s + s.a * 6.28) : 0.8;
        ctx.globalAlpha = 0.25 + 0.6 * tw * s.a;
        ctx.fillStyle = '#c9d8ea';
        ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
      if (motion) {
        if (trails.length < 26 && Math.random() < dt * 9) trails.push({ angle: Math.random() * Math.PI * 2, d: 0, v: 60 + Math.random() * 140, len: 30 + Math.random() * 90, life: 1 });
        for (let i = trails.length - 1; i >= 0; i--) {
          const t = trails[i];
          t.d += t.v * dt; t.life -= dt * 0.45;
          if (t.life <= 0) { trails.splice(i, 1); continue; }
          const cos = Math.cos(t.angle), sin = Math.sin(t.angle);
          // Start at the prompt box edge (ellipse), streak outward.
          const ex = o.x + cos * o.rx, ey = o.y + sin * o.ry;
          const x1 = ex + cos * t.d, y1 = ey + sin * t.d, x0 = ex + cos * Math.max(0, t.d - t.len), y0 = ey + sin * Math.max(0, t.d - t.len);
          const g = ctx.createLinearGradient(x0, y0, x1, y1);
          g.addColorStop(0, 'rgba(160,190,230,0)'); g.addColorStop(1, `rgba(190,215,245,${0.45 * t.life})`);
          ctx.strokeStyle = g; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
        }
        raf = requestAnimationFrame(draw);
      }
    };
    const start = () => { cancelAnimationFrame(raf); last = performance.now(); raf = requestAnimationFrame(draw); };
    const onVisibility = () => { if (document.hidden) cancelAnimationFrame(raf); else if (motion) start(); };
    const observer = new ResizeObserver(() => { resize(); if (!motion) draw(performance.now()); });
    observer.observe(canvas);
    resize();
    if (motion) start(); else draw(performance.now());
    document.addEventListener('visibilitychange', onVisibility);
    return () => { cancelAnimationFrame(raf); observer.disconnect(); document.removeEventListener('visibilitychange', onVisibility); };
  }, [low, reduced, anchor, burstAt]);
  if (low) return null;
  return <canvas ref={ref} className="agent-starfield" data-testid="agent-starfield" aria-hidden="true" />;
}
