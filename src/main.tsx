import React from 'react';
import { installLocalBackend } from './local/server.js';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { useStore } from './state/store';
import { useAgent } from './state/agent';
import { useAssets } from './state/assets';
import { useWb } from './state/workbench';
import { useAppearance } from './state/appearance';
import './styles.css';
import './studio.css';
import './input-studio.css';
import './motion.css';
import './touch.css';
import { installTouch, useTouch } from './state/touch';
import { useLayout } from './state/layout';

// Local edition: the AI backend runs in this page with the user's own keys (no server).
installLocalBackend();

// Touch devices: guards against page gestures, fullscreen on first touch, and on the very first
// visit the matching 手机 / iPad layout (afterwards the user's 窗口 › 面板布局 choice wins).
installTouch(() => useStore.getState().showToast('iPhone 无法网页全屏：用 Safari「分享 › 添加到主屏幕」打开即为全屏'));
try {
  const detected = useTouch.getState().detected;
  if (detected !== 'desktop' && !localStorage.getItem('tjm.touch.layout-applied')) {
    useLayout.getState().switchTo(detected === 'phone' ? '手机布局' : 'iPad 布局');
    localStorage.setItem('tjm.touch.layout-applied', '1');
  }
} catch { /* storage blocked: keep the current layout */ }

// Dev-only handle for the smoke harness (same pattern as the PoC bridge's `window.__bridge`).
if (import.meta.env.DEV) Object.assign(window, { __tjmTouch: useTouch, __tjm: useStore, __tjmAgent: useAgent, __tjmAssets: useAssets, __tjmWb: useWb, __tjmAppearance: useAppearance });

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
