// Live property edits (A29 #15): every change is sent to the engine at once so the canvas is a
// real preview, and consecutive edits of one gesture share a single history step through the
// engine's `coalesce` param (Photoshop: one "Opacity" step per slider drag).
import { useStore, flatten } from './store';
import { toRects, type Batch, type DocSession } from '../engine/session';

let gesture = 0;
/** Call when a new slider drag / field edit starts: later edits get their own history step. */
export function beginGesture() { gesture += 1; }

const pending = new Map<string, { batch: Batch; session: DocSession; timer?: ReturnType<typeof setTimeout>; running?: Promise<void> }>();

/** Sends `batch` (latest wins) for `key`, at most every ~50 ms, with a coalescing key. */
export function liveEdit(key: string, batch: Batch) {
  const session = useStore.getState().session;
  if (!session) return;
  const k = `${session.docId}:${key}#${gesture}`;
  const tagged = batch.map((c) => ({ ...c, params: { ...(c.params as object | undefined), coalesce: k } })) as Batch;
  const slot = pending.get(k) ?? { batch: tagged, session };
  slot.batch = tagged;
  pending.set(k, slot);
  if (slot.timer) return;
  slot.timer = setTimeout(() => void flush(k), 50);
}

async function flush(k: string) {
  const slot = pending.get(k);
  if (!slot) return;
  slot.timer = undefined;
  await slot.running;
  const st = useStore.getState();
  const session = slot.session;
  if (st.session !== session) { pending.delete(k); return; }
  const batch = slot.batch;
  slot.running = (async () => {
    try {
      const body = await session.request(batch);
      const info = await session.inspect();
      if (useStore.getState().session !== session) return;
      useStore.setState({
        layers: info.layers ?? [],
        history: info.history ?? useStore.getState().history,
        historyDepth: { canUndo: !!info.canUndo, canRedo: !!info.canRedo },
        render: { nonce: useStore.getState().render.nonce + 1, damage: toRects(body.damage as never) },
        error: undefined,
      });
    } catch (e) {
      useStore.setState({ error: e instanceof Error ? e.message : String(e) });
    }
  })();
  await slot.running;
  if (pending.get(k) === slot && !slot.timer) pending.delete(k);
}

/** Layer opacity / fill / blend, live. */
export function liveProps(layer: number, props: Record<string, unknown>) {
  liveEdit(`props:${layer}:${Object.keys(props).join(',')}`, [{ cmd: 'layer.setProps', params: { layer, ...props } }]);
}

/** Shape options → the selected shape layer (fill, stroke, radius, sides), live. */
export function liveShapeEdit(p: Record<string, unknown>) {
  const st = useStore.getState();
  const info = st.shapeInfo;
  const layer = flatten(st.layers).find((l) => l.id === st.selectedId);
  if (!info || !layer || layer.id !== info.layer || st.activeTool !== 'shape') return;
  const o = { ...st.shapeOpts, ...p };
  const params: Record<string, unknown> = {};
  if ('fill' in p || 'noFill' in p) params.fill = o.noFill ? null : o.fill;
  if ('strokeColor' in p || 'strokeWidth' in p) params.stroke = o.strokeWidth > 0 ? { width: o.strokeWidth, color: o.strokeColor } : null;
  if ('radius' in p && info.live?.kind === 'roundedRect') params.radii = o.radius;
  if ('sides' in p && info.live?.kind === 'polygon') params.sides = o.sides;
  if (!Object.keys(params).length) return;
  liveEdit(`shape:${info.layer}:${Object.keys(params).join(',')}`, [{ cmd: 'shape.edit', params: { layer: info.layer, ...params } }]);
}

/** Character / paragraph style on a type layer, live. */
export function liveTextStyle(layer: number, style: Record<string, unknown>) {
  liveEdit(`type:${layer}:${Object.keys(style).join(',')}`, [{ cmd: 'type.setStyle', params: { layer, ...style } }]);
}
