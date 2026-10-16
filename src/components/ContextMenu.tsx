// Right-click menus (canvas and layer rows): one host, keyboard navigable, submenus, destructive
// items in red. Opening animation is skipped in 低开销模式 / reduced motion (CSS).
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { Icon } from './Icon';

export interface MenuItem {
  label: string;
  icon?: string;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  checked?: boolean;
  onSelect?: () => void;
  submenu?: MenuEntry[];
}
export type MenuEntry = MenuItem | 'separator';

interface MenuState { at?: { x: number; y: number }; items: MenuEntry[]; label: string; open(x: number, y: number, items: MenuEntry[], label: string): void; close(): void }
export const useContextMenu = create<MenuState>((set) => ({
  items: [], label: '',
  open(x, y, items, label) { set({ at: { x, y }, items, label }); },
  close() { set({ at: undefined, items: [] }); },
}));

/** Keeps a menu inside the viewport; flips left / up near the edges. */
function place(el: HTMLElement, x: number, y: number) {
  const r = el.getBoundingClientRect();
  const left = x + r.width > innerWidth - 6 ? Math.max(6, x - r.width) : x;
  const top = y + r.height > innerHeight - 6 ? Math.max(6, innerHeight - r.height - 6) : y;
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
  el.style.transformOrigin = `${x - left}px ${y - top}px`;
}

function MenuList({ items, x, y, label, onDone, depth = 0 }: { items: MenuEntry[]; x: number; y: number; label: string; onDone(): void; depth?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [sub, setSub] = useState<{ index: number; x: number; y: number }>();
  useLayoutEffect(() => { if (ref.current) place(ref.current, x, y); }, [x, y]);
  useEffect(() => { if (depth === 0) ref.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus(); }, [depth]);
  const buttons = () => Array.from(ref.current?.querySelectorAll<HTMLButtonElement>(':scope > button:not(:disabled)') ?? []);
  const openSub = (index: number, el: HTMLElement) => { const r = el.getBoundingClientRect(); setSub({ index, x: r.right - 4, y: r.top - 5 }); };
  return <>
    <div ref={ref} className="ctx-menu" role="menu" aria-label={label} data-depth={depth}
      onPointerDown={(e) => e.stopPropagation()} onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        const list = buttons(), i = list.indexOf(document.activeElement as HTMLButtonElement);
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); list[(i + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length]?.focus(); }
        else if (e.key === 'ArrowRight' && i >= 0 && list[i].dataset.sub) { e.preventDefault(); openSub(Number(list[i].dataset.index), list[i]); }
        else if (e.key === 'ArrowLeft' && depth > 0) { e.preventDefault(); onDone(); }
        else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); useContextMenu.getState().close(); }
        e.stopPropagation();
      }}>
      {items.map((it, index) => it === 'separator' ? <hr key={`s${index}`} /> : (
        <button key={it.label} role="menuitem" data-index={index} data-sub={it.submenu ? '1' : undefined} disabled={it.disabled}
          className={`${it.danger ? 'danger' : ''}${sub?.index === index ? ' open' : ''}`} aria-haspopup={it.submenu ? 'menu' : undefined} aria-expanded={it.submenu ? sub?.index === index : undefined}
          onPointerEnter={(e) => { if (it.submenu && !it.disabled) openSub(index, e.currentTarget); else setSub(undefined); }}
          onClick={(e) => {
            if (it.submenu) { openSub(index, e.currentTarget); return; }
            useContextMenu.getState().close();
            it.onSelect?.();
          }}>
          <span className="ctx-icon">{it.checked ? <Icon name="check" size={14} /> : it.icon ? <Icon name={it.icon} size={15} /> : null}</span>
          <span className="ctx-label">{it.label}</span>
          {it.shortcut && <kbd>{it.shortcut}</kbd>}
          {it.submenu && <span className="ctx-more"><Icon name="chevron" size={12} /></span>}
        </button>))}
    </div>
    {sub && (() => { const it = items[sub.index]; return it !== 'separator' && it.submenu
      ? <MenuList items={it.submenu} x={sub.x} y={sub.y} label={it.label} depth={depth + 1} onDone={() => { setSub(undefined); buttons()[0]?.focus(); }} /> : null; })()}
  </>;
}

export function ContextMenuHost() {
  const at = useContextMenu((s) => s.at);
  const items = useContextMenu((s) => s.items);
  const label = useContextMenu((s) => s.label);
  useEffect(() => {
    if (!at) return;
    const close = () => useContextMenu.getState().close();
    window.addEventListener('pointerdown', close);
    window.addEventListener('blur', close);
    window.addEventListener('resize', close);
    window.addEventListener('wheel', close, { passive: true });
    return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('blur', close); window.removeEventListener('resize', close); window.removeEventListener('wheel', close); };
  }, [at]);
  if (!at) return null;
  return <div className="ctx-layer"><MenuList items={items} x={at.x} y={at.y} label={label} onDone={() => useContextMenu.getState().close()} /></div>;
}
