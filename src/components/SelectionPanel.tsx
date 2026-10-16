import { ColorControl } from './ColorPicker';
import { useState } from 'react';
import { useStore } from '../state/store';
import { SHORTCUTS, comboLabel, type ShortcutAction } from '../shortcuts';
import { Icon } from './Icon';
import { ValueSlider } from './ValueSlider';

const tip = (a: ShortcutAction, name: string) => {
  const s = SHORTCUTS.find((x) => x.action === a);
  return s ? `${name}（${comboLabel(s)}）` : name;
};

const h4: React.CSSProperties = { margin: '0 0 6px', fontSize: 12, color: 'var(--text-dim)', fontWeight: 400 };
const grid: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 3, marginBottom: 4 };

const MODIFY: [string, string][] = [
  ['expand', '扩展'], ['contract', '收缩'], ['feather', '羽化'], ['smooth', '平滑'], ['border', '边界'],
];

export function SelectionPanel() {
  const selection = useStore((s) => s.selection);
  const hasDoc = useStore((s) => !!s.session);
  const busy = useStore((s) => s.busy);
  const activeTool = useStore((s) => s.activeTool);
  const wandTolerance = useStore((s) => s.wandTolerance);
  const setWandTolerance = useStore((s) => s.setWandTolerance);
  const selectMenu = useStore((s) => s.selectMenu);
  const selectModify = useStore((s) => s.selectModify);
  const fillSelection = useStore((s) => s.fillSelection);
  const clearPixels = useStore((s) => s.clearPixels);
  const cropToSelection = useStore((s) => s.cropToSelection);
  const selectionToMask = useStore((s) => s.selectionToMask);
  const contentAwareFill = useStore((s) => s.contentAwareFill);
  const saveSelection = useStore((s) => s.saveSelection);
  const loadSelection = useStore((s) => s.loadSelection);
  const strokeSelection = useStore((s) => s.strokeSelection);
  const clipboardCopy = useStore((s) => s.clipboardCopy);
  const clipboardPaste = useStore((s) => s.clipboardPaste);
  const layerVia = useStore((s) => s.layerVia);

  const [radius, setRadius] = useState(4);
  const [color, setColor] = useState('#ff0000');
  const has = !!selection;
  const off = !hasDoc || busy;

  return (
    <div className="selection compact-selection">
      <h4 style={h4}>{selection ? `选区 · ${selection.width} × ${selection.height} px` : '创建选区'}</h4>
      {!has && <div className="selection-guide" title="先选择范围，再进行复制、填充或局部调整"><div className="selection-tools">
        <button disabled={off} onClick={() => useStore.getState().setTool('marqueeRect')}><Icon name="marqueeRect" size={14} />矩形选框</button>
        <button disabled={off} onClick={() => useStore.getState().setTool('lasso')}><Icon name="lasso" size={14} />套索</button>
        <button disabled={off} onClick={() => void selectMenu('all')}>选择全部</button>
      </div></div>}

      <details className="selection-group" open><summary>复制与粘贴</summary>
      <div className="edit-clip" role="group" aria-label="编辑" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 3, marginBottom: 4 }}>
        <button onClick={() => void clipboardCopy('copy')} disabled={off || !has} title={tip('copy', '拷贝')}>拷贝</button>
        <button onClick={() => void clipboardCopy('cut')} disabled={off || !has} title={tip('cut', '剪切')}>剪切</button>
        <button onClick={() => void clipboardCopy('copyMerged')} disabled={off} title={tip('copyMerged', '合并拷贝')}>合并拷贝</button>
        <button onClick={() => void clipboardPaste('paste')} disabled={off} title={tip('paste', '粘贴')}>粘贴</button>
        <button onClick={() => void clipboardPaste('pasteInPlace')} disabled={off} title={tip('pasteInPlace', '原位粘贴')}>原位粘贴</button>
        <button onClick={() => void clipboardPaste('pasteInto')} disabled={off || !has} title={tip('pasteInto', '贴入（结果带选区蒙版）')}>贴入</button>
        <button onClick={() => void layerVia('copy')} disabled={off} title={tip('layerViaCopy', '通过拷贝的图层')}>拷贝成层</button>
        <button onClick={() => void layerVia('cut')} disabled={off || !has} title={tip('layerViaCut', '通过剪切的图层')}>剪切成层</button>
      </div>
      </details>

      {activeTool === 'wand' && <ValueSlider label="魔棒容差" min={0} max={255} value={wandTolerance} disabled={off} onChange={setWandTolerance} />}

      <details className="selection-group" open><summary>调整选区</summary>
      <div style={grid}>
        <button onClick={() => void selectMenu('all')} disabled={off}>全选</button>
        <button onClick={() => void selectMenu('deselect')} disabled={off || !has}>取消</button>
        <button onClick={() => void selectMenu('inverse')} disabled={off || !has}>反选</button>
        <button onClick={() => void selectMenu('reselect')} disabled={off}>重选</button>
        <button onClick={() => void selectMenu('grow')} disabled={off || !has}>扩大</button>
        <button onClick={() => void selectMenu('similar')} disabled={off || !has}>相似</button>
      </div>

      <label className="selection-radius">修改半径<input
        type="number" min={1} max={500} value={radius}
        aria-label="修改半径"
        onChange={(e) => setRadius(Number(e.target.value))}
        disabled={off}
        style={{ width: 52 }}
      /><span>px</span></label>
      <div style={grid}>
        {MODIFY.map(([k, label]) => (
          <button key={k} onClick={() => void selectModify(k as never, radius)} disabled={off || !has}>{label}</button>
        ))}
      </div>
      </details>

      <details className="selection-group" open><summary>填充与局部编辑</summary>
      
      <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
        <ColorControl label="填充颜色" value={color} onChange={setColor} />
        <button onClick={() => void fillSelection(color)} disabled={off} style={{ flex: 1 }}>填充</button>
        <button onClick={() => void strokeSelection(color, 3)} disabled={off || !has} style={{ flex: 1 }}>描边</button>
      </div>
      <div style={grid}>
        <button onClick={() => void clearPixels()} disabled={off}>清除</button>
        <button onClick={() => void cropToSelection()} disabled={off || !has}>裁剪到选区</button>
        <button onClick={() => void selectionToMask()} disabled={off || !has}>转图层蒙版</button>
        <button onClick={() => void contentAwareFill()} disabled={off || !has}>内容识别填充</button>
      </div>
      </details>

      <details className="selection-group" open><summary>存储 / 载入选区</summary>
      <div style={grid}>
        <button onClick={() => void saveSelection()} disabled={off || !has}>存储选区</button>
        <button onClick={() => void loadSelection()} disabled={off}>载入选区</button>
      </div>
      </details>
    </div>
  );
}
