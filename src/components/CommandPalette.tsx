// Function search (Ctrl/⌘+F): every tool, menu command, filter, adjustment, layer style and panel
// in one list. Matching is on the Chinese label plus English keywords; Enter runs the top hit.
import { openAISettings } from './AISettings';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { useAppearance } from '../state/appearance';
import { SHORTCUTS, comboLabel, type ShortcutAction } from '../shortcuts';
import { TOOLS } from './Toolbar';
import { FILTERS, filterId } from '../engine/filters';
import { ADJUSTMENTS } from '../workspaces/photo/adjustments';
import { EFFECTS } from '../engine/fx';
import { Icon } from './Icon';
import { requestManualEdit } from './ManualTakeover';
import { openPanel } from './Dock';
import { selectCreationMode, selectEditScene, openAICreation } from '../state/navigation';

export interface Command { id: string; label: string; group: string; keywords?: string; hint?: string; run: () => void }

const st = () => useStore.getState();
const panel = (p: 'properties' | 'adjustments' | 'more' | 'history') => openPanel(p);

/** Runs a shortcut action through the same path as the keyboard (see App.tsx). */
let runAction: (a: ShortcutAction) => void = () => undefined;
export function registerShortcutRunner(fn: (a: ShortcutAction) => void) { runAction = fn; }

export function buildCommands(): Command[] {
  const out: Command[] = [];
  const seen = new Set<string>();
  for (const s of SHORTCUTS) {
    if (seen.has(s.action)) continue;
    seen.add(s.action);
    out.push({ id: `sc.${s.action}`, label: s.label, group: '命令', keywords: s.action, hint: comboLabel(s), run: () => runAction(s.action) });
  }
  for (const t of TOOLS) {
    out.push({ id: `tool.${t.id}`, label: `${t.name}工具`, group: '工具', keywords: t.id, hint: t.key ? `${t.shift ? 'Shift+' : ''}${t.key.toUpperCase()}` : undefined,
      run: () => (t.id === 'transform' ? st().enterTransform() : st().setTool(t.id)) });
  }
  for (const f of FILTERS) {
    out.push({ id: `filter.${filterId(f)}`, label: f.label, group: `滤镜 · ${f.group}`, keywords: f.cmd, run: () => { panel('adjustments'); useStore.setState({ filterPick: filterId(f) }); } });
  }
  for (const a of ADJUSTMENTS) {
    out.push({ id: `adj.${a.cmd}`, label: `${a.label}（调整图层）`, group: '调整', keywords: a.cmd, run: () => void st().addAdjustment(a.cmd) });
  }
  for (const e of EFFECTS) {
    out.push({ id: `fx.${e.cmd}`, label: `${e.label}（图层样式）`, group: '图层样式', keywords: e.cmd, run: () => panel('adjustments') });
  }
  const extra: [string, string, string, () => void][] = [
    ['mode.design', 'AI 制图 · 设计 Agent', '创作方式', () => selectCreationMode('design')],
    ['ai.poster', 'AI 制图 · 生成整张海报', '输出方式', () => openAICreation('poster')],
    ['ai.asset', 'AI 制图 · 生成素材', '输出方式', () => openAICreation('asset')],
    ['ai.layered', 'AI 制图 · 生成分层海报', '输出方式', () => openAICreation('layered')],
    ['mode.manual', '手动编辑', '创作方式', requestManualEdit],
    ['scene.poster', '海报排版', '编辑场景', () => selectEditScene('poster')],
    ['scene.photo', '照片处理', '编辑场景', () => selectEditScene('photo')],
    ['p.assets', '素材库', '面板', () => openPanel('assets')],
    ['new', '新建文档', '文件', () => useStore.setState({ newDocOpen: true })],
    ['export.png', '导出 PNG', '文件', () => void st().exportAs('png')],
    ['export.jpeg', '导出 JPEG', '文件', () => void st().exportAs('jpeg')],
    ['export.pcraft', '存为工程', '文件', () => void st().exportAs('pcraft')],
    ['revert', '恢复到打开时', '文件', () => void st().revertDocument()],
    ['mode.rgb', 'RGB 颜色模式', '图像', () => void st().imageMode('rgb')],
    ['mode.gray', '灰度模式', '图像', () => void st().imageMode('grayscale')],
    ['mode.cmyk', 'CMYK 颜色模式', '图像', () => void st().imageMode('cmyk')],
    ['mode.lab', 'Lab 颜色模式', '图像', () => void st().imageMode('lab')],
    ['bits8', '8 位/通道', '图像', () => void st().imageMode('bits8')],
    ['bits16', '16 位/通道', '图像', () => void st().imageMode('bits16')],
    ['rot90', '图像旋转 顺时针 90°', '图像', () => void st().rotate('90cw')],
    ['rot90ccw', '图像旋转 逆时针 90°', '图像', () => void st().rotate('90ccw')],
    ['rot180', '图像旋转 180°', '图像', () => void st().rotate('180')],
    ['flipH', '水平翻转画布', '图像', () => void st().rotate('flipCanvasHorizontal')],
    ['flipV', '垂直翻转画布', '图像', () => void st().rotate('flipCanvasVertical')],
    ['autoTone', '自动色调', '图像', () => void st().auto('autoTone')],
    ['autoContrast', '自动对比度', '图像', () => void st().auto('autoContrast')],
    ['autoColor', '自动颜色', '图像', () => void st().auto('autoColor')],
    ['dup', '复制图层', '图层', () => void st().duplicateLayer()],
    ['del', '删除图层', '图层', () => void st().deleteLayer()],
    ['flatten', '拼合图像', '图层', () => void st().flattenImage()],
    ['solid', '纯色填充图层', '图层', () => void st().newFillLayer('solid')],
    ['gradfill', '渐变填充图层', '图层', () => void st().newFillLayer('gradient')],
    ['maskAll', '添加图层蒙版（显示全部）', '图层', () => void st().addMask('revealAll')],
    ['maskHide', '添加图层蒙版（隐藏全部）', '图层', () => void st().addMask('hideAll')],
    ['clip', '创建剪贴蒙版', '图层', () => void st().createClippingMask()],
    ['unclip', '释放剪贴蒙版', '图层', () => void st().releaseClippingMask()],
    ['so', '转换为智能对象', '图层', () => void st().convertToSmartObject()],
    ['raster', '栅格化智能对象', '图层', () => void st().rasterizeSmartObject()],
    ['bg', '背景图层转为普通图层', '图层', () => void st().layerFromBackground()],
    ['grow', '扩大选取', '选择', () => void st().selectMenu('grow')],
    ['similar', '选取相似', '选择', () => void st().selectMenu('similar')],
    ['feather', '羽化选区（4 px）', '选择', () => void st().selectModify('feather', 4)],
    ['expand', '扩展选区（4 px）', '选择', () => void st().selectModify('expand', 4)],
    ['contract', '收缩选区（4 px）', '选择', () => void st().selectModify('contract', 4)],
    ['caf', '内容识别填充', '编辑', () => void st().contentAwareFill()],
    ['p.props', '属性面板', '面板', () => panel('properties')],
    ['p.adj', '调整 · 滤镜 · 图层样式面板', '面板', () => panel('adjustments')],
    ['p.more', '选区 · 路径 · 参考线面板', '面板', () => panel('more')],
    ['p.hist', '历史记录面板', '面板', () => panel('history')],
    ['settings', '外观设置', '面板', () => useAppearance.setState({ settingsOpen: true })],
    ['sparkles', 'AI 设置（Key 与模型）', '面板', openAISettings],
  ];
  for (const [id, label, group, run] of extra) out.push({ id, label, group, run });
  return out;
}

