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

// Local edition: the AI backend runs in this page with the user's own keys (no server).
installLocalBackend();

// Dev-only handle for the smoke harness (same pattern as the PoC bridge's `window.__bridge`).
if (import.meta.env.DEV) Object.assign(window, { __tjm: useStore, __tjmAgent: useAgent, __tjmAssets: useAssets, __tjmWb: useWb, __tjmAppearance: useAppearance });

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
