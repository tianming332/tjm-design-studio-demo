import { useState } from 'react';
import { useStore } from '../state/store';
import { Popover } from './Popover';
import { Modal } from './Modal';
import { Icon } from './Icon';
import { PROFILES } from './NewDocument';

const MODES: ['rgb' | 'grayscale' | 'cmyk' | 'lab', string][] = [['rgb', 'RGB 颜色'], ['grayscale', '灰度'], ['cmyk', 'CMYK 颜色'], ['lab', 'Lab 颜色']];
const DEPTHS: ['bits8' | 'bits16' | 'bits32', string][] = [['bits8', '8 位/通道'], ['bits16', '16 位/通道'], ['bits32', '32 位/通道']];
const MODE_KEY: Record<string, string> = { Rgb: 'rgb', Grayscale: 'grayscale', Gray: 'grayscale', Cmyk: 'cmyk', Lab: 'lab' };

/** Top-bar "图像" menu: colour mode, bit depth, colour profile, resolution (Image menu in PS). */
export function ImageMenu() {
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState<null | 'assign' | 'convert' | 'resolution'>(null);
  const hasDoc = useStore((s) => !!s.session);
  const busy = useStore((s) => s.busy);
  const info = useStore((s) => s.docInfo);
  const refresh = useStore((s) => s.refreshDocInfo);
  const cur = MODE_KEY[info?.mode ?? ''] ?? 'rgb';
  return (
    <div className="export-anchor">
      <button className="quiet-button" aria-expanded={open} disabled={!hasDoc} onClick={() => { if (!open) void refresh(); setOpen(!open); }}>图像<Icon name="chevron" size={12} /></button>
      {open && (
        <Popover label="图像菜单" className="file-menu" onClose={() => setOpen(false)}>
          <div className="popover-heading">模式</div>
          {MODES.map(([k, l]) => (
            <button key={k} className="menu-item" role="menuitemradio" aria-checked={cur === k} disabled={busy}
              onClick={() => { setOpen(false); void useStore.getState().imageMode(k); }}>
              <span>{cur === k ? '✓ ' : ''}{l}</span>
            </button>
          ))}
          <hr />
          {DEPTHS.map(([k, l]) => (
            <button key={k} className="menu-item" role="menuitemradio" aria-checked={info?.depth === +k.slice(4)} disabled={busy}
              onClick={() => { setOpen(false); void useStore.getState().imageMode(k); }}>
              <span>{info?.depth === +k.slice(4) ? '✓ ' : ''}{l}</span>
            </button>
          ))}
          <hr />
          <button className="menu-item" disabled={busy} onClick={() => { setOpen(false); setDialog('resolution'); }}><span>图像大小 / 分辨率…</span></button>
          <button className="menu-item" disabled={busy} onClick={() => { setOpen(false); setDialog('assign'); }}><span>指定配置文件…</span></button>
          <button className="menu-item" disabled={busy} onClick={() => { setOpen(false); setDialog('convert'); }}><span>转换为配置文件…</span></button>
          {info?.profile && <div className="popover-heading" title={info.profile}>当前：{info.profile}</div>}
        </Popover>
      )}
      {(dialog === 'assign' || dialog === 'convert') && <ProfileDialog kind={dialog} onClose={() => setDialog(null)} />}
      {dialog === 'resolution' && <ResolutionDialog onClose={() => setDialog(null)} />}
    </div>
  );
}

function ProfileDialog({ kind, onClose }: { kind: 'assign' | 'convert'; onClose: () => void }) {
  const [profile, setProfile] = useState('srgb');
  const busy = useStore((s) => s.busy);
  return (
    <Modal title={kind === 'assign' ? '指定配置文件' : '转换为配置文件'} onClose={onClose} dismissDisabled={busy}>
      <div className="modal-body">
        <p className="muted">{kind === 'assign' ? '只改变像素的解释方式（颜色外观会变），不改像素数值。' : '把颜色换算到目标配置文件，尽量保持外观不变（像素数值会变）。'}</p>
        <label>配置文件<select aria-label="配置文件" value={profile} onChange={(e) => setProfile(e.target.value)}>
          {PROFILES.filter(([k]) => k).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select></label>
      </div>
      <footer className="modal-footer"><button onClick={onClose}>取消</button>
        <button className="primary" disabled={busy} onClick={async () => { await useStore.getState().imageProfile(kind, profile); if (!useStore.getState().error) onClose(); }}>确定</button>
      </footer>
    </Modal>
  );
}

function ResolutionDialog({ onClose }: { onClose: () => void }) {
  const doc = useStore((s) => s.doc);
  const busy = useStore((s) => s.busy);
  const [ppi, setPpi] = useState(String(doc?.resolution ?? 72));
  const [resample, setResample] = useState(false);
  const k = +ppi / (doc?.resolution ?? 72);
  return (
    <Modal title="图像大小 / 分辨率" onClose={onClose} dismissDisabled={busy}>
      <div className="modal-body">
        <label>分辨率（ppi）<input aria-label="分辨率" type="number" min="1" max="30000" value={ppi} onChange={(e) => setPpi(e.target.value)} /></label>
        <label className="replace-warning"><input type="checkbox" checked={resample} aria-label="重新采样" onChange={(e) => setResample(e.target.checked)} />重新采样（改变像素尺寸；不勾选则只改打印尺寸）</label>
        {doc && <p className="muted">像素尺寸：{resample ? `${Math.round(doc.width * k)} × ${Math.round(doc.height * k)}` : `${doc.width} × ${doc.height}`} px；
          打印尺寸：{((resample ? doc.width * k : doc.width) / +ppi * 2.54).toFixed(2)} × {((resample ? doc.height * k : doc.height) / +ppi * 2.54).toFixed(2)} cm</p>}
      </div>
      <footer className="modal-footer"><button onClick={onClose}>取消</button>
        <button className="primary" disabled={busy || !(+ppi >= 1)} onClick={async () => { await useStore.getState().setResolution(+ppi, resample); if (!useStore.getState().error) onClose(); }}>确定</button>
      </footer>
    </Modal>
  );
}
