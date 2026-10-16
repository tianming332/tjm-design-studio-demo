import { useStore } from '../state/store';
import { WORKSPACES } from '../workspaces/registry';
import { selectEditScene } from '../state/navigation';

export function WorkspaceSwitcher() {
  const active = useStore((s) => s.activeWorkspace);
  return (
    <div className="workspace-switcher segmented" role="group" aria-label="编辑场景">
      {WORKSPACES.map((w) => (
        <button
          key={w.id}
          onClick={() => selectEditScene(w.id)}
          title={`${w.title}：切换快捷工具，保留当前文档与历史`}
          aria-pressed={w.id === active}
        >
          {w.title}
        </button>
      ))}
    </div>
  );
}
