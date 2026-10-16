import { useEffect, useState } from 'react';
import { useStore } from '../state/store';
import { FILTERS, filterByCmd, filterId, defaultValues, filterParams } from '../engine/filters';
import { ValueSlider } from './ValueSlider';

export function FilterPanel() {
  const hasDoc = useStore((s) => !!s.session), busy = useStore((s) => s.busy);
  const [id, setId] = useState(filterId(FILTERS[0]));
  const [values, setValues] = useState<Record<string, number>>(() => defaultValues(FILTERS[0]));
  const pick = useStore((s) => s.filterPick);
  const select = (next: string) => { const spec = filterByCmd(next); if (spec) { setId(next); setValues(defaultValues(spec)); } };
  useEffect(() => { if (pick && filterByCmd(pick)) { select(pick); useStore.setState({ filterPick: undefined }); } }, [pick]);
  const spec = filterByCmd(id)!;
  return <section className="selection compact-adjustments filter-controls" aria-label="滤镜控制">
    <div className="compact-control-heading"><h4>滤镜</h4><select value={id} onChange={(e) => select(e.target.value)} aria-label="滤镜">
      {FILTERS.map((f) => <option key={filterId(f)} value={filterId(f)}>{f.group} · {f.label}</option>)}
    </select></div>
    {spec.fields.map((f) => <ValueSlider key={f.key} label={f.label} min={f.min} max={f.max} step={f.step ?? 1} unit={/半径|距离|大小/.test(f.label) ? 'px' : ''} value={values[f.key] ?? f.default} disabled={!hasDoc || busy} onChange={(value) => setValues((v) => ({ ...v, [f.key]: value }))} />)}
    <button className="compact-apply" disabled={!hasDoc || busy} onClick={() => void useStore.getState().applyFilter(spec.cmd, filterParams(spec, values))}>应用滤镜</button>
  </section>;
}
