// Ruler units (CNV-010): document pixels <-> physical units via the document resolution (ppi),
// plus tick generation for the on-screen rulers. Pure so the maths is unit-testable.

export type Unit = 'px' | 'mm' | 'cm' | 'in' | 'pt';
export const UNITS: Unit[] = ['px', 'mm', 'cm', 'in', 'pt'];

/** How many of `unit` one inch holds. */
const PER_INCH: Record<Exclude<Unit, 'px'>, number> = { in: 1, mm: 25.4, cm: 2.54, pt: 72 };

const safePpi = (ppi: number) => (Number.isFinite(ppi) && ppi > 0 ? ppi : 72);

export function pxToUnit(px: number, unit: Unit, ppi: number): number {
  if (unit === 'px') return px;
  return (px / safePpi(ppi)) * PER_INCH[unit];
}

export function unitToPx(v: number, unit: Unit, ppi: number): number {
  if (unit === 'px') return v;
  return (v / PER_INCH[unit]) * safePpi(ppi);
}

const DECIMALS: Record<Unit, number> = { px: 0, mm: 1, cm: 2, in: 2, pt: 1 };

export function formatLength(px: number, unit: Unit, ppi: number): string {
  return pxToUnit(px, unit, ppi).toFixed(DECIMALS[unit]);
}

/** "1-2-5" sequence: the smallest step (in `unit`) whose on-screen size is at least `minScreenPx`. */
export function majorStep(unit: Unit, ppi: number, scale: number, minScreenPx = 60): number {
  const screenPerUnit = unitToPx(1, unit, ppi) * scale; // screen px for one unit
  if (!(screenPerUnit > 0)) return 1;
  const need = minScreenPx / screenPerUnit;
  const exp = Math.floor(Math.log10(need));
  for (let e = exp; e <= exp + 1; e++) {
    for (const m of [1, 2, 5]) {
      const step = m * 10 ** e;
      if (step >= need) return step;
    }
  }
  return 10 ** (exp + 1);
}

export interface Tick { screen: number; label: string }

/**
 * Major ticks along one axis. `offset` is where document x=0 lands on screen (view.tx / view.ty)
 * and `length` is the ruler's on-screen length; only ticks inside [0, length] are returned.
 */
export function rulerTicks(offset: number, length: number, scale: number, unit: Unit, ppi: number): Tick[] {
  const step = majorStep(unit, ppi, scale);
  const stepPx = unitToPx(step, unit, ppi) * scale;
  if (!(stepPx > 0)) return [];
  const first = Math.ceil(-offset / stepPx);
  const last = Math.floor((length - offset) / stepPx);
  const out: Tick[] = [];
  for (let i = first; i <= last && out.length < 500; i++) {
    const v = i * step;
    out.push({ screen: offset + i * stepPx, label: String(Number(v.toFixed(6))) });
  }
  return out;
}
