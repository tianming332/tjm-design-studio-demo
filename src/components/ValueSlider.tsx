import type { CSSProperties } from 'react';

export function normalizeSliderValue(value: number, min: number, max: number, step = 1) {
  if (!Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(max) || max <= min) return min;
  return Math.max(min, Math.min(max, Number((min + Math.round((value - min) / step) * step).toFixed(6))));
}

/** Label, fill and editable value are one control. Native range retains touch/keyboard semantics. */
export function ValueSlider({ label, value, min, max, step = 1, unit = '', onChange, disabled, onGestureStart, onCommit, gradient, className = '' }: {
  label: string; value: number; min: number; max: number; step?: number; unit?: string; disabled?: boolean;
  onChange(value: number): void; onGestureStart?(): void; onCommit?(): void; gradient?: string; className?: string;
}) {
  const progress = Math.max(0, Math.min(100, (value - min) / (max - min) * 100));
  return <div className={`value-slider ${className}${disabled ? ' disabled' : ''}${gradient ? ' tone-slider' : ''}`}
    style={{ '--value-progress': `${progress}%`, ...(gradient ? { '--value-gradient': gradient } : {}) } as CSSProperties}>
    <span className="value-track" aria-hidden="true"><span /></span>
    <span className="value-label">{label}</span>
    <span className="value-scrub-mark" aria-hidden="true">‹ ›</span>
    <input className="value-range" type="range" min={min} max={max} step={step} value={value} disabled={disabled} aria-label={label}
      aria-valuetext={`${value}${unit ? ` ${unit}` : ''}`} onFocus={onGestureStart} onPointerDown={onGestureStart}
      onChange={(e) => onChange(Number(e.target.value))} onPointerUp={onCommit} onKeyUp={onCommit} />
    <label className="value-number"><input type="number" min={min} max={max} step={step} value={value} disabled={disabled} aria-label={`${label}数值`}
      onFocus={onGestureStart} onPointerDown={(e) => e.stopPropagation()}
      onChange={(e) => { if (e.target.value !== '' && Number.isFinite(e.target.valueAsNumber)) onChange(normalizeSliderValue(e.target.valueAsNumber, min, max, step)); }}
      onBlur={onCommit} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onCommit?.(); } }} /><span>{unit}</span></label>
  </div>;
}

export function photoGradient(label: string): string | undefined {
  if (/色相/.test(label)) return 'linear-gradient(90deg,#db6864,#e0c969,#7dbb80,#73b5c1,#8d80c0,#cf7fba,#db6864)';
  if (/饱和/.test(label)) return 'linear-gradient(90deg,#777c85,#9b8eab,#d18b70)';
  if (/红|青/.test(label)) return 'linear-gradient(90deg,#77babc,#c8c6c1,#cf7773)';
  if (/绿|洋红/.test(label)) return 'linear-gradient(90deg,#b58eb1,#c7c6c2,#80b996)';
  if (/蓝|黄|色温/.test(label)) return 'linear-gradient(90deg,#90adcd,#e4e3df,#d6a372)';
  if (/明|曝光|黑|白|亮/.test(label)) return 'linear-gradient(90deg,#555e6b,#a2a7ae,#ecebe7)';
  return undefined;
}
