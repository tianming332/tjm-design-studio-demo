import { Fragment, useEffect, useState } from 'react';
import { useStore, type Tool } from '../state/store';
import { Icon } from './Icon';
import { Popover } from './Popover';
import { ColorSwatches, PaletteTool } from './ColorSwatches';
import { useNavigation } from '../state/navigation';
import { useLayout } from '../state/layout';
import { AIToolSection } from './AIToolSection';

export const TOOLS: { id: Tool; name: string; key: string; shift?: boolean }[] = [
  { id: 'move', name: '移动', key: 'v' },
  { id: 'marqueeRect', name: '矩形选框', key: 'm' },
  { id: 'marqueeEllipse', name: '椭圆选框', key: 'm', shift: true },
  { id: 'marqueeRow', name: '单行选框', key: '' },
  { id: 'marqueeCol', name: '单列选框', key: '' },
  { id: 'lasso', name: '套索', key: 'l' },
  { id: 'polyLasso', name: '多边形套索', key: 'l', shift: true },
  { id: 'wand', name: '魔棒', key: 'w' },
  { id: 'crop', name: '裁剪', key: 'c' },
  { id: 'brush', name: '画笔', key: 'b' },
  { id: 'pencil', name: '铅笔', key: 'n' },
  { id: 'eraser', name: '橡皮', key: 'e' },
  { id: 'bucket', name: '油漆桶', key: 'g' },
  { id: 'gradient', name: '渐变', key: 'g', shift: true },
  { id: 'eyedropper', name: '吸管', key: 'i' },
  { id: 'spotHeal', name: '污点修复', key: 'j' },
  { id: 'healBrush', name: '修复画笔', key: 'j', shift: true },
  { id: 'clone', name: '仿制图章', key: 's' },
  { id: 'pen', name: '钢笔', key: 'p' },
  { id: 'pathSelect', name: '路径选择（黑箭头）', key: 'a' },
  { id: 'directSelect', name: '直接选择（白箭头）', key: 'a', shift: true },
  { id: 'type', name: '文字', key: 't' },
  { id: 'shape', name: '形状', key: 'u' },
  { id: 'transform', name: '自由变换（Ctrl/⌘+T）', key: '' },
  { id: 'hand', name: '抓手', key: 'h' },
];
const GROUPS: Tool[][][] = [
  [['move'], ['marqueeRect', 'marqueeEllipse', 'marqueeRow', 'marqueeCol'], ['lasso', 'polyLasso'], ['wand'], ['crop']],
  [['brush', 'pencil'], ['eraser'], ['bucket', 'gradient'], ['spotHeal', 'healBrush', 'clone'], ['eyedropper']],
  [['pen', 'pathSelect', 'directSelect'], ['type'], ['shape'], ['transform']],
  [['hand']],
];
const AI_COMMON: Tool[] = ['move', 'marqueeRect', 'crop', 'brush', 'type', 'shape', 'hand'];
const keyLabel = (t: typeof TOOLS[number]) => t.key ? `${t.shift ? 'Shift+' : ''}${t.key.toUpperCase()}` : '';
const typing = (t: EventTarget | null) => t instanceof HTMLElement && (['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) || t.isContentEditable);

export function Toolbar() {
  const activeTool = useStore((s) => s.activeTool);
  const ai = useNavigation((s) => s.mode === 'design');
  const allTools = useNavigation((s) => s.allTools);
  const side = useLayout((s) => s.layout.toolbarSide);
  const setTool = useStore((s) => s.setTool);
  const enterTransform = useStore((s) => s.enterTransform);
  const [remembered, setRemembered] = useState<Record<string, Tool>>({});
  const [open, setOpen] = useState<{ tools: Tool[]; top: number } | null>(null);
  const pick = (id: Tool) => {
    if (id === 'transform') enterTransform(); else setTool(id); setOpen(null);
  };
  useEffect(() => {
    const group = GROUPS.flat().find((g) => g.includes(activeTool));
    if (group) setRemembered((p) => p[group[0]] === activeTool ? p : { ...p, [group[0]]: activeTool });
  }, [activeTool]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || e.keyCode === 229 || e.metaKey || e.ctrlKey || e.altKey || typing(e.target) || document.querySelector('dialog[open], [data-editor-popover]')) return;
      const t = TOOLS.find((x) => x.key === e.key.toLowerCase() && !!x.shift === e.shiftKey);
      if (t) { e.preventDefault(); if (t.id === 'transform') enterTransform(); else setTool(t.id); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setTool, enterTransform]);
  useEffect(() => {
    const close = () => setOpen(null);
    window.addEventListener('resize', close);
    return () => window.removeEventListener('resize', close);
  }, []);
  return (
    <aside className="toolbar" aria-label="编辑工具" onScroll={() => setOpen(null)}>
      <div className="tool-stack" role="toolbar" aria-label="图像工具" aria-orientation="vertical" onScroll={() => setOpen(null)}
        onKeyDown={(e) => {
          if (!(e.target instanceof HTMLButtonElement) || !e.target.classList.contains('tool') || !['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return;
          e.preventDefault(); e.stopPropagation();
          const tools = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('.tool'));
          const i = tools.indexOf(e.target);
          const next = e.key === 'Home' ? 0 : e.key === 'End' ? tools.length - 1 : (i + (e.key === 'ArrowDown' ? 1 : -1) + tools.length) % tools.length;
          tools[next]?.focus();
        }}>
        {GROUPS.map((section) => section.filter((group) => !ai || allTools || AI_COMMON.includes(group[0]) || group.includes(activeTool))).map((section, i) => <Fragment key={i}>{section.length > 0 && <div className="tool-section">
          {section.map((group) => {
            const id = group.includes(activeTool) ? activeTool : remembered[group[0]] ?? group[0];
            const t = TOOLS.find((x) => x.id === id)!;
            return <div className="tool-slot" key={group[0]}>
              <button className={'tool' + (id === activeTool ? ' active' : '')} onClick={() => pick(id)} title={`${t.name}${t.key ? `（${keyLabel(t)}）` : ''}`} aria-label={t.name} aria-pressed={id === activeTool}><Icon name={id} /></button>
              {group.length > 1 && <button className="tool-more" aria-label={`更多${TOOLS.find((x) => x.id === group[0])!.name}工具`} title="展开同组工具" aria-expanded={open?.tools === group} onClick={(e) => setOpen(open?.tools === group ? null : { tools: group, top: Math.min(e.currentTarget.getBoundingClientRect().top, window.innerHeight - group.length * 36 - 78) })}><span /></button>}
            </div>;
          })}
        </div>}{i === 2 && <div className="tool-section palette-tool-section"><PaletteTool /></div>}</Fragment>)}
        <AIToolSection side={side} />
        {ai && <button className="toolset-toggle" aria-label={allTools ? '只显示常用工具' : '显示全部工具'} aria-expanded={allTools}
          title={allTools ? '收起低频工具，所有快捷键仍然可用' : '展开全部编辑工具，不切换模式'} onClick={() => { useNavigation.setState({ allTools: !allTools }); setOpen(null); }}><Icon name={allTools ? 'minus' : 'plus'} size={15} /><span>{allTools ? '常用' : '全部'}</span></button>}
      </div>
      <div className="toolbar-colors"><ColorSwatches /></div>
      {open && <Popover label="工具选择" className="tool-popover" style={{ top: Math.max(84, open.top), ...(side === 'right' ? { right: 54, left: 'auto' } : { left: 54 }) }} onClose={() => setOpen(null)}>
        <div className="popover-heading">选择工具<button className="icon-button" aria-label="关闭工具选择" onClick={() => setOpen(null)}><Icon name="close" size={14} /></button></div>
        <div role="radiogroup" aria-label="同组工具">
          {open.tools.map((id) => { const t = TOOLS.find((x) => x.id === id)!; return <button className="menu-item" role="radio" aria-checked={id === activeTool} key={id} onClick={() => pick(id)}><Icon name={id} /><span>{t.name}</span><kbd>{keyLabel(t)}</kbd>{id === activeTool && <Icon name="check" size={14} />}</button>; })}
        </div>
      </Popover>}
    </aside>
  );
}
