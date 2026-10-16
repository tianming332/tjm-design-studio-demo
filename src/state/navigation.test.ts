import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openPanel, resetPanelLayout, selectCreationMode, selectEditScene, selectPanelLayout, useNavigation, openAICreation, setAIOutput, setAgentSide, parseStudio } from './navigation';
import { useLayout, PRESETS, type Layout } from './layout';
import { useStore } from './store';
import { useAppearance } from './appearance';

const copy = (layout: Layout): Layout => JSON.parse(JSON.stringify(layout));
const content = () => {
  const s = useStore.getState();
  return { doc: s.doc, layers: s.layers, tabs: s.tabs, selectedIds: s.selectedIds, history: s.historyDepth, activeTool: s.activeTool };
};
beforeEach(() => {
  vi.stubGlobal('localStorage', { setItem: vi.fn() });
  useLayout.setState({ layout: copy(PRESETS.基本功能), current: '基本功能', locked: true, saved: {} });
  useNavigation.setState({ mode: 'manual', output: 'layered', agentSide: 'right', studioPanel: 'agent', allTools: false, allPanels: false, utility: undefined, preview: false, preferenceError: undefined });
  useStore.setState({ activeWorkspace: 'edit' });
  useAppearance.setState({ focus: false, drawerOpen: false });
});
afterEach(() => vi.unstubAllGlobals());
describe('creation navigation', () => {
  it('opens every output in the same AI mode without changing document content or scene', () => {
    const before = content();
    selectCreationMode('design');
    expect(useNavigation.getState().mode).toBe('design');
    expect(useLayout.getState().layout.dock[0].active).toBe('properties');
    openAICreation('asset');
    expect(useNavigation.getState().mode).toBe('design');
    expect(useNavigation.getState().output).toBe('asset');
    setAIOutput('poster');
    expect(useNavigation.getState().mode).toBe('design');
    expect(useLayout.getState().layout.dock[0].active).toBe('properties');
    expect(useStore.getState().activeWorkspace).toBe('edit');
    expect(content()).toEqual(before);
  });
  it('restores the manual scene while properties remain an independent destination', () => {
    selectEditScene('poster');
    expect(useLayout.getState().layout.dock[0].active).toBe('task');
    selectCreationMode('design');
    selectCreationMode('manual');
    expect(useStore.getState().activeWorkspace).toBe('poster');
    expect(useLayout.getState().layout.dock[0].active).toBe('task');
    openPanel('properties');
    expect(useStore.getState().activeWorkspace).toBe('poster');
    expect(useLayout.getState().layout.dock[0].active).toBe('properties');
  });
  it('utility panels do not silently change the selected creation method', () => {
    openAICreation('asset');
    openPanel('assets');
    expect(useNavigation.getState().mode).toBe('design');
    openPanel('history');
    expect(useNavigation.getState().mode).toBe('design');
    openPanel('more');
    expect(useNavigation.getState().mode).toBe('design');
    expect(useNavigation.getState().studioPanel).toBe('more');
    expect(useNavigation.getState().utility).toBeUndefined();
  });
  it('keeps AI mode when opening scene tools and properties', () => {
    selectCreationMode('design');
    selectEditScene('poster');
    expect(useNavigation.getState()).toMatchObject({ mode: 'design', studioPanel: 'task' });
    expect(useStore.getState().activeWorkspace).toBe('poster');
    selectEditScene('edit');
    expect(useNavigation.getState()).toMatchObject({ mode: 'design', studioPanel: 'task', canvasPanel: 'properties' });
    openAICreation('asset');
    expect(useNavigation.getState()).toMatchObject({ mode: 'design', studioPanel: 'agent', output: 'asset' });
  });
  it('preserves an explicitly saved left-side layout while defaulting to the right', () => {
    expect(parseStudio(undefined).agentSide).toBe('right');
    expect(parseStudio({ agentSide: 'left' }).agentSide).toBe('left');
  });
  it('preset switching and reset retain the AI destination and editor data', () => {
    const before = content();
    selectCreationMode('design');
    selectPanelLayout('绘画');
    expect(useNavigation.getState().mode).toBe('design');
    expect(useLayout.getState().layout).toEqual(PRESETS.绘画);
    resetPanelLayout();
    expect(useNavigation.getState().agentSide).toBe('right');
    expect(useLayout.getState().layout).toEqual(PRESETS.绘画);
    expect(content()).toEqual(before);
  });
  it('opening an explicit panel exits focus mode so it is actually visible', () => {
    useAppearance.setState({ focus: true });
    openPanel('properties');
    expect(useAppearance.getState().focus).toBe(false);
  });
  it('flips the AI layout without touching editor layout, mode, document or output', () => {
    const before = content(), layout = useLayout.getState().layout;
    openAICreation('poster');
    setAgentSide('right');
    expect(useNavigation.getState()).toMatchObject({ mode: 'design', output: 'poster', agentSide: 'right' });
    expect(localStorage.setItem).toHaveBeenLastCalledWith('tjm.ai-studio.v1', JSON.stringify({ output: 'poster', agentSide: 'right' }));
    expect(useLayout.getState().layout).toEqual(layout);
    selectCreationMode('manual');
    selectCreationMode('design');
    expect(useNavigation.getState().agentSide).toBe('right');
    expect(content()).toEqual(before);
    expect(useLayout.getState().layout.dockSide).toBe(layout.dockSide);
  });
  it('routes a legacy generation-panel link to the shared material composer', () => {
    openPanel('generate');
    expect(useNavigation.getState()).toMatchObject({ mode: 'design', output: 'asset', utility: undefined });
  });
  it('validates layout preferences and reports failed persistence without blocking the switch', () => {
    expect(parseStudio(null)).toEqual({ output: 'layered', agentSide: 'right' });
    expect(parseStudio({ output: 'bad', agentSide: 'top' })).toEqual({ output: 'layered', agentSide: 'right' });
    expect(parseStudio({ output: 'asset', agentSide: 'right' })).toEqual({ output: 'asset', agentSide: 'right' });
    vi.stubGlobal('localStorage', { setItem: () => { throw new Error('quota'); } });
    setAgentSide('right');
    expect(useNavigation.getState().agentSide).toBe('right');
    expect(useNavigation.getState().preferenceError).toContain('未能保存');
  });
});
