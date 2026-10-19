import { useState } from 'react';
import { createPortal } from 'react-dom';
import type { ModelOption } from '../ai/contract';
import { modelDisplayName, providerLabel } from '../ai/models';
import { Popover } from './Popover';
import { Icon } from './Icon';
export function ModelPicker({ models, selected, disabled, onSelect }: { models: ModelOption[]; selected?: string; disabled?: boolean; onSelect(id: string): void }) {
  const [open, setOpen] = useState<{ left:number; top:number }>();
  const current=models.find(m=>m.id===selected)??models[0];
  return <>
    <button className="composer-model" type="button" disabled={disabled} aria-label="选择模型" aria-expanded={!!open} title={current ? `模型：${current.id}` : '后台未提供模型列表；使用后台默认配置'} onClick={(e)=>{
      const r=e.currentTarget.getBoundingClientRect();setOpen(open?undefined:{left:Math.max(8,Math.min(window.innerWidth-272,r.right-264)),top:Math.max(8,Math.min(window.innerHeight-200,r.top-150))});
    }}><span className="model-star"><Icon name="sparkles" size={12}/></span><span>{current?modelDisplayName(current):'默认模型'}</span><Icon name="chevron" size={12}/></button>
    {open&&createPortal(<Popover label="可用模型" className="model-picker-menu" style={{position:'fixed',...open,width:264}} onClose={()=>setOpen(undefined)}>
      <div className="popover-heading">可用模型</div>
      {models.length?models.map(m=><button key={m.id} className="menu-item model-option" role="radio" aria-checked={current?.id===m.id} onClick={()=>{onSelect(m.id);setOpen(undefined);}}><span><strong>{modelDisplayName(m)}</strong><small>{providerLabel(m.provider)} · {m.id}</small></span>{current?.id===m.id&&<Icon name="check" size={14}/>}</button>):<p className="model-menu-note">暂无可选模型，请在后台「模型管理」中添加。</p>}
    </Popover>,document.body)}
  </>;
}
