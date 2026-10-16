import { useStore, flatten, findAdjustment } from '../../state/store';
import { AdjustEditor } from './AdjustEditor';
import { ADJUSTMENTS } from './adjustments';
import { Icon } from '../../components/Icon';

const QUICK = [
  { kind:'BrightnessContrast', label:'明暗', color:'linear-gradient(90deg,#526071,#ece9df)' },
  { kind:'HueSaturation', label:'色相', color:'linear-gradient(90deg,#697bc4,#cc799c,#e1ba69)' },
  { kind:'ColorBalance', label:'色彩平衡', color:'linear-gradient(90deg,#8baee0,#e4e0d7,#de9b68)' },
  { kind:'Vibrance', label:'饱和度', color:'linear-gradient(90deg,#817989,#af8299,#ea9671)' },
];
export function PhotoColorPanel() {
  const layers=useStore(s=>s.layers), selectedId=useStore(s=>s.selectedId), busy=useStore(s=>s.busy), hasDoc=useStore(s=>!!s.doc);
  const current=findAdjustment(layers,selectedId);
  const choose=async(kind:string)=>{
    const st=useStore.getState(), existing=flatten(st.layers).find(l=>findAdjustment(st.layers,l.id)?.kind.toLowerCase()===kind.toLowerCase());
    if(existing) st.selectLayer(existing.id);
    else { const spec=ADJUSTMENTS.find(s=>s.kind===kind); if(spec) await st.addAdjustment(spec.cmd); }
  };
  return <section className="photo-color-panel">
    <header><div><Icon name="sliders" size={16}/><h3>照片色彩</h3></div><span>非破坏性调整</span></header>
    <div className="photo-adjust-types" role="group" aria-label="照片调色类型">{QUICK.map(q=><button key={q.kind} disabled={!hasDoc||busy} aria-label={`调整${q.label}`} aria-pressed={current?.kind.toLowerCase()===q.kind.toLowerCase()} onClick={()=>void choose(q.kind)}>
      <span className="tone-sample" style={{background:q.color}}/><span>{q.label}</span>
    </button>)}</div>
    <p className="color-panel-note">选择已有调整层；没有时新建独立图层。</p>
    <AdjustEditor key={selectedId}/>
  </section>;
}
