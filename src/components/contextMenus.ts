// Menu contents for right-clicks on the canvas and on layer rows (Photoshop-like, state aware).
import { useStore, flatten } from '../state/store';
import { isMacLike } from '../shortcuts';
import type { MenuEntry } from './ContextMenu';
import type { LayerNode } from '../engine/protocol';

const mod = () => (isMacLike() ? '⌘' : 'Ctrl+');
const sh = () => (isMacLike() ? '⇧' : 'Shift+');
const run = (p: Promise<unknown> | void) => { void p; };

function arrangeMenu(disabled: boolean): MenuEntry {
  const s = useStore.getState();
  return { label: '排列', icon: 'layers', disabled, submenu: [
    { label: '置为顶层', shortcut: `${sh()}${mod()}]`, onSelect: () => run(s.arrange('bringToFront')) },
    { label: '前移一层', shortcut: `${mod()}]`, onSelect: () => run(s.arrange('bringForward')) },
    { label: '后移一层', shortcut: `${mod()}[`, onSelect: () => run(s.arrange('sendBackward')) },
    { label: '置为底层', shortcut: `${sh()}${mod()}[`, onSelect: () => run(s.arrange('sendToBack')) },
  ] };
}

function alignMenu(disabled: boolean): MenuEntry {
  const s = useStore.getState();
  return { label: '对齐', icon: 'alignLeft', disabled, submenu: [
    { label: '左对齐', icon: 'alignLeft', onSelect: () => run(s.align('leftEdges')) },
    { label: '水平居中', icon: 'alignHCenter', onSelect: () => run(s.align('horizontalCenters')) },
    { label: '右对齐', icon: 'alignRight', onSelect: () => run(s.align('rightEdges')) },
    'separator',
    { label: '顶对齐', icon: 'alignTop', onSelect: () => run(s.align('topEdges')) },
    { label: '垂直居中', icon: 'alignVCenter', onSelect: () => run(s.align('verticalCenters')) },
    { label: '底对齐', icon: 'alignBottom', onSelect: () => run(s.align('bottomEdges')) },
  ] };
}

function layerEntries(layer: LayerNode | undefined): MenuEntry[] {
  const s = useStore.getState();
  const none = !layer;
  const locked = !!layer?.locks?.all;
  const smart = !!layer && /smart/i.test(layer.kind);
  const hidden = layer?.visible === false;
  return [
    { label: '复制图层', icon: 'copy', shortcut: `${mod()}J`, disabled: none, onSelect: () => run(s.duplicateLayer()) },
    { label: '新建图层', icon: 'plus', shortcut: `${sh()}${mod()}N`, onSelect: () => run(s.newLayer()) },
    { label: '编组', icon: 'folder', shortcut: `${mod()}G`, disabled: none, onSelect: () => run(s.groupLayers()) },
    arrangeMenu(none),
    alignMenu(none),
    'separator',
    { label: hidden ? '显示图层' : '隐藏图层', icon: hidden ? 'eye' : 'eyeOff', disabled: none, onSelect: () => layer && run(s.setProps(layer.id, { visible: hidden })) },
    { label: locked ? '解除锁定' : '锁定全部', icon: locked ? 'unlock' : 'lock', disabled: none, onSelect: () => run(s.setLocks({ all: !locked })) },
    { label: '添加蒙版', icon: 'mask', disabled: none || !!layer?.hasMask, onSelect: () => run(s.addMask(s.selection ? 'revealSelection' : 'revealAll')) },
    smart
      ? { label: '栅格化智能对象', icon: 'image', onSelect: () => run(s.rasterizeSmartObject()) }
      : { label: '转换为智能对象', icon: 'image', disabled: none, onSelect: () => run(s.convertToSmartObject()) },
    { label: '向下合并', icon: 'layers', shortcut: `${mod()}E`, disabled: none, onSelect: () => run(s.mergeDown()) },
    'separator',
    { label: '删除图层', icon: 'trash', danger: true, disabled: none || locked, onSelect: () => run(s.deleteLayer()) },
  ];
}

/** 调色 presets shared by the right-click menu and the selection action bar. */
export const GRADES: { label: string; adjust: import('../engine/region').AdjustArgs }[] = [
  { label: '提亮', adjust: { kind: 'brightnessContrast', brightness: 30, contrast: 5 } },
  { label: '压暗', adjust: { kind: 'brightnessContrast', brightness: -30 } },
  { label: '增加饱和', adjust: { kind: 'vibrance', vibrance: 40, saturation: 10 } },
  { label: '去色', adjust: { kind: 'hueSaturation', saturation: -100 } },
  { label: '暖色调', adjust: { kind: 'photoFilter', filter: 'warming85', density: 35 } },
  { label: '冷色调', adjust: { kind: 'photoFilter', filter: 'cooling80', density: 35 } },
];

