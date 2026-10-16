import { useStore } from '../state/store';
import { Icon } from './Icon';

type KB = { lock?: (keys?: string[]) => Promise<void>; unlock?: () => void };
const keyboard = () => (navigator as Navigator & { keyboard?: KB }).keyboard;
export const workModeSupported = () => !!keyboard()?.lock;

/**
 * Work mode = fullscreen + Keyboard Lock. Chrome only hands Ctrl/⌘+T, W, N and Tab to a page
 * that holds a keyboard lock in fullscreen. Must run from a user gesture (click / key press).
 */
export async function setWorkMode(on: boolean): Promise<void> {
  const st = useStore.getState();
  const kb = keyboard();
  try {
    if (on) {
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
      await kb?.lock?.();
      st.setKeyboardLocked(true);
      st.showToast('已进入工作模式：Ctrl/⌘+T、W、N 等快捷键由编辑器接管 · 长按 Esc 退出');
      const onExit = () => {
        if (!document.fullscreenElement) {
          kb?.unlock?.();
          useStore.getState().setKeyboardLocked(false);
          document.removeEventListener('fullscreenchange', onExit);
        }
      };
      document.addEventListener('fullscreenchange', onExit);
    } else {
      kb?.unlock?.();
      if (document.fullscreenElement) await document.exitFullscreen();
      st.setKeyboardLocked(false);
    }
  } catch (e) {
    useStore.setState({ error: `无法进入工作模式：${String(e)}` });
  }
}

/** Always-visible top-bar toggle: shows whether browser shortcuts belong to the editor. */
export function WorkModeButton() {
  const locked = useStore((s) => s.keyboardLocked);
  const ok = workModeSupported();
  return (
    <button
      className={`quiet-button workmode-toggle${locked ? ' on' : ''}`}
      aria-pressed={locked} disabled={!ok}
      onClick={() => void setWorkMode(!locked)}
      title={ok ? (locked ? '工作模式已开启：浏览器快捷键交给编辑器（点击或长按 Esc 退出）' : '开启工作模式：全屏并让 Ctrl/⌘+T、W、N 等快捷键交给编辑器') : '当前浏览器不支持键盘锁定（需 Chrome）'}
    >
      <Icon name="keyboard" size={16} /><span>{locked ? '工作模式中' : '工作模式'}</span>
    </button>
  );
}
