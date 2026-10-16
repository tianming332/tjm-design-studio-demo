import { useStore } from '../state/store';
import { workspaceById } from '../workspaces/registry';
import { PanelIntro } from './PanelIntro';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';

export function TaskPanel() {
  const active = useStore((s) => s.activeWorkspace);
  const { Panel, title } = workspaceById(active);
  return (
    <div className="taskpanel">
      <div className="scene-picker"><WorkspaceSwitcher /></div>
      <PanelIntro icon={active === 'photo' ? 'image' : active === 'poster' ? 'type' : 'sliders'} title={title}>
        {active === 'photo' ? '裁剪、调色与修图。文档与图层属性始终在「属性」中。' : active === 'poster' ? '添加文字、组织版式。切换场景不会新建或替换文档。' : '左侧选择工具，顶部调整参数，右侧管理属性与图层。'}
      </PanelIntro>
      <Panel />
    </div>
  );
}
