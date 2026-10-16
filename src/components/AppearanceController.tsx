import { useEffect } from 'react';
import { backgroundAsset } from '../appearance/background';
import { resolveTheme, useAppearance } from '../state/appearance';

export function AppearanceController() {
  const theme = useAppearance((s) => s.preferences.theme);
  const reduced = useAppearance((s) => s.preferences.reducedMotion);
  const low = useAppearance((s) => s.preferences.lowOverhead);
  const background = useAppearance((s) => s.preferences.background);
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const resolved = resolveTheme(theme, media.matches);
      document.documentElement.dataset.theme = resolved;
      useAppearance.setState({ resolvedTheme: resolved });
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme]);
  useEffect(() => {
    document.documentElement.dataset.reducedMotion = String(reduced || low);
    document.documentElement.dataset.lowOverhead = String(low);
  }, [reduced, low]);
  useEffect(() => {
    let disposed = false;
    if (background === 'image' && useAppearance.getState().preferences.imageName && !useAppearance.getState().imageUrl) {
      void backgroundAsset('read').then(async (blob) => {
        if (disposed || useAppearance.getState().preferences.background !== 'image') return;
        if (!blob) throw new Error('保存的背景图片不存在，请重新选择。');
        const old = useAppearance.getState().imageUrl;
        if (old) return; // A newer upload already won.
        const url = URL.createObjectURL(blob);
        try {
          const image = new Image();
          image.src = url;
          await image.decode();
          if (disposed || useAppearance.getState().preferences.background !== 'image' || useAppearance.getState().imageUrl) {
            URL.revokeObjectURL(url);
          } else {
            useAppearance.setState({ imageUrl: url });
          }
        } catch (e) { URL.revokeObjectURL(url); throw e; }
      }).catch(() => {
        if (!disposed) useAppearance.setState({ error: '工作台背景加载失败，已回退到主题底色。请在外观设置中重新选择图片。' });
      });
    }
    return () => { disposed = true; };
  }, [background]);
  return null;
}
