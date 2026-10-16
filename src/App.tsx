import { ContextMenuHost } from './components/ContextMenu';
import { useEffect } from 'react';
import { TopBar } from './components/TopBar';
import { Toolbar } from './components/Toolbar';
import { OptionsBar } from './components/OptionsBar';
import { CanvasView } from './components/CanvasView';
import { AutosaveController } from './components/Autosave';
import { StatusBar } from './components/StatusBar';
import { useStore } from './state/store';
import { useAppearance } from './state/appearance';
import { DockArea, FloatingLayer, UtilityWindow } from './components/Dock';
import { useLayout } from './state/layout';
import { DocTabs } from './components/DocTabs';
import { AppearanceController } from './components/AppearanceController';
import { AppearanceSettings, backgroundStyle } from './components/AppearanceSettings';
import { AISettings, useAISettings } from './components/AISettings';
import { comboLabel, isBrowserReserved, matchShortcut, shouldBlockBrowser, type ShortcutAction } from './shortcuts';
import { Toast } from './components/Toast';
import { CommandPalette, registerShortcutRunner } from './components/CommandPalette';
import { SiteBrowser } from './components/AssetsPanel';
import { AIStudio, AIPreviewHeader } from './components/AIStudio';
import { useNavigation } from './state/navigation';
import { CanvasTools } from './components/CanvasTools';
import { useStudioLayout } from './state/studioLayout';
import { AIControlsDocument, ManualTakeover, requestManualEdit } from './components/ManualTakeover';

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);

/** Runs a shortcut action against the store. Fill shortcuts and the Delete key are separate:
 *  Delete stays in CanvasView, which knows about in-progress pen / lasso gestures. */
function runShortcut(a: ShortcutAction) {
  const s = useStore.getState();
  if (!s.session && a !== 'open' && a !== 'paste' && a !== 'search') return;
  const arrange = (d: 'bringForward' | 'sendBackward' | 'bringToFront' | 'sendToBack') => void s.arrange(d);
  switch (a) {
    case 'undo': void s.undo(); break;
    case 'redo': void s.redo(); break;
    case 'freeTransform': s.enterTransform(); break;
    case 'layerViaCopy': void s.layerVia('copy'); break;
    case 'layerViaCut': void s.layerVia('cut'); break;
    case 'copy': case 'cut': case 'copyMerged': void s.clipboardCopy(a); break;
    case 'paste': case 'pasteInPlace': case 'pasteInto': if (s.session) void s.clipboardPaste(a); break;
    case 'selectAll': void s.selectMenu('all'); break;
    case 'deselect': void s.selectMenu('deselect'); break;
    case 'reselect': void s.selectMenu('reselect'); break;
    case 'inverse': void s.selectMenu('inverse'); break;
    case 'group': void s.groupLayers(); break;
    case 'mergeDown': void s.mergeDown(); break;
    case 'mergeVisible': void s.mergeVisible(); break;
    case 'newLayer': void s.newLayer(); break;
    case 'save': void s.save(); break;
    case 'open': (document.querySelector('.topbar input[type=file]') as HTMLInputElement | null)?.click(); break;
    case 'zoomIn': s.zoomBy(1.25); break;
    case 'zoomOut': s.zoomBy(0.8); break;
    case 'fitView': s.fitView(); break;
    case 'actualPixels': s.actualPixels(); break;
    case 'bringForward': case 'sendBackward': case 'bringToFront': case 'sendToBack': arrange(a); break;
    case 'toggleRulers': s.setShowRulers(!s.showRulers); break;
    case 'fillForeground': void s.fillSelection(s.foreground); break;
    case 'fillBackground': void s.fillSelection(s.background); break;
    case 'search': useStore.setState({ commandPaletteOpen: true }); break;
  }
}

registerShortcutRunner((a) => { if (a === 'paste') { const s = useStore.getState(); if (s.session) void s.clipboardPaste('paste'); } else runShortcut(a); });

/** Keyboard paste waiting for its `paste` event (see the keydown handler). */
let pendingPaste: number | undefined;

