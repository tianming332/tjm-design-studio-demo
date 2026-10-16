import { ColorControl } from './ColorPicker';
import { useEffect, useRef, useState } from 'react';
import { backgroundAsset, prepareBackground } from '../appearance/background';
import { DEFAULT_APPEARANCE, useAppearance, type BackgroundKind, type ThemeMode } from '../state/appearance';
import { Modal } from './Modal';
import { Icon } from './Icon';

export function backgroundStyle(p: typeof DEFAULT_APPEARANCE, imageUrl?: string): React.CSSProperties {
  if (p.background === 'color') return { backgroundColor: p.color };
  if (p.background === 'gradient') return { backgroundImage: `linear-gradient(135deg, ${p.color}, ${p.colorEnd})` };
  if (p.background === 'image' && imageUrl) return { backgroundImage: `url("${imageUrl}")`, backgroundSize: 'cover', backgroundPosition: p.position };
  return {};
}

export function AppearanceSettings() {
  const preferences = useAppearance((s) => s.preferences);
  const imageUrl = useAppearance((s) => s.imageUrl);
  const error = useAppearance((s) => s.error);
  const update = useAppearance((s) => s.update);
  const [loading, setLoading] = useState(false);
  const [thumbnail, setThumbnail] = useState<string>();
  useEffect(() => {
    setThumbnail(undefined);
    if (!imageUrl || preferences.background !== 'image') return;
    let disposed = false;
    let url: string | undefined;
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      const scale = Math.min(1, 256 / Math.max(image.naturalWidth, image.naturalHeight));
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => {
        if (!blob || disposed) return;
        url = URL.createObjectURL(blob);
        setThumbnail(url);
      }, 'image/webp', 0.8);
    };
    image.src = imageUrl;
    return () => { disposed = true; image.onload = null; image.src = ''; if (url) URL.revokeObjectURL(url); };
  }, [imageUrl, preferences.background]);
  const ref = useRef<HTMLInputElement>(null);
  const close = () => useAppearance.setState({ settingsOpen: false });
  const upload = async (file: File) => {
    setLoading(true);
    useAppearance.setState({ error: undefined });
    try {
      const blob = await prepareBackground(file);
      const previous = await backgroundAsset('read');
      await backgroundAsset('write', blob);
      if (update({ background: 'image', imageName: file.name })) {
        const old = useAppearance.getState().imageUrl;
        useAppearance.setState({ imageUrl: URL.createObjectURL(blob) });
        if (old) URL.revokeObjectURL(old);
      } else {
        if (previous) await backgroundAsset('write', previous);
        else await backgroundAsset('delete');
      }
    } catch (e) {
      useAppearance.setState({ error: e instanceof Error ? e.message : '无法保存背景图片，请重试。' });
    } finally { setLoading(false); }
  };
  const remove = async (reset = false) => {
    setLoading(true);
    try {
      const previous = await backgroundAsset('read');
      await backgroundAsset('delete');
      if (update(reset ? { ...DEFAULT_APPEARANCE, theme: preferences.theme } : { background: 'default', imageName: '' })) {
        if (imageUrl) URL.revokeObjectURL(imageUrl);
        useAppearance.setState({ imageUrl: undefined });
      } else if (previous) {
        await backgroundAsset('write', previous);
      }
    } catch { useAppearance.setState({ error: '无法移除本地背景，请检查存储权限后重试。' }); }
    finally { setLoading(false); }
  };
  return (
    <Modal title="设置 · 外观" onClose={close} className="appearance-modal" dismissDisabled={loading}>
      <div className="modal-body">
        <section className="settings-section">
          <h3>界面外观</h3><p className="muted">只改变工作台，不改变图片的颜色。</p>
          <div className="theme-choices" role="group" aria-label="界面外观">
            {([['system', '跟随系统', 'monitor'], ['light', '浅色', 'sun'], ['dark', '深色', 'moon']] as const).map(([mode, label, icon]) => (
              <button key={mode} className={preferences.theme === mode ? 'selected' : ''} aria-pressed={preferences.theme === mode} onClick={() => update({ theme: mode as ThemeMode })}>
                <Icon name={icon} size={20} /><span>{label}</span>{preferences.theme === mode && <Icon name="check" size={14} />}
              </button>
            ))}
          </div>
        </section>
        <section className="settings-section">
          <div className="section-title"><h3>工作台背景</h3><span className="subtle-badge">仅本地</span></div>
          <p className="muted">显示于空文档区域和外侧留白，不进入图层、历史或导出。</p>
          <div className="segmented" role="group" aria-label="背景来源">
            {([['default', '默认'], ['color', '纯色'], ['gradient', '渐变'], ['image', '本地图片']] as const).map(([kind, name]) => (
              <button key={kind} disabled={loading} aria-pressed={preferences.background === kind} onClick={() => update({ background: kind as BackgroundKind })}>{name}</button>
            ))}
          </div>
          <div className="background-preview">
            <div className="decoration" style={{ ...backgroundStyle(preferences, thumbnail), opacity: preferences.strength / 100 }} />
            <div className="preview-window"><div /><span /><aside /></div>
          </div>
          {(preferences.background === 'color' || preferences.background === 'gradient') && <div className="settings-row">
            <label>背景色 <ColorControl label="工作台背景色" value={preferences.color} onChange={(color) => update({ color })} /></label>
            {preferences.background === 'gradient' && <label>结束色 <ColorControl label="渐变结束色" value={preferences.colorEnd} onChange={(colorEnd) => update({ colorEnd })} /></label>}
          </div>}
          {preferences.background === 'image' && <>
            <input ref={ref} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => { const file = e.target.files?.[0]; if (file) void upload(file); e.target.value = ''; }} />
            <div className="settings-row"><button disabled={loading} onClick={() => ref.current?.click()}><Icon name="image" size={16} />{loading ? '正在准备背景…' : '选择本地图片'}</button><span className="file-label" title={preferences.imageName}>{preferences.imageName || '尚未选择'}</span></div>
            <p className="muted">静态 PNG / JPEG / WebP · ≤ 10 MB · ≤ 2400 万像素</p>
            <label className="settings-row">裁切位置<select aria-label="背景裁切位置" value={preferences.position} onChange={(e) => update({ position: e.target.value })}><option value="center">居中</option><option value="top">顶部</option><option value="bottom">底部</option></select></label>
          </>}
          {preferences.background !== 'default' && <label className="settings-row">显示强度<input aria-label="背景显示强度" type="range" min="0" max="100" value={preferences.strength} onChange={(e) => update({ strength: Number(e.target.value) })} /><span className="numeric">{preferences.strength}%</span></label>}
          <div className="settings-row"><button disabled={loading} onClick={() => void remove()}>移除背景</button><button className="text-button" disabled={loading} onClick={() => void remove(true)}>恢复默认</button></div>
        </section>
        <section className="settings-section">
          <label className="toggle-row"><span><strong>减少动态效果</strong><small>状态即时切换，保留操作反馈</small></span><input type="checkbox" checked={preferences.reducedMotion} onChange={(e) => update({ reducedMotion: e.target.checked })} /></label>
          <label className="toggle-row"><span><strong>自动进入工作模式</strong><small>点击画布时全屏并锁定键盘，Ctrl/⌘+T、W、N 交给编辑器</small></span><input type="checkbox" aria-label="自动进入工作模式" checked={preferences.autoWorkMode} onChange={(e) => update({ autoWorkMode: e.target.checked })} /></label>
          <label className="toggle-row"><span><strong>低开销模式</strong><small>隐藏装饰背景、Design Agent 星空特效和可选过渡，保留背景设置</small></span><input type="checkbox" checked={preferences.lowOverhead} onChange={(e) => update({ lowOverhead: e.target.checked })} /></label>
        </section>
        {error && <p role="alert" className="inline-error">{error}</p>}
      </div>
      <footer className="modal-footer"><span className="muted">{loading ? '正在准备本地资源，请稍候' : '外观偏好保存在此浏览器'}</span><button className="primary" disabled={loading} onClick={close}>完成</button></footer>
    </Modal>
  );
}