function regionMenu(): MenuEntry {
  const s = useStore.getState();
  return { label: 'AI 选区操作', icon: 'sparkles', submenu: [
    { label: '识别框内物体', onSelect: () => run(s.smartSelect('object')) },
    { label: '平滑边缘', onSelect: () => run(s.refineSelection({ radius: 4, smooth: 20, feather: 1 })) },
    'separator',
    { label: '抠出为图层', onSelect: () => run(s.regionOp('cutout')) },
    { label: '移除（内容识别）', onSelect: () => run(s.regionOp('remove')) },
    { label: '调色', submenu: GRADES.map((g) => ({ label: g.label, onSelect: () => run(s.regionAdjust(g.adjust)) })) },
  ] };
}

/** Right-click on the canvas: selection commands first when a selection exists, then the active layer. */
export function canvasMenu(): MenuEntry[] {
  const s = useStore.getState();
  const layer = flatten(s.layers).find((l) => l.id === s.selectedId);
  const sel = !!s.selection;
  const selection: MenuEntry[] = sel ? [
    { label: '取消选择', icon: 'close', shortcut: `${mod()}D`, onSelect: () => run(s.selectMenu('deselect')) },
    { label: '选择反向', icon: 'marqueeRect', shortcut: `${sh()}${mod()}I`, onSelect: () => run(s.selectMenu('inverse')) },
    regionMenu(),
    { label: '通过拷贝的图层', icon: 'copy', shortcut: `${mod()}J`, onSelect: () => run(s.layerVia('copy')) },
    { label: '通过剪切的图层', icon: 'copy', shortcut: `${sh()}${mod()}J`, onSelect: () => run(s.layerVia('cut')) },
    { label: '填充前景色', icon: 'bucket', onSelect: () => run(s.fillSelection(s.foreground)) },
    { label: '裁剪到选区', icon: 'crop', onSelect: () => run(s.cropToSelection()) },
    { label: '选区转为蒙版', icon: 'mask', onSelect: () => run(s.selectionToMask()) },
    { label: '清除选区内像素', icon: 'eraser', danger: true, onSelect: () => run(s.clearPixels()) },
    'separator',
  ] : [
    { label: '全选', icon: 'marqueeRect', shortcut: `${mod()}A`, onSelect: () => run(s.selectMenu('all')) },
    { label: '重新选择', icon: 'marqueeRect', shortcut: `${sh()}${mod()}D`, onSelect: () => run(s.selectMenu('reselect')) },
    { label: '选择主体', icon: 'sparkles', onSelect: () => run(s.smartSelect('subject')) },
    { label: '焦点区域', icon: 'sparkles', onSelect: () => run(s.smartSelect('focus')) },
    'separator',
  ];
  return [
    ...selection,
    { label: '自由变换', icon: 'transform', shortcut: `${mod()}T`, disabled: !layer, onSelect: () => s.enterTransform() },
    { label: '剪贴板', icon: 'copy', submenu: [
      { label: '拷贝', shortcut: `${mod()}C`, disabled: !layer, onSelect: () => run(s.clipboardCopy('copy')) },
      { label: '剪切', shortcut: `${mod()}X`, disabled: !layer, onSelect: () => run(s.clipboardCopy('cut')) },
      { label: '合并拷贝', shortcut: `${sh()}${mod()}C`, onSelect: () => run(s.clipboardCopy('copyMerged')) },
      'separator',
      { label: '粘贴', shortcut: `${mod()}V`, onSelect: () => run(s.clipboardPaste('paste')) },
      { label: '原位粘贴', shortcut: `${sh()}${mod()}V`, onSelect: () => run(s.clipboardPaste('pasteInPlace')) },
      { label: '贴入选区', disabled: !sel, onSelect: () => run(s.clipboardPaste('pasteInto')) },
    ] },
    'separator',
    ...layerEntries(layer),
  ];
}

/** Right-click on a layer row (the row is selected first). `rename` starts inline renaming. */
export function layerMenu(layer: LayerNode, rename: () => void): MenuEntry[] {
  return [
    { label: '重命名', icon: 'type', onSelect: rename },
    ...layerEntries(layer),
  ];
}