/** Ranking: exact/prefix/substring on the label, then keyword hits; all query tokens must match. */
export function searchCommands(cmds: Command[], q: string, limit = 30): Command[] {
  const toks = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!toks.length) return cmds.slice(0, limit);
  const scored: [number, Command][] = [];
  for (const c of cmds) {
    const label = c.label.toLowerCase(), hay = `${label} ${c.group.toLowerCase()} ${(c.keywords ?? '').toLowerCase()}`;
    if (!toks.every((t) => hay.includes(t))) continue;
    const t0 = toks[0];
    const score = label === t0 ? 0 : label.startsWith(t0) ? 1 : label.includes(t0) ? 2 : 3;
    scored.push([score, c]);
  }
  return scored.sort((a, b) => a[0] - b[0] || a[1].label.length - b[1].label.length).slice(0, limit).map(([, c]) => c);
}

export function CommandPalette() {
  const open = useStore((s) => s.commandPaletteOpen);
  const [q, setQ] = useState('');
  const [i, setI] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const all = useMemo(() => (open ? buildCommands() : []), [open]);
  const hits = useMemo(() => searchCommands(all, q), [all, q]);
  useEffect(() => { if (open) { setQ(''); setI(0); setTimeout(() => input.current?.focus(), 0); } }, [open]);
  useEffect(() => setI(0), [q]);
  if (!open) return null;
  const close = () => useStore.setState({ commandPaletteOpen: false });
  const run = (c?: Command) => { if (!c) return; close(); c.run(); };
  return (
    <div className="palette-backdrop" data-editor-popover="" onPointerDown={close}>
      <div className="palette" role="dialog" aria-label="搜索功能" onPointerDown={(e) => e.stopPropagation()}>
        <div className="palette-input"><Icon name="search" size={16} />
          <input
            ref={input} value={q} placeholder="搜索工具、命令、滤镜、调整、面板…" aria-label="搜索功能输入"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') { e.preventDefault(); close(); }
              else if (e.key === 'ArrowDown') { e.preventDefault(); setI((v) => Math.min(hits.length - 1, v + 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setI((v) => Math.max(0, v - 1)); }
              else if (e.key === 'Enter') { e.preventDefault(); run(hits[i]); }
            }}
          />
        </div>
        <ul className="palette-list" role="listbox" aria-label="搜索结果">
          {hits.map((c, k) => (
            <li key={c.id} role="option" aria-selected={k === i} className={k === i ? 'on' : ''} onPointerEnter={() => setI(k)} onClick={() => run(c)}>
              <span className="palette-label">{c.label}</span><small>{c.group}</small>{c.hint && <kbd>{c.hint}</kbd>}
            </li>
          ))}
          {!hits.length && <li className="palette-empty">没有找到「{q}」</li>}
        </ul>
      </div>
    </div>
  );
}
