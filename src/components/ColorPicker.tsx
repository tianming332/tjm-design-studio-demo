import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { hexToHsb, hexToRgb, hsbToHex, rgbToHex, type Hsb, type Rgb } from '../engine/color';
import { COLOR_PALETTES, usePalette } from '../state/palette';
import { Modal } from './Modal';
import { Icon } from './Icon';

/** Shared custom picker. Changes are live; opening/closing it never changes the document. */
export function ColorPicker({ color, onChange, title, onClose }: { color: string; onChange: (hex: string) => void; title: string; onClose: () => void }) {
  const [hsb, setHsb] = useState(() => hexToHsb(color));
  const [text, setText] = useState(color);
  const [palette, setPalette] = useState<string>('精选');
  const emitted = useRef(color.toLowerCase());
  const original = useRef(color);
  const current = useRef(color);
  const palettes = usePalette();
  current.current = color;
  useEffect(() => {
    if (color.toLowerCase() !== emitted.current) setHsb(hexToHsb(color));
    emitted.current = color.toLowerCase(); setText(color);
  }, [color]);
  const apply = (hex: string, remember = false) => {
    emitted.current = hex.toLowerCase(); current.current = hex;
    setText(hex); onChange(hex);
    if (remember) palettes.remember(hex);
  };
  const pick = (hex: string) => { setHsb(hexToHsb(hex)); apply(hex, true); };
  const changeHSB = (next: Hsb) => { setHsb(next); apply(hsbToHex(next)); };
  const changeRGB = (key: keyof Rgb, value: number) => { const hex = rgbToHex({ ...hexToRgb(color), [key]: value }); setHsb(hexToHsb(hex)); apply(hex); };
  const point = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    changeHSB({ ...hsb, s: Math.round(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * 100), b: Math.round((1 - Math.max(0, Math.min(1, (e.clientY - r.top) / r.height))) * 100) });
  };
  const swatches = (colors: readonly string[], label: string) => <div className="palette-colors" role="group" aria-label={label}>
    {colors.map((hex) => <button key={hex} className="palette-color" style={{ background: hex }} aria-label={`${label} ${hex}`} title={hex.toUpperCase()} aria-pressed={hex === color.toLowerCase()} onClick={() => pick(hex)}>{hex === color.toLowerCase() && <span><Icon name="check" size={12} /></span>}</button>)}
  </div>;
  return createPortal(<Modal title={title} className="color-studio" onClose={onClose}>
    <div className="color-studio-body">
      <div className="color-picker-main">
        <div className="color-plane" role="group" tabIndex={0} aria-label="饱和度与明度" aria-description="左右方向键调整饱和度，上下方向键调整明度" style={{ backgroundColor: hsbToHex({ h: hsb.h, s: 100, b: 100 }) }}
          onPointerDown={(e) => { e.preventDefault(); e.currentTarget.focus(); e.currentTarget.setPointerCapture(e.pointerId); point(e); }}
          onPointerMove={(e) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) point(e); }}
          onPointerUp={(e) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); palettes.remember(current.current); }}
          onKeyDown={(e) => {
            if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
            e.preventDefault(); e.stopPropagation();
            const step = e.shiftKey ? 10 : 1;
            changeHSB({ ...hsb, s: Math.max(0, Math.min(100, hsb.s + (e.key === 'ArrowRight' ? step : e.key === 'ArrowLeft' ? -step : 0))), b: Math.max(0, Math.min(100, hsb.b + (e.key === 'ArrowUp' ? step : e.key === 'ArrowDown' ? -step : 0))) });
          }} onKeyUp={() => palettes.remember(current.current)}>
          <span className="color-plane-cursor" style={{ left: `${hsb.s}%`, top: `${100 - hsb.b}%`, background: color }} />
        </div>
        <label className="hue-label"><span>色相</span><input className="hue-strip" type="range" min={0} max={359} value={hsb.h} aria-label="色相滑块" onChange={(e) => changeHSB({ ...hsb, h: +e.target.value })} onPointerUp={() => palettes.remember(current.current)} onKeyUp={() => palettes.remember(current.current)} /></label>
        <div className="color-value-row"><div className="color-comparison"><button aria-label="恢复打开时的颜色" title="恢复打开时的颜色" style={{ background: original.current }} onClick={() => pick(original.current)} /><span style={{ background: color }} title="当前颜色" /></div>
          <label className="hex-field">HEX<input aria-label="十六进制" maxLength={7} value={text.toUpperCase()} onChange={(e) => { const next = e.target.value; setText(next); if (/^#?[0-9a-f]{6}$/i.test(next)) { const hex = rgbToHex(hexToRgb(next)); setHsb(hexToHsb(hex)); apply(hex); } }} onBlur={() => { setText(color); palettes.remember(current.current); }} /></label>
          <button className="color-favorite" aria-label="收藏当前颜色" aria-pressed={palettes.favorites.includes(color.toLowerCase())} title="收藏当前颜色" onClick={() => palettes.toggleFavorite(color)}><Icon name="bookmark" size={17} /></button>
        </div>
        <div className="color-numbers">{(['r', 'g', 'b'] as const).map((k) => <label key={k}>{k.toUpperCase()}<input type="number" min={0} max={255} aria-label={`R G B ${k.toUpperCase()}`} value={hexToRgb(color)[k]} onChange={(e) => { if (e.target.value !== '' && e.target.validity.valid) changeRGB(k, +e.target.value); }} onBlur={() => palettes.remember(current.current)} /></label>)}</div>
        <details className="hsb-values"><summary>HSB 数值</summary><div className="color-numbers">{([['h', '色相', 359], ['s', '饱和度', 100], ['b', '明度', 100]] as const).map(([k, label, max]) => <label key={k}>{label}<input type="number" min={0} max={max} aria-label={label} value={hsb[k]} onChange={(e) => { if (e.target.value !== '' && e.target.validity.valid) changeHSB({ ...hsb, [k]: +e.target.value }); }} onBlur={() => palettes.remember(current.current)} /></label>)}</div></details>
      </div>
      <div className="color-library"><div className="palette-heading"><h3>灵感色板</h3><span>点选即用</span></div>
        <div className="palette-categories" role="group" aria-label="色板分类">{COLOR_PALETTES.map((p) => <button key={p.name} aria-pressed={p.name === palette} onClick={() => setPalette(p.name)}>{p.name}</button>)}</div>
        {swatches(COLOR_PALETTES.find((p) => p.name === palette)!.colors, `${palette}色板`)}
        <div className="palette-heading"><h3>我的收藏</h3><span>{palettes.favorites.length}/24</span></div>
        {palettes.favorites.length ? swatches(palettes.favorites, '收藏颜色') : <p className="palette-empty-hint">喜欢这个颜色？点击收藏，留给下一次灵感。</p>}
        <div className="palette-heading"><h3>最近使用</h3></div>
        {palettes.recent.length ? swatches(palettes.recent, '最近颜色') : <p className="palette-empty-hint">用过的颜色会留在这里。</p>}
        {palettes.error && <p className="inline-error" role="status">{palettes.error}</p>}
      </div>
    </div>
    <footer className="color-studio-footer"><span>颜色实时应用</span><button className="primary" onClick={() => { palettes.remember(current.current); onClose(); }}>完成</button></footer>
  </Modal>, document.body);
}

export function ColorControl({ value, onChange, label, disabled = false }: { value: string; onChange: (hex: string) => void; label: string; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  return <><button type="button" className="color-control" disabled={disabled} aria-label={label} title={`${label} · 打开拾色器与色板`} onClick={() => setOpen(true)}><span style={{ background: value }} /></button>
    {open && <ColorPicker color={value} onChange={onChange} title={label} onClose={() => setOpen(false)} />}</>;
}
