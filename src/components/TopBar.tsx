import { useRef, useState } from 'react';
import { useStore } from '../state/store';
import { useAppearance } from '../state/appearance';
import { Icon } from './Icon';
import { Popover } from './Popover';
import { NewDocument } from './NewDocument';
import { ImageMenu } from './ImageMenu';
import { WorkModeButton } from './WorkMode';
import { WindowMenu } from './Dock';
import { CreationBar } from './CreationBar';

export function TopBar() {
  const fileRef = useRef<HTMLInputElement>(null);
  const fileTrigger = useRef<HTMLButtonElement>(null);
  const hasDoc = useStore((s) => !!s.session);
  const busy = useStore((s) => s.busy);
  const fileName = useStore((s) => s.fileName);
  const depth = useStore((s) => s.historyDepth);
  const focus = useAppearance((s) => s.focus);
  const drawer = useAppearance((s) => s.drawerOpen);
  const [menu, setMenu] = useState<'file' | 'export' | null>(null);
  const creating = useStore((s) => s.newDocOpen);
  const setCreating = (on: boolean) => useStore.setState({ newDocOpen: on });
  return (
    <header className="topbar">
      <div className="brand" aria-label="TJM 图形设计工作台"><span className="brand-mark">t<span>j</span>m</span></div>
      <input ref={fileRef} type="file" accept=".psd,.psb,.pcraft,.jpg,.jpeg,.png,.webp,.gif,.bmp,.tif,.tiff" multiple hidden onChange={(e) => { const files = Array.from(e.target.files ?? []); e.target.value = ''; void (async () => { for (const f of files) await useStore.getState().openFile(f); })(); }} />
      <div className="top-group file-group">
        <button ref={fileTrigger} className="quiet-button" aria-expanded={menu === 'file'} onClick={() => setMenu(menu === 'file' ? null : 'file')}>文件<Icon name="chevron" size={12} /></button>
        <button className="quiet-button open-button" onClick={() => fileRef.current?.click()} disabled={busy}><Icon name="folder" size={16} />打开</button>
        <ImageMenu />
        <WindowMenu />
      </div>
      <span className="divider" />
      <div className="top-group history-actions">
        <button className="icon-button" onClick={() => void useStore.getState().undo()} disabled={!hasDoc || busy || !depth.canUndo} aria-label="撤销" title={depth.canUndo ? '撤销（Ctrl/⌘+Z）' : '没有可撤销的操作'}><Icon name="undo" size={17} /></button>
        <button className="icon-button" onClick={() => void useStore.getState().redo()} disabled={!hasDoc || busy || !depth.canRedo} aria-label="重做" title={depth.canRedo ? '重做（Ctrl/⌘+Shift+Z）' : '没有可重做的操作'}><Icon name="redo" size={17} /></button>
      </div>
      <div className="document-identity" title={fileName ?? '尚未打开文档'}>{fileName ?? '未打开文档'}</div>
      <CreationBar />
      <button className="quiet-button search-button" onClick={() => useStore.setState({ commandPaletteOpen: true })} title="搜索功能（Ctrl/⌘+F）" aria-label="搜索功能"><Icon name="search" size={16} /></button>
      <WorkModeButton />
      <span className="divider optional-divider" />
      <button className="quiet-button save-button" onClick={() => void useStore.getState().save()} disabled={!hasDoc || busy} title={!hasDoc ? '先打开或新建文档' : '下载 PSD 文件（Ctrl/⌘+S）'}><Icon name="save" size={16} /><span>保存</span></button>
      <div className="export-anchor">
        <button className="primary export-button" onClick={() => setMenu(menu === 'export' ? null : 'export')} disabled={!hasDoc || busy} aria-expanded={menu === 'export'}><Icon name="download" size={16} /><span>导出</span><Icon name="chevron" size={12} /></button>
        {menu === 'export' && <Popover label="导出文档" onClose={() => setMenu(null)} className="export-menu">
          <div className="popover-heading">导出文档</div>
          {([['png', 'PNG', '透明背景'], ['jpeg', 'JPEG', '压缩图片'], ['psd', 'PSD', '保留图层'], ['pcraft', '工程文件', '.pcraft']] as const).map(([format, label, hint]) => <button key={format} className="menu-item" disabled={busy} onClick={() => { setMenu(null); void useStore.getState().exportAs(format); }}><span>{label}</span><small>{hint}</small></button>)}
        </Popover>}
      </div>
      <button className="icon-button focus-toggle" aria-label={focus ? '退出专注编辑' : '专注编辑'} aria-pressed={focus} title={focus ? '退出专注编辑' : '专注编辑：隐藏面板和背景'} onClick={() => useAppearance.setState({ focus: !focus, drawerOpen: false })}><Icon name="focus" /></button>
      <button className="icon-button panel-toggle" aria-label="属性与图层面板" aria-expanded={drawer} title="属性与图层面板" onClick={() => useAppearance.setState({ drawerOpen: !drawer })}><Icon name="panel" /></button>
      <button className="icon-button" aria-label="设置" title="设置 · 外观" onClick={() => useAppearance.setState({ settingsOpen: true })}><Icon name="settings" /></button>
      {menu === 'file' && <Popover label="文件操作" className="file-menu" style={{
        position: 'fixed', left: Math.max(8, Math.min(fileTrigger.current?.getBoundingClientRect().left ?? 8, window.innerWidth - 270)),
        top: (fileTrigger.current?.getBoundingClientRect().bottom ?? 52) + 5, right: 'auto',
      }} onClose={() => setMenu(null)}>
        <button className="menu-item" disabled={busy} onClick={() => { setMenu(null); setCreating(true); }}><Icon name="plus" /><span>新建文档</span></button>
        <button className="menu-item" disabled={busy} onClick={() => { setMenu(null); fileRef.current?.click(); }}><Icon name="folder" /><span>打开文件</span><kbd>⌘ / Ctrl O</kbd></button>
        <button className="menu-item compact-save" disabled={!hasDoc || busy} onClick={() => { setMenu(null); void useStore.getState().save(); }}><Icon name="save" /><span>保存</span></button>
        <button className="menu-item" disabled={!hasDoc || busy} onClick={() => { setMenu(null); void useStore.getState().exportAs('pcraft'); }}><Icon name="save" /><span>存为工程</span><small>.pcraft</small></button>
      </Popover>}
      {creating && <NewDocument onClose={() => setCreating(false)} />}
    </header>
  );
}
