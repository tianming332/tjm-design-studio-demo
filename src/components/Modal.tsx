import { useEffect, useRef, type ReactNode } from 'react';
import { Icon } from './Icon';

export function Modal({ title, onClose, children, className = '', dismissDisabled = false }: { title: string; onClose: () => void; children: ReactNode; className?: string; dismissDisabled?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const el = ref.current!;
    const trigger = document.activeElement as HTMLElement | null;
    el.showModal();
    return () => {
      el.close();
      if (trigger?.isConnected) trigger.focus();
      else document.querySelector<HTMLButtonElement>('.topbar .open-button')?.focus();
    };
  }, []);
  return (
    <dialog ref={ref} className={`modal ${className}`} aria-label={title} onCancel={(e) => { e.preventDefault(); if (!dismissDisabled) closeRef.current(); }}>
      <header className="modal-header"><h2>{title}</h2><button className="icon-button" disabled={dismissDisabled} aria-label={`关闭${title}`} onClick={onClose}><Icon name="close" /></button></header>
      {children}
    </dialog>
  );
}
