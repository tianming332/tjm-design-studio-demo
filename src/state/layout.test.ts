import { describe, expect, it } from 'vitest';
import { PRESETS, detach, dockGroup, floatGroup, hiddenPanels, movePanel, parseLayout, showPanel, updateGroup, visiblePanelTabs, ALL_PANELS, type Layout } from './layout';

const base = (): Layout => JSON.parse(JSON.stringify(PRESETS['基本功能']));

describe('workspace layout reducers', () => {
  it('detach drops the panel and empty groups', () => {
    const l = detach(detach(base(), 'layers'), 'history');
    expect(l.dock).toHaveLength(1);
    expect(hiddenPanels(l)).toEqual(['history', 'layers']);
  });
  it('moves a tab into another group and makes it active', () => {
    const l = movePanel(base(), 'history', { kind: 'group', group: 'g-layers' });
    expect(l.dock.find((g) => g.id === 'g-layers')?.panels).toEqual(['layers', 'history']);
    expect(l.dock.find((g) => g.id === 'g-layers')?.active).toBe('history');
    expect(l.dock.find((g) => g.id === 'g-main')?.panels).not.toContain('history');
  });
  it('floats a tab as a window and docks it back', () => {
    let l = movePanel(base(), 'adjustments', { kind: 'float', x: 100, y: 50 });
    expect(l.floating).toHaveLength(1);
    expect(l.floating[0]).toMatchObject({ x: 100, y: 50, panels: ['adjustments'] });
    l = dockGroup(l, l.floating[0].id, 0);
    expect(l.floating).toHaveLength(0);
    expect(l.dock[0].panels).toEqual(['adjustments']);
    l = floatGroup(l, l.dock[0].id, 10, 20);
    expect(l.floating[0]).toMatchObject({ x: 10, y: 20 });
  });
  it('a new docked group at an index; same-group single tab is a no-op', () => {
    const l = movePanel(base(), 'properties', { kind: 'dock', index: 1 });
    expect(l.dock.map((g) => g.panels[0])).toEqual(['task', 'properties', 'layers']);
    const one = detach(base(), 'history');
    expect(movePanel(one, 'layers', { kind: 'group', group: 'g-layers' })).toBe(one);
  });
  it('showPanel re-docks a closed panel and collapse/size patches apply', () => {
    let l = detach(base(), 'history');
    l = showPanel(l, 'history');
    expect(hiddenPanels(l)).toEqual([]);
    l = updateGroup(l, 'g-layers', { collapsed: true });
    expect(l.dock.find((g) => g.id === 'g-layers')?.collapsed).toBe(true);
  });
  it('parseLayout validates stored JSON', () => {
    expect(parseLayout(null).dock).toHaveLength(2);
    const p = parseLayout({ dock: [{ id: 'a', panels: ['layers', 'bogus', 'layers'], active: 'nope' }], floating: [{ panels: ['history'], x: 'x', y: 99999, w: 10, h: 200 }] });
    expect(p.dock[0]).toMatchObject({ panels: ['layers'], active: 'layers' });
    expect(p.floating[0]).toMatchObject({ x: 80, y: 3000, w: 220, h: 200 });
  });
  it('keeps all capabilities discoverable without overflowing the tab row', () => {
    const l = base();
    expect(hiddenPanels(l)).toEqual([]);
    for (const p of ALL_PANELS.filter((p) => p !== 'agent' && p !== 'generate')) {
      const shown = showPanel(l, p);
      const g = shown.dock.find((x) => x.active === p)!;
      expect(visiblePanelTabs(g)).toContain(p);
      expect(visiblePanelTabs(g)).toEqual(g.panels.filter((p) => p !== 'agent' && p !== 'generate'));
    }
  });
  it('reopens AI panels into an existing main group for legacy saved layouts', () => {
    const legacy = parseLayout({ dock: [{ id: 'old', panels: ['properties', 'more', 'assets'], active: 'more' }, { id: 'layers', panels: ['layers'], active: 'layers' }] });
    const l = showPanel(showPanel(legacy, 'generate'), 'task');
    expect(l.dock).toHaveLength(2);
    expect(l.dock[0].panels).toContain('generate');
    expect(l.dock[0].active).toBe('task');
  });
});
