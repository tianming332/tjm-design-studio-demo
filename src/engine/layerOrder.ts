import type { LayerNode } from './protocol';

export type LayerDropPosition = 'above' | 'below' | 'into';
export function layerDropProblem(layers: LayerNode[], ids: number[], target: number, position: LayerDropPosition): string | undefined {
  const nodes = new Map<number, LayerNode>(), paths = new Map<number, number[]>();
  const walk = (list: LayerNode[], path: number[]) => { for (const n of list) { nodes.set(n.id, n); paths.set(n.id, [...path, n.id]); if (n.children) walk(n.children, [...path, n.id]); } };
  walk(layers, []);
  if (!ids.length || !nodes.has(target) || ids.some((id) => !nodes.has(id))) return '图层已变化，请重新拖动';
  if (ids.includes(target)) return '不能放到选中的图层上';
  if (ids.some((id) => paths.get(target)!.includes(id))) return '不能把编组放入自身或子图层';
  if (ids.some((id) => nodes.get(id)?.locks?.all || /^pixel$/i.test(nodes.get(id)!.kind) && /^(背景|background)$/i.test(nodes.get(id)!.name) && nodes.get(id)?.locks?.transparency)) return '先解锁要移动的图层';
  const destination = nodes.get(target)!;
  if (position === 'into' && !/group/i.test(destination.kind)) return '只有编组可以接收图层';
  if (position === 'into' && destination.locks?.all) return '目标编组已锁定';
  if (position === 'below' && /^(背景|background)$/i.test(destination.name) && destination.locks?.transparency) return '不能放到锁定背景下方';
  return undefined;
}
