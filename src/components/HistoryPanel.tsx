import { useStore } from '../state/store';
import { historyLabel } from '../engine/historyLabels';

const h4: React.CSSProperties = { margin: '0 0 6px', fontSize: 12, color: 'var(--text-dim)', fontWeight: 400 };

/** History list + revert. The engine truncates the stack at the current state, so the last
 *  entry is "now" and clicking entry i steps back `len-1-i` times (HIS-002). */
export function HistoryPanel() {
  const hasDoc = useStore((s) => !!s.session);
  const busy = useStore((s) => s.busy);
  const history = useStore((s) => s.history);
  const jumpHistory = useStore((s) => s.jumpHistory);
  const revertDocument = useStore((s) => s.revertDocument);
  const originalFile = useStore((s) => s.originalFile);

  if (!hasDoc) return null;
  const off = busy;
  const last = history.length - 1;

  return (
    <div className="selection">
      <h4 style={h4}>历史记录（{history.length}）</h4>
      <div style={{ maxHeight: 140, overflowY: 'auto', marginBottom: 6 }}>
        {history.map((name, i) => (
          <button
            className="history-item"
            key={`${i}-${name}`}
            onClick={() => { if (i !== last) void jumpHistory(i); }}
            title={`${name}${i === last ? ' · 当前状态' : ` · 回到此步（撤销 ${last - i} 次）`}`}
            style={{
              padding: '2px 6px', fontSize: 12, cursor: i === last ? 'default' : 'pointer',
              color: i === last ? 'var(--text)' : 'var(--text-dim)',
              background: i === last ? 'var(--border)' : undefined,
            }}
          >
            {i + 1}. {historyLabel(name)}
          </button>
        ))}
      </div>
      <button
        onClick={() => void revertDocument()}
        disabled={off || !originalFile}
        title={originalFile ? '用打开时的原文件重新载入' : '当前文档是新建的，无原文件'}
        style={{ width: '100%' }}
      >
        恢复到上次保存
      </button>
    </div>
  );
}
