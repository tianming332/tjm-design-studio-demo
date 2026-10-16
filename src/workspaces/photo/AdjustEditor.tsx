import { beginGesture, liveEdit } from '../../state/live';
import { useEffect, useRef, useState } from 'react';
import { useStore, findAdjustment } from '../../state/store';
import { specForKind, valuesFrom, paramsFrom, fieldsForGroup, applyPreset } from './adjustments';
import { ValueSlider, photoGradient } from '../../components/ValueSlider';

const hint: React.CSSProperties = { color: 'var(--text-dim)', fontSize: 12, lineHeight: 1.5 };

/** Table-driven editor for the selected adjustment layer. Dragging updates local state only;
 *  the engine round trip happens once on pointer-up. Channel / colour-range groups, booleans and
 *  presets come from the spec; every commit sends the *whole* parameter set so untouched channels
 *  keep their values. */
export function AdjustEditor() {
  const layers = useStore((s) => s.layers);
  const selectedId = useStore((s) => s.selectedId);
  const setAdjustment = useStore((s) => s.setAdjustment);
  const mergeDown = useStore((s) => s.mergeDown);
  const busy = useStore((s) => s.busy);

  const sel = findAdjustment(layers, selectedId);
  const spec = sel ? specForKind(sel.kind) : undefined;
  const [values, setValues] = useState<Record<string, number>>({});
  const [group, setGroup] = useState('');

  const signature = sel && spec ? `${sel.layerId}:${spec.kind}:${JSON.stringify(sel.params)}` : '';
  // While a live edit is in flight the read-back lags the slider; don't snap it back.
  const lastLocal = useRef(0);
  useEffect(() => {
    if (Date.now() - lastLocal.current < 1500) return;
    if (sel && spec) setValues(valuesFrom(spec, sel.params));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);
  useEffect(() => { setGroup(''); }, [sel?.layerId, spec?.kind]);

  if (!sel) return <div style={hint}>选中一个调整图层以编辑参数。</div>;
  if (!spec) return <div style={hint}>暂不支持编辑「{sel.kind}」类型的参数。</div>;

  const commit = (v = values) => void setAdjustment(sel.layerId, paramsFrom(spec, v));
  const fields = fieldsForGroup(spec, group);

  return (
    <div className="adjust-editor">
      <div style={{ marginBottom: 6 }}>{spec.label}</div>
      {spec.groups && (
        <select value={group} onChange={(e) => setGroup(e.target.value)} aria-label="通道" style={{ width: '100%', marginBottom: 6 }}>
          {spec.groups.map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}
        </select>
      )}
      {spec.presets && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
          {spec.presets.map((p) => (
            <button key={p.label} disabled={busy} onClick={() => { const v = applyPreset(values, p.values, group); setValues(v); commit(v); }}>
              {p.label}
            </button>
          ))}
        </div>
      )}
      {fields.map((f) => {
        const v = values[f.key] ?? f.default;
        if (f.bool) {
          return (
            <label key={f.key} style={{ ...hint, display: 'block', marginBottom: 6 }}>
              <input
                type="checkbox" checked={v >= 0.5} disabled={busy} aria-label={f.label}
                onChange={(e) => { const next = { ...values, [f.key]: e.target.checked ? 1 : 0 }; setValues(next); commit(next); }}
              />
              {f.label}
            </label>
          );
        }
        return (
          <ValueSlider key={`${sel.layerId}:${f.key}`} label={f.label} min={f.min} max={f.max} step={f.step ?? 1} value={v} disabled={busy}
              gradient={photoGradient(f.label)} onGestureStart={beginGesture}
              onChange={(value) => {
                // Live preview: the adjustment layer updates while dragging (one history step).
                const next = { ...values, [f.key]: value };
                lastLocal.current = Date.now();
                setValues(next);
                liveEdit(`adj:${sel.layerId}`, [{ cmd: 'layer.setAdjustment', params: { layer: sel.layerId, ...paramsFrom(spec, next) } }]);
              }}
            />
        );
      })}
      <button
        onClick={() => void mergeDown()}
        disabled={busy}
        title="把这个调整合并进下方像素图层（破坏性，相当于 图像 › 调整）"
        style={{ width: '100%', marginTop: 4 }}
      >
        应用到下方像素（破坏性）
      </button>
    </div>
  );
}
