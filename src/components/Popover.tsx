import { useEffect, useRef, type ReactNode } from 'react';

/** Escape/outside-click dismisses only this surface and restores focus. */
export function Popover({ children, onClose, className = '', style, label }: { children: ReactNode; onClose: () => void; className?: string; style?: React.CSSProperties; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    const initial = ref.current?.querySelector<HTMLElement>('button[aria-checked=true]')
      ?? ref.current?.querySelector<HTMLElement>('button[role=radio]')
      ?? ref.current?.querySelector<HTMLElement>('button:not(:disabled), input');
    initial?.focus();
    const outside = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) close.current(); };
    document.addEventListener('pointerdown', outside);
    return () => { document.removeEventListener('pointerdown', outside); if (trigger?.isConnected) trigger.focus(); };
  }, []);
  return (
    <div ref={ref} className={`popover ${className}`} data-editor-popover="" style={style} aria-label={label}
      onKeyDown={(e) => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key) && e.target instanceof HTMLButtonElement) {
          const buttons = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);
          if (!buttons.length) return;
          e.preventDefault(); e.stopPropagation();
          const i = buttons.indexOf(e.target);
          const next = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : (i + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
          buttons[next].focus();
        }
        if (e.key === 'Tab') {
          const focusable = Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input, select') ?? []);
          if (e.target === (e.shiftKey ? focusable[0] : focusable[focusable.length - 1])) onClose();
        }
      }}>{children}</div>
  );
}
