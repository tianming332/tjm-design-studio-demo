import { ColorControl } from './ColorPicker';
import { useState } from 'react';
import { useStore, flatten } from '../state/store';
import { EFFECTS, fxByCmd } from '../engine/fx';
import { TEXT_FX_PRESETS } from '../engine/textfx';
import { ValueSlider } from './ValueSlider';

const WARPS: [string, string][] = [['arc', '扇形'], ['arch', '拱形'], ['bulge', '凸起'], ['flag', '旗帜'], ['wave', '波浪'], ['fish', '鱼形'], ['rise', '增加'], ['inflate', '膨胀'], ['squeeze', '挤压'], ['twist', '扭转'], ['none', '无变形']];

export function FxPanel() {
  const st = useStore();
  const [cmd, setCmd] = useState(EFFECTS[0].cmd), [color, setColor] = useState('#000000'), [size, setSize] = useState(8);
  const [preset, setPreset] = useState('gold'), [warp, setWarp] = useState('arc'), [bend, setBend] = useState(30);
  const [depth, setDepth] = useState(24), [angle, setAngle] = useState(45), [side, setSide] = useState('#5a3d00');
  const spec = fxByCmd(cmd)!, selected = flatten(st.layers).find((l) => l.id === st.selectedId);
  const applied = selected?.effects?.items ?? [], off = !st.session || st.busy || !selected, isType = selected?.kind === 'Type';
  return <><section className="selection compact-adjustments fx-controls" aria-label="图层效果控制">
    <div className="compact-control-heading"><h4 title={selected?.name}>图层样式</h4><select aria-label="图层样式" value={cmd} onChange={(e) => setCmd(e.target.value)}>{EFFECTS.map((e) => <option key={e.cmd} value={e.cmd}>{e.label}</option>)}</select></div>
    <div className="effect-parameters">
      {spec.usesColor && <label className="compact-color"><span>颜色</span><ColorControl label="效果颜色" value={color} disabled={off} onChange={setColor} /></label>}
      {spec.usesSize && <ValueSlider label="效果大小" min={1} max={50} value={size} unit="px" disabled={off} onChange={setSize} />}
    </div>
    <button className="compact-apply" disabled={off} onClick={() => void st.applyLayerStyle(spec.cmd, spec.build({ color: spec.usesColor ? color : st.foreground, size, bg: st.background }))}>应用效果</button>
    {applied.length > 0 && <div className="applied-effects">{applied.map((e, i) => <span key={i}>{e.kind}</span>)}<button disabled={off} onClick={() => void st.clearLayerStyle()}>清除样式</button></div>}
  </section>
  {/* Folded by default so the effects panel stays compact. */}
  <details className="selection fx-controls text-fx-tools" aria-label="文字特效与立体字">
    <summary>文字特效 · 变形 · 立体字</summary>
    <div className="compact-control-heading"><h4>文字特效</h4><select aria-label="特效预设" value={preset} onChange={(e) => setPreset(e.target.value)}>{Object.entries(TEXT_FX_PRESETS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></div>
    <button className="compact-apply" disabled={off} onClick={() => void st.applyTextFx({ preset, accent: preset === 'neon' || preset === 'glow' ? st.foreground : undefined })}>应用预设</button>
    <div className="compact-control-heading"><h4>变形文字</h4><select aria-label="变形样式" value={warp} disabled={!isType} onChange={(e) => setWarp(e.target.value)}>{WARPS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
    <div className="effect-parameters"><ValueSlider label="弯曲" min={-100} max={100} value={bend} unit="%" disabled={off || !isType} onChange={setBend} /></div>
    <button className="compact-apply" disabled={off || !isType} onClick={() => void st.applyTextFx({ warp: { style: warp, bend } })}>应用变形</button>
    <div className="compact-control-heading"><h4>立体字</h4></div>
    <div className="effect-parameters">
      <ValueSlider label="厚度" min={2} max={200} value={depth} unit="px" disabled={off} onChange={setDepth} />
      <ValueSlider label="方向" min={0} max={360} value={angle} unit="°" disabled={off} onChange={setAngle} />
      <label className="compact-color"><span>侧面</span><ColorControl label="侧面颜色" value={side} disabled={off} onChange={setSide} /></label>
    </div>
    <button className="compact-apply" disabled={off} data-testid="extrude-apply" onClick={() => void st.extrudeSelected({ depth, angle, sideColor: side })}>生成立体字</button>
  </details>
  </>;
}
