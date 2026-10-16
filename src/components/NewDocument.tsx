import { useState } from 'react';
import { useStore, type NewDocOpts } from '../state/store';
import { Modal } from './Modal';
import { Icon } from './Icon';

const MODES: [NonNullable<NewDocOpts['mode']>, string][] = [['rgb', 'RGB 颜色'], ['grayscale', '灰度'], ['cmyk', 'CMYK 颜色'], ['lab', 'Lab 颜色']];
const BACKGROUNDS: [NonNullable<NewDocOpts['background']>, string][] = [['white', '白色'], ['black', '黑色'], ['backgroundColor', '背景色'], ['transparent', '透明']];
/** Engine built-in profile ids with their usual names. */
export const PROFILES: [string, string][] = [
  ['', '工作空间默认'], ['srgb', 'sRGB IEC61966-2.1'], ['display-p3', 'Display P3'], ['adobe-rgb-compat', 'Adobe RGB (1998) 兼容'],
  ['prophoto-compat', 'ProPhoto RGB 兼容'], ['rec2020', 'Rec. 2020'], ['linear-srgb', '线性 sRGB'],
  ['gray-gamma-2.2', '灰度 Gamma 2.2'], ['sgray', 'sGray'], ['coated-cmyk', '涂布 CMYK'], ['lab-d50', 'Lab D50'],
];

export function NewDocument({ onClose }: { onClose: () => void }) {
  const [width, setWidth] = useState('1080');
  const [height, setHeight] = useState('1080');
  const [resolution, setResolution] = useState('72');
  const [mode, setMode] = useState<NonNullable<NewDocOpts['mode']>>('rgb');
  const [depth, setDepth] = useState<8 | 16 | 32>(8);
  const [background, setBackground] = useState<NonNullable<NewDocOpts['background']>>('white');
  const [profile, setProfile] = useState('');
  const [name, setName] = useState('');
  const busy = useStore((s) => s.busy);
  const error = useStore((s) => s.error);
  const valid = /^\d+$/.test(width) && /^\d+$/.test(height) && +width >= 1 && +height >= 1 && +width <= 8192 && +height <= 8192 && +width * +height <= 24_000_000
    && /^\d+(\.\d+)?$/.test(resolution) && +resolution >= 1 && +resolution <= 30000;
  const create = async () => {
    await useStore.getState().newDocument(+width, +height, { resolution: +resolution, mode, depth, background, profile: profile || undefined, name: name || undefined });
    if (!useStore.getState().error) onClose();
  };
  return (
    <Modal title="新建文档" onClose={onClose} dismissDisabled={busy}>
      <div className="modal-body">
        <p className="muted">新文档会在新的标签页打开，不会替换当前文档。</p>
        <div className="size-presets">
          {([['方形', 1080, 1080, 72], ['横版', 1920, 1080, 72], ['竖版', 1080, 1920, 72], ['A4 印刷', 2480, 3508, 300]] as const).map(([label, w, h, r]) => (
            <button key={label} aria-pressed={+width === w && +height === h && +resolution === r} onClick={() => { setWidth(String(w)); setHeight(String(h)); setResolution(String(r)); }}>
              <span className="ratio-outline" style={{ width: w > h ? 32 : 23, height: h > w ? 32 : 23 }} /><strong>{label}</strong><small>{w} × {h}{r !== 72 ? ` · ${r} ppi` : ''}</small>
            </button>
          ))}
        </div>
        <div className="field-grid">
          <label>名称<input aria-label="新文档名称" placeholder="未命名" value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label>分辨率（ppi）<input aria-label="新文档分辨率" type="number" min="1" max="30000" value={resolution} onChange={(e) => setResolution(e.target.value)} /></label>
          <label>宽度（px）<input aria-label="新文档宽度" type="number" min="1" max="8192" value={width} onChange={(e) => setWidth(e.target.value)} /></label>
          <label>高度（px）<input aria-label="新文档高度" type="number" min="1" max="8192" value={height} onChange={(e) => setHeight(e.target.value)} /></label>
          <label>颜色模式<select aria-label="新文档颜色模式" value={mode} onChange={(e) => setMode(e.target.value as never)}>{MODES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          <label>位深<select aria-label="新文档位深" value={depth} onChange={(e) => setDepth(+e.target.value as 8 | 16 | 32)}><option value={8}>8 位/通道</option><option value={16}>16 位/通道</option><option value={32}>32 位/通道</option></select></label>
          <label>背景内容<select aria-label="新文档背景内容" value={background} onChange={(e) => setBackground(e.target.value as never)}>{BACKGROUNDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          <label>颜色配置文件<select aria-label="新文档颜色配置文件" value={profile} onChange={(e) => setProfile(e.target.value)}>{PROFILES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        </div>
        <p className="muted">{+width && +resolution ? `打印尺寸约 ${(+width / +resolution * 2.54).toFixed(1)} × ${(+height / +resolution * 2.54).toFixed(1)} cm` : ''}</p>
        {!valid && <p role="alert" className="inline-error">宽高为 1–8192 的整数（总像素不超过 2400 万），分辨率 1–30000。</p>}
        {error && <p role="alert" className="inline-error">{error}</p>}
      </div>
      <footer className="modal-footer"><button onClick={onClose}>取消</button><button className="primary" disabled={busy || !valid} onClick={() => void create()}><Icon name="plus" size={16} />{busy ? '正在创建…' : '创建文档'}</button></footer>
    </Modal>
  );
}
