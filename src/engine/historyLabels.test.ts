import { describe, expect, it } from 'vitest';
import { historyLabel } from './historyLabels';
import { buildCommands, searchCommands } from '../components/CommandPalette';

describe('history labels', () => {
  it('translates engine labels, ignores the ellipsis, keeps unknown ones', () => {
    expect(historyLabel('Brush Stroke')).toBe('画笔描边');
    expect(historyLabel('Gaussian Blur…')).toBe('高斯模糊');
    expect(historyLabel('Levels…')).toBe('色阶');
    expect(historyLabel('Something New')).toBe('Something New');
  });
});

describe('command search', () => {
  const cmds = buildCommands();
  it('finds filters, tools and commands by Chinese label or keyword', () => {
    expect(searchCommands(cmds, '高斯')[0]?.label).toBe('高斯模糊');
    expect(searchCommands(cmds, '钢笔').some((c) => c.id === 'tool.pen')).toBe(true);
    expect(searchCommands(cmds, 'gaussian')[0]?.label).toBe('高斯模糊');
    expect(searchCommands(cmds, '新建图层')[0]?.hint).toMatch(/N/);
    expect(searchCommands(cmds, 'zzzz')).toHaveLength(0);
  });
});