export function App() {
  // One capture-phase handler owns every Ctrl/Cmd combination: app shortcuts run, and the
  // browser's own meaning (save page, reload, print, history, downloads …) is suppressed.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || e.keyCode === 229 || document.querySelector('dialog[open], [data-editor-popover]')) return;
      const typing = isTyping(e.target);
      const sc = matchShortcut(e);
      // Plain paste is resolved by the `paste` event (it alone sees system-clipboard images), and
      // cancelling the keydown would suppress that event. Where no paste event follows (Ctrl+V on
      // macOS, non-editable focus in some setups), fall back to the editor clipboard.
      if (sc?.action === 'paste') {
        if (typing) return;
        clearTimeout(pendingPaste);
        pendingPaste = window.setTimeout(() => { const st = useStore.getState(); if (st.session) void st.clipboardPaste('paste'); }, 150);
        return;
      }
      if (shouldBlockBrowser(e, typing)) e.preventDefault();
      if (typing || (e.repeat && !/^(Equal|Minus)$/.test(e.code))) return;
      if (sc) {
        e.stopPropagation();
        // Visible feedback: the browser's own meaning was suppressed, say what ran instead.
        if (sc.action !== 'search' && (sc.mod || sc.alt)) useStore.getState().showToast(`${sc.label} · ${comboLabel(sc)}`);
        runShortcut(sc.action);
      } else if (isBrowserReserved(e)) {
        if (!useStore.getState().keyboardLocked) useStore.getState().showToast(`${comboLabel({ key: e.code, mod: true, shift: e.shiftKey, alt: e.altKey, action: 'undo', label: '' })} 被浏览器占用，开启工作模式后可用`, { action: 'workMode' });
      } else if ((e.metaKey || e.ctrlKey) && !typing && /^Key|^Digit/.test(e.code)) {
        useStore.getState().showToast(`${comboLabel({ key: e.code, mod: true, shift: e.shiftKey, alt: e.altKey, action: 'undo', label: '' })} 在编辑器中未使用（已阻止浏览器默认操作）`);
      }
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, []);

  // Ctrl/Cmd+V with an image on the system clipboard: paste it as a layer (the engine clipboard
  // otherwise). The paste event is the only clipboard access that needs no permission prompt.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (isTyping(e.target) || document.querySelector('dialog[open], [data-editor-popover]')) return;
      clearTimeout(pendingPaste);
      e.preventDefault();
      const item = Array.from(e.clipboardData?.items ?? []).find((i) => i.type.startsWith('image/'));
      const blob = item?.getAsFile();
      const st = useStore.getState();
      // An image copied in another app wins; otherwise paste what was copied inside the editor.
      if (blob && !st.internalClipFresh) void st.pasteExternalImage(blob);
      else if (st.session) void st.clipboardPaste('paste');
    };
    // Leaving the window may mean copying elsewhere: prefer the system clipboard next time.
    const onBlur = () => useStore.setState({ internalClipFresh: false });
    window.addEventListener('paste', onPaste);
    window.addEventListener('blur', onBlur);
    return () => { window.removeEventListener('paste', onPaste); window.removeEventListener('blur', onBlur); };
  }, []);

  // Unsaved work: confirm before the tab closes (Ctrl/Cmd+W cannot be intercepted otherwise).
  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => {
      const s = useStore.getState();
      const root = s.tabs.find((t) => t.docId === s.activeDocId && !t.parent) ?? s.tabs.find((t) => !t.parent);
      if (root && root.session.currentRevision > 0 && s.autosavedRevision !== root.session.currentRevision) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, []);

  return <Workbench />;
}

function Workbench() {
  const preferences = useAppearance((s) => s.preferences);
  const imageUrl = useAppearance((s) => s.imageUrl);
  const focus = useAppearance((s) => s.focus);
  const settings = useAppearance((s) => s.settingsOpen);
  const aiSettings = useAISettings((s) => s.open);
  const hasDoc = useStore((s) => !!s.doc);
  const toolsRight = useLayout((s) => s.layout.toolbarSide === 'right');
  const dockLeft = useLayout((s) => s.layout.dockSide === 'left');
  const mode = useNavigation((s) => s.mode);
  const preview = useNavigation((s) => s.preview);
  const agentSide = useNavigation((s) => s.agentSide);
  const agentShare = useStudioLayout((s) => s.agentShare);
  const toolWindow = useStudioLayout((s) => s.tools);
  return (
    <div style={{ '--agent-track': `${agentShare}fr`, '--canvas-track': `${100 - agentShare}fr` } as React.CSSProperties} className={`app${mode !== 'manual' ? ' ai-mode' : ' manual-mode'}${agentSide === 'right' ? ' agent-right' : ''}${preview ? ' preview-open' : ''}${focus ? ' focus-mode' : ''}${toolsRight ? ' tools-right' : ''}${dockLeft ? ' dock-left' : ''}`}>
      <AppearanceController />
      <TopBar />
      <OptionsBar />
      <Toolbar />
      <AIStudio />
      <main className={`workspace${hasDoc ? ' has-document' : ''}`} aria-label="文档编辑区"
        onPointerDownCapture={(e) => {
          if (mode === 'design' && AIControlsDocument(useStore.getState().activeDocId) && (e.target as HTMLElement).closest('.canvas-wrap')) { e.preventDefault(); e.stopPropagation(); }
        }}
        onDoubleClickCapture={(e) => {
          if (mode !== 'design' || (e.target as HTMLElement).closest('button,input,select,textarea,.canvas-tools,[data-editor-popover]')) return;
          e.preventDefault(); e.stopPropagation(); requestManualEdit();
        }}>
        {!focus && !preferences.lowOverhead && <div className="decoration workspace-decoration" aria-hidden="true" style={{ ...backgroundStyle(preferences, imageUrl), opacity: preferences.strength / 100 }} />}
        <AIPreviewHeader />
        {(mode === 'manual' || hasDoc) && <DocTabs />}
        <div className={`canvas-editing-body${mode === 'design' && !toolWindow && !focus ? ' default-canvas-tools' : ''}`}>
          <div className="stage-frame"><CanvasView /></div>
          {mode === 'design' && !focus && <CanvasTools />}
        </div>
      </main>
      {mode === 'manual' && <DockArea />}
      {mode === 'manual' && <FloatingLayer />}
      <UtilityWindow />
      <ManualTakeover />
      <StatusBar />
      <AutosaveController />
      <Toast />
      <CommandPalette />
      {settings && <AppearanceSettings />}
      {aiSettings && <AISettings />}
      <SiteBrowser />
      <ContextMenuHost />
    </div>
  );
}
