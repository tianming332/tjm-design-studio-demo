import { useState } from 'react';
import { useStore } from '../state/store';
import { ColorPicker } from './ColorPicker';
import { Icon } from './Icon';

export function ColorSwatches() {
  const foreground = useStore((s) => s.foreground);
  const background = useStore((s) => s.background);
  const [target, setTarget] = useState<'foreground' | 'background'>();
  return <>
    <div className="swatches" title="前景色 / 背景色（X 交换，D 复位）">
      <button className="swatch bg" style={{ background }} aria-label="背景色" onClick={() => setTarget('background')} />
      <button className="swatch fg" style={{ background: foreground }} aria-label="前景色" onClick={() => setTarget('foreground')} />
    </div>
    <div className="color-quick-actions">
      <button onClick={() => useStore.getState().swapColors()} title="交换 (X)" aria-label="交换前景背景色"><Icon name="swap" size={13} /></button>
      <button onClick={() => useStore.getState().defaultColors()} title="复位 (D)" aria-label="复位颜色"><Icon name="resetColors" size={13} /></button>
    </div>
    {target && <ColorPicker title={target === 'foreground' ? '前景色 · 拾色器' : '背景色 · 拾色器'} color={target === 'foreground' ? foreground : background} onChange={(hex) => target === 'foreground' ? useStore.getState().setForeground(hex) : useStore.getState().setBackground(hex)} onClose={() => setTarget(undefined)} />}
  </>;
}

/** Palette is a regular toolbar tool; foreground/background remain in the bottom color dock. */
export function PaletteTool() {
  const foreground = useStore((s) => s.foreground);
  const [open, setOpen] = useState(false);
  return <>
    <button className="tool color-picker-toggle" onClick={() => setOpen(true)} aria-label="拾色器" aria-expanded={open} title="色板与拾色器"><Icon name="palette" size={18} /></button>
    {open && <ColorPicker title="前景色 · 拾色器" color={foreground} onChange={(hex) => useStore.getState().setForeground(hex)} onClose={() => setOpen(false)} />}
  </>;
}
