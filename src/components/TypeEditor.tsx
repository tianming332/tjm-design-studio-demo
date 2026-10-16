// On-canvas text editing for the Type tool: a native textarea (so IMEs, selection and clipboard
// all work) laid over the document at the text's position and scale. Editing an existing layer
// covers the engine-rendered text with what lies beneath it, so the two never double up.
import { useEffect, useLayoutEffect, useRef } from 'react';
import { useStore } from '../state/store';
import { DEFAULT_FONT, ensureCssFont } from '../engine/fonts';

const LINE = 1.2;

export function TypeEditor() {
  const t = useStore((s) => s.typeEditing);
  const view = useStore((s) => s.view);
  const doc = useStore((s) => s.doc);
  const session = useStore((s) => s.session);
  const setText = useStore((s) => s.setTypeText);
  const commit = useStore((s) => s.commitType);
  const cancel = useStore((s) => s.cancelType);
  const ref = useRef<HTMLTextAreaElement>(null);
  const coverRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => { void ensureCssFont(); }, []);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
    if (t?.layer != null) el.select();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t?.layer, t?.x, t?.y]);

  // Existing layer: paint what lies beneath its bounds over the rendered text.
  useEffect(() => {
    const c = coverRef.current;
    if (!c || !t?.bounds || t.layer == null || !session || !doc) return;
    const [bx, by, bw, bh] = t.bounds;
    const x = Math.max(0, bx), y = Math.max(0, by);
    const w = Math.min(doc.width, bx + bw) - x, h = Math.min(doc.height, by + bh) - y;
    if (w <= 0 || h <= 0) return;
    let live = true;
    void session.renderLayerSplit(t.layer, false, x, y, w, h).then((r) => {
      if (!live || !r.ok || !r.data?.width) return;
      c.width = r.data.width; c.height = r.data.height;
      c.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(r.data.pixels), r.data.width, r.data.height), 0, 0);
    });
    return () => { live = false; };
  }, [t?.layer, t?.bounds, session, doc]);

  if (!t || !doc) return null;
  const pxPerPt = (doc.resolution ?? 72) / 72;
  const fontPx = t.size * pxPerPt;
  const lines = t.text.split('\n');
  const vertical = t.orientation === 'vertical';
  // Box geometry in document pixels.
  let left = t.x, top = t.y - fontPx * 0.95, width: number, height: number;
  if (t.box) { [left, top] = t.box; width = t.box[2]; height = t.box[3]; }
  else {
    if (t.bounds) { left = t.bounds[0] - 2; top = t.bounds[1] - fontPx * 0.25; }
    const longest = Math.max(1, ...lines.map((l) => [...l].length));
    width = vertical ? fontPx * LINE * lines.length + 8 : fontPx * (longest + 1.5);
    height = vertical ? fontPx * (longest + 1.5) : fontPx * LINE * lines.length + 6;
    if (t.align === 'center' && !t.bounds) left -= width / 2;
    else if (t.align === 'right' && !t.bounds) left -= width;
  }
  const s = view.scale;
  return (
    <>
      {t.bounds && (
        <canvas
          ref={coverRef} className="type-cover"
          style={{ transform: `translate(${view.tx + Math.max(0, t.bounds[0]) * s}px, ${view.ty + Math.max(0, t.bounds[1]) * s}px) scale(${s})` }}
        />
      )}
      <textarea
        ref={ref}
        className="type-editor"
        aria-label="文字输入"
        value={t.text}
        spellCheck={false}
        wrap={t.box ? 'soft' : 'off'}
        onChange={(e) => setText(e.target.value)}
        onPointerDown={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') { e.preventDefault(); cancel(); }
          else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey || e.code === 'NumpadEnter')) { e.preventDefault(); void commit(); }
        }}
        style={{
          left: view.tx + left * s,
          top: view.ty + top * s,
          width: width * s,
          height: height * s,
          fontSize: fontPx * s,
          lineHeight: LINE,
          fontFamily: `"${t.font}", "${DEFAULT_FONT}", sans-serif`,
          color: t.color,
          textAlign: t.align,
          writingMode: vertical ? 'vertical-rl' : 'horizontal-tb',
          whiteSpace: t.box ? 'pre-wrap' : 'pre',
        }}
      />
      <div
        className="type-commit-bar" role="toolbar" aria-label="文字编辑"
        style={{ left: view.tx + (left + width) * s + 6, top: view.ty + top * s - 2 }}
        onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); }}
      >
        <button className="primary" aria-label="完成文字输入" title="提交（Ctrl/⌘+Enter 或点击画布别处）" onClick={() => void commit()}>✓</button>
        <button aria-label="放弃文字输入" title="取消（Esc）" onClick={() => cancel()}>✕</button>
        <span className="type-commit-hint">Ctrl/⌘+Enter 提交 · Esc 取消</span>
      </div>
    </>
  );
}
