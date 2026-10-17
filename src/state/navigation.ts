import { create } from 'zustand';
import { useStore } from './store';
import { useAppearance } from './appearance';
import { showPanel, useLayout, DEVICE_LAYOUTS, type PanelId } from './layout';
import type { AIOutput } from '../ai/creation';
import { useStudioLayout } from './studioLayout';
import { useTouch } from './touch';

export type CreationMode = 'design' | 'manual';
export type AgentSide = 'left' | 'right';
export type StudioPanel = Exclude<PanelId, 'generate'>;
const STUDIO_KEY = 'tjm.ai-studio.v1';
export function parseStudio(raw: unknown): { output: AIOutput; agentSide: AgentSide } {
  const p = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  return { output: p.output === 'poster' || p.output === 'asset' ? p.output : 'layered', agentSide: p.agentSide === 'left' ? 'left' : 'right' };
}
function initial() {
  // Always open in the manual editor, including for returning visitors.
  const mode: CreationMode = 'manual';
  let studio = parseStudio(null);
  try {
    const saved = localStorage.getItem(STUDIO_KEY);
    studio = saved ? parseStudio(JSON.parse(saved)) : parseStudio(null);
  } catch { /* storage unavailable */ }
  return { mode, ...studio };
}
export const useNavigation = create<{ mode: CreationMode; output: AIOutput; agentSide: AgentSide; studioPanel: StudioPanel; canvasPanel?: 'properties' | 'layers'; allTools: boolean; allPanels: boolean; utility?: PanelId; preview: boolean; preferenceError?: string }>(() => ({
  ...initial(), studioPanel: 'agent', allTools: false, allPanels: false, preview: false,
}));

function saveStudio() {
  const { output, agentSide } = useNavigation.getState();
  try { localStorage.setItem(STUDIO_KEY, JSON.stringify({ output, agentSide })); useNavigation.setState({ preferenceError: undefined }); }
  catch { useNavigation.setState({ preferenceError: '偏好已调整，但未能保存到本地；刷新后可能恢复。' }); }
}
export function setAgentSide(agentSide: AgentSide) { useNavigation.setState({ agentSide }); saveStudio(); }
export function setAIOutput(output: AIOutput) { useNavigation.setState({ output }); saveStudio(); }
/** Legacy generation links now focus the material option in the same AI composer. */
export function openAICreation(output: AIOutput) { setAIOutput(output); selectCreationMode('design'); }

/** Tools remain in the current mode. AI shares the same editor, with task-oriented panel defaults. */
export function openPanel(panel: PanelId) {
  if (panel === 'agent') { selectCreationMode('design'); return; }
  if (panel === 'generate') { openAICreation('asset'); return; }
  if (useNavigation.getState().mode !== 'manual') {
    if (panel === 'properties' || panel === 'layers') {
      useNavigation.setState({ canvasPanel: panel, preview: typeof window !== 'undefined' && window.innerWidth <= 760 });
      useAppearance.setState({ focus: false });
      return;
    }
    useNavigation.setState({ studioPanel: panel, utility: undefined, preview: false });
    useAppearance.setState({ focus: false });
    return;
  }
  const layout = useLayout.getState();
  layout.set(showPanel(layout.layout, panel));
  useAppearance.setState({ drawerOpen: typeof window !== 'undefined' && window.innerWidth < 1100, focus: false });
}
export function selectCreationMode(mode: CreationMode) {
  useNavigation.setState({ mode, utility: undefined, preview: false, ...(mode === 'design' ? { studioPanel: 'agent' } : {}) });
  useAppearance.setState({ focus: false, drawerOpen: false });
  if (mode === 'manual') openPanel(useStore.getState().activeWorkspace === 'edit' ? 'properties' : 'task');
}
export function selectEditScene(id: string) {
  useStore.getState().setWorkspace(id);
  openPanel(id === 'edit' ? 'properties' : 'task');
}
/** Layout choices are independent from creation mode. */
export function selectPanelLayout(name: string) {
  useLayout.getState().switchTo(name);
  // iPad / 手机 layouts also switch the touch UI; other layouts go back to following the device.
  useTouch.getState().setPrefs({ device: DEVICE_LAYOUTS[name] ?? 'auto' });
}
export function resetPanelLayout() {
  if (useNavigation.getState().mode === 'design') { useStudioLayout.getState().reset(); setAgentSide('right'); }
  else useLayout.getState().reset();
}
