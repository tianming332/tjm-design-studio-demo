import { ColorControl } from './ColorPicker';
import { beginGesture, liveTextStyle } from '../state/live';
import { useEffect, useState } from 'react';
import { useStore } from '../state/store';
import { DEFAULT_TEXT_STYLE, styleParams, type Align, type Caps, type TextStyleUI } from '../engine/typeinfo';

const h4: React.CSSProperties = { margin: '0 0 6px', fontSize: 12, color: 'var(--text-dim)', fontWeight: 400 };
const lbl: React.CSSProperties = { color: 'var(--text-dim)', fontSize: 12 };
const row: React.CSSProperties = { display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4, ...lbl };
const grid: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, marginBottom: 6 };

const ALIGNS: [Align, string][] = [['left', '左'], ['center', '中'], ['right', '右'], ['justify', '两端']];
const CAPS: [Caps, string][] = [['normal', '常规'], ['small', '小型大写'], ['all', '全大写']];

export function TextPanel() {
  const busy = useStore((s) => s.busy);
  const selectedId = useStore((s) => s.selectedId);
  const textInfo = useStore((s) => s.textInfo);
  const fontFamilies = useStore((s) => s.fontFamilies);
  const refreshTextInfo = useStore((s) => s.refreshTextInfo);
  const applyTextStyle = useStore((s) => s.applyTextStyle);
  const setTextOrientation = useStore((s) => s.setTextOrientation);
  const loadFonts = useStore((s) => s.loadFonts);

  const [ui, setUi] = useState<TextStyleUI>(DEFAULT_TEXT_STYLE);

  // Re-read the engine's style whenever the selected layer changes.
  useEffect(() => { void refreshTextInfo(); void loadFonts(); }, [selectedId, refreshTextInfo, loadFonts]);
  useEffect(() => { if (textInfo) setUi(textInfo); }, [textInfo]);

  if (!textInfo) return null; // only meaningful for a selected type layer
  // Live: every change is applied to the layer at once (one history step per edit gesture).
  const set = <K extends keyof TextStyleUI>(k: K, v: TextStyleUI[K]) => {
    const next = { ...ui, [k]: v };
    setUi(next);
    if (selectedId != null && k !== 'orientation' && k !== 'text') liveTextStyle(selectedId, styleParams(next));
  };
  const nums: [keyof TextStyleUI, string, number, number][] = [
    ['size', '字号', 1, 400], ['leading', '行距(0=自动)', 0, 400], ['tracking', '字距', -1000, 1000],
    ['hScale', '水平缩放%', 10, 400], ['vScale', '垂直缩放%', 10, 400], ['baselineShift', '基线偏移', -200, 200],
  ];

  return (
    <div className="selection" onFocusCapture={() => beginGesture()} onPointerDownCapture={() => beginGesture()}>
      <h4 style={h4}>字符（{ui.text.slice(0, 10) || '文字层'}）</h4>
      <div style={row}>
        <span style={{ width: 52 }}>字体</span>
        <input list="tjm-fonts" value={ui.font} onChange={(e) => set('font', e.target.value)} style={{ flex: 1 }} aria-label="字体" />
        <datalist id="tjm-fonts">{fontFamilies.slice(0, 300).map((f) => <option key={f} value={f} />)}</datalist>
      </div>
      {nums.map(([k, label, min, max]) => (
        <div style={row} key={String(k)}>
          <span style={{ width: 92 }}>{label}</span>
          <input
            type="number" min={min} max={max} value={ui[k] as number}
            onChange={(e) => set(k, Number(e.target.value) as never)}
            style={{ flex: 1 }} aria-label={label}
          />
        </div>
      ))}
      <div style={row}>
        <span style={{ width: 52 }}>颜色</span>
        <ColorControl label="文字颜色" value={ui.color} onChange={(color) => set('color', color)} />
        <select value={ui.caps} onChange={(e) => set('caps', e.target.value as Caps)} style={{ flex: 1 }} aria-label="大小写">
          {CAPS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>
      <div style={{ ...row, flexWrap: 'wrap' }}>
        <label><input type="checkbox" checked={ui.fauxBold} onChange={(e) => set('fauxBold', e.target.checked)} />仿粗</label>
        <label><input type="checkbox" checked={ui.fauxItalic} onChange={(e) => set('fauxItalic', e.target.checked)} />仿斜</label>
        <label><input type="checkbox" checked={ui.underline} onChange={(e) => set('underline', e.target.checked)} />下划线</label>
        <label><input type="checkbox" checked={ui.strikethrough} onChange={(e) => set('strikethrough', e.target.checked)} />删除线</label>
      </div>

      <h4 style={h4}>段落</h4>
      <div style={grid}>
        {ALIGNS.map(([v, l]) => (
          <button key={v} onClick={() => set('align', v)} style={{ background: ui.align === v ? 'var(--accent-hi)' : undefined }}>{l}</button>
        ))}
      </div>
      <div style={row}>
        <span style={{ width: 92 }}>首行缩进</span>
        <input type="number" value={ui.firstLineIndent} onChange={(e) => set('firstLineIndent', Number(e.target.value))} style={{ flex: 1 }} aria-label="首行缩进" />
      </div>
      <div style={row}>
        <span style={{ width: 92 }}>段前/段后</span>
        <input type="number" value={ui.spaceBefore} onChange={(e) => set('spaceBefore', Number(e.target.value))} style={{ width: '45%' }} aria-label="段前间距" />
        <input type="number" value={ui.spaceAfter} onChange={(e) => set('spaceAfter', Number(e.target.value))} style={{ width: '45%' }} aria-label="段后间距" />
      </div>
      <div style={row}>
        <label><input type="checkbox" checked={ui.hyphenate} onChange={(e) => set('hyphenate', e.target.checked)} />连字</label>
      </div>
      <button onClick={() => void applyTextStyle(ui)} disabled={busy} style={{ width: '100%', marginBottom: 8 }} title="修改已实时生效；此按钮把全部样式再完整写入一次">重新应用全部样式</button>

      <h4 style={h4}>排版方向（当前 {ui.orientation === 'vertical' ? '直排' : '横排'}）</h4>
      <div style={grid}>
        <button onClick={() => void setTextOrientation('horizontal')} disabled={busy}>横排</button>
        <button onClick={() => void setTextOrientation('vertical')} disabled={busy}>直排</button>
      </div>
    </div>
  );
}
