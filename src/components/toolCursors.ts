// Photoshop-style canvas cursors and one-line usage hints per tool. Cursors are small SVGs built from
// the toolbar icon paths: a white halo under a black line keeps them visible on any image.
import type { Tool } from '../state/store';

const ARROW = 'M5 3v17l5-5 4 7 3-2-4-7 7-1z';

/** Glyph, hotspot (in the 24×24 icon grid) and fill style for tools with their own cursor. */
const GLYPHS: Partial<Record<Tool, { d: string; hot: [number, number]; fill?: 'black' | 'white' }>> = {
  move: { d: `${ARROW}M17 15h6m-3-3v6`, hot: [5, 3], fill: 'black' },
  pathSelect: { d: ARROW, hot: [5, 3], fill: 'black' },
  directSelect: { d: ARROW, hot: [5, 3], fill: 'white' },
  eyedropper: { d: 'm14 4 6 6M16 6l-11 11v3h3L19 9M15 5l3-3 4 4-3 3', hot: [4, 20] },
  lasso: { d: 'M6 17c-6-3-4-12 6-12s12 10 3 12c-5 1-10-1-10 2 0 2 4 2 4 0 0-1-1-2-3-2', hot: [5, 19] },
  polyLasso: { d: 'M4 8l8-5 8 6-3 10-12-2z', hot: [4, 8] },
  wand: { d: 'm4 20 12-12 3 3L7 23M16 2v3M21 6h2M7 3l1 2M18 17l2 2M11 7l2 2', hot: [17, 9] },
  bucket: { d: 'm4 11 8-8 8 8-8 8-8-8zM3 11h17M8 2l5 6M20 15s-3 4-1 5 4-1 1-5', hot: [20, 20] },
  crop: { d: 'M6 3v15h15M3 6h15v15M9 6h9v9', hot: [6, 6] },
  pen: { d: 'm12 3 8 8-4 9-12 1 1-12zM4 21l8-9M10 10h4v4h-4z', hot: [4, 21] },
};

function svgCursor(g: NonNullable<(typeof GLYPHS)[Tool]>, fallback: string) {
  const fill = g.fill === 'black' ? '#000' : g.fill === 'white' ? '#fff' : 'none';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="-1 -1 26 26" fill="none" stroke-linecap="round" stroke-linejoin="round">`
    + `<path d="${g.d}" stroke="#fff" stroke-width="3.6"/>`
    + `<path d="${g.d}" stroke="#000" stroke-width="1.5" fill="${fill}"/></svg>`;
  // The viewBox is offset by 1px for the halo, so the hotspot shifts by one too.
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${g.hot[0] + 1} ${g.hot[1] + 1}, ${fallback}`;
}

const CACHE = new Map<Tool, string>();

/** CSS cursor for the canvas. Brush-like tools draw their own size ring (cursor: none). */
export function toolCursor(tool: Tool, strokeTool: boolean): string {
  if (tool === 'type') return 'text';
  if (tool === 'hand') return 'grab';
  if (strokeTool) return 'none';
  const g = GLYPHS[tool];
  if (!g) return 'crosshair';
  let c = CACHE.get(tool);
  if (!c) { c = svgCursor(g, tool === 'move' || tool === 'pathSelect' || tool === 'directSelect' ? 'default' : 'crosshair'); CACHE.set(tool, c); }
  return c;
}

/** Status-bar hint shown while a tool is active. */
export const TOOL_HINTS: Record<Tool, string> = {
  move: '移动：拖动移动所选图层 · 勾选「自动选择」可点选画面里的图层 · 方向键微移',
  marqueeRect: '矩形选框：拖动框选 · Shift 加选／正方形 · Alt 减选',
  marqueeEllipse: '椭圆选框：拖动框选 · Shift 加选／正圆 · Alt 减选',
  marqueeRow: '单行选框：点击选出 1 像素高的一行',
  marqueeCol: '单列选框：点击选出 1 像素宽的一列',
  lasso: '套索：按住拖动画出任意形状的选区 · Shift 加选 · Alt 减选',
  polyLasso: '多边形套索：逐点点击连线 · 双击或回到起点闭合',
  wand: '魔棒：点击选中颜色相近的区域 · 容差在上方选项栏调整',
  crop: '裁剪：拖动裁剪框 · 回车确认 · Esc 取消',
  brush: '画笔：在当前图层上绘制',
  pencil: '铅笔：硬边绘制',
  eraser: '橡皮：擦除当前图层的像素',
  bucket: '油漆桶：点击用前景色填充相近颜色区域',
  gradient: '渐变：拖动设定渐变方向与长度',
  eyedropper: '吸管：点击取色为前景色',
  spotHeal: '污点修复：涂抹瑕疵，自动用周围像素修补',
  healBrush: '修复画笔：Alt 点击取样，再涂抹修复',
  clone: '仿制图章：Alt 点击取样，再涂抹复制',
  pen: '钢笔：点击添加锚点，拖动拉出曲线 · 回到起点闭合路径',
  pathSelect: '路径选择（黑箭头）：点击选中整条路径或形状并移动',
  directSelect: '直接选择（白箭头）：选中并拖动单个锚点或控制柄',
  type: '文字：点击输入单行文字，拖动创建段落文字框',
  shape: '形状：拖动绘制形状，类型与填充在上方选项栏设置',
  transform: '自由变换：拖动控制点缩放／旋转 · 回车确认 · Esc 取消',
  hand: '抓手：拖动平移画布（任何工具下按住空格也可以）',
};
