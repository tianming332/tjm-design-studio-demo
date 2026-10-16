import { describe, expect, it, beforeEach } from 'vitest';
import { useStore } from '../state/store';
import { canvasMenu, layerMenu } from './contextMenus';
import type { MenuEntry, MenuItem } from './ContextMenu';

const labels = (m: MenuEntry[]) => m.filter((x): x is MenuItem => x !== 'separator').map((x) => x.label);
const item = (m: MenuEntry[], label: string) => m.find((x): x is MenuItem => x !== 'separator' && x.label === label)!;
const layer = { id: 3, name: '标题', kind: 'Type', blend: 'normal', fill: 1 };

describe('context menus', () => {
  beforeEach(() => useStore.setState({ layers: [layer as never], selectedId: 3, selectedIds: [3], selection: undefined }));
  it('canvas: selection commands only when a selection exists', () => {
    expect(labels(canvasMenu())).toContain('全选');
    expect(labels(canvasMenu())).not.toContain('取消选择');
    useStore.setState({ selection: { x: 0, y: 0, width: 2, height: 2, coverage: new Uint8Array(4) } });
    const m = canvasMenu();
    expect(labels(m).slice(0, 4)).toEqual(['取消选择', '选择反向', 'AI 选区操作', '通过拷贝的图层']);
    expect(labels(item(m, 'AI 选区操作').submenu!)).toEqual(['识别框内物体', '平滑边缘', '抠出为图层', '移除（内容识别）', '调色']);
    expect(item(m, '清除选区内像素').danger).toBe(true);
  });
  it('layer entries follow the layer state; delete is red and blocked when locked', () => {
    const m = layerMenu(layer as never, () => undefined);
    expect(labels(m)[0]).toBe('重命名');
    expect(item(m, '删除图层')).toMatchObject({ danger: true, disabled: false });
    expect(item(m, '排列').submenu).toHaveLength(4);
    const locked = layerMenu({ ...layer, locks: { all: true, pixels: false, position: false, transparency: false } } as never, () => undefined);
    expect(item(locked, '删除图层').disabled).toBe(true);
    expect(labels(locked)).toContain('解除锁定');
    const hidden = layerMenu({ ...layer, visible: false } as never, () => undefined);
    expect(labels(hidden)).toContain('显示图层');
  });
  it('no active layer: layer commands are disabled, new layer still available', () => {
    useStore.setState({ layers: [], selectedId: undefined, selectedIds: [] });
    const m = canvasMenu();
    expect(item(m, '复制图层').disabled).toBe(true);
    expect(item(m, '新建图层').disabled).toBeFalsy();
  });
});
