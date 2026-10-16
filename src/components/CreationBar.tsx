import { useNavigation, selectCreationMode, type CreationMode } from '../state/navigation';
import { Icon } from './Icon';
import { requestManualEdit } from './ManualTakeover';

const MODES: { id: CreationMode; title: string; icon: string; hint: string }[] = [
  { id: 'design', title: 'AI 制图', icon: 'sparkles', hint: '在同一工作区生成整张海报、图片素材或可编辑的分层海报。' },
  { id: 'manual', title: '手动编辑', icon: 'sliders', hint: '使用工具直接编辑，所有场景共享文档、图层与历史。' },
];

export function CreationBar() {
  const mode = useNavigation((s) => s.mode);
  return <nav className="creation-bar" aria-label="创作导航">
    <div className="creation-modes" role="group" aria-label="创作方式">
      
      {MODES.map((m) => <button key={m.id} className={m.id === 'design' ? 'signature-mode' : undefined} aria-pressed={mode === m.id} title={m.hint} onClick={() => m.id === 'manual' ? requestManualEdit() : selectCreationMode(m.id)}>
        <Icon name={m.icon} size={16} />{m.title}
      </button>)}
    </div>
  </nav>;
}
