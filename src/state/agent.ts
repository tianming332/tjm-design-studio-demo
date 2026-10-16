// 设计 Agent task state and the executor loop that drives the bound document's steps.
import { create } from 'zustand';
import { WB_PROTOCOL, TERMINAL, type TaskEvent, type TaskSummary } from '../ai/contract';
import { wbApi, WbApiError } from '../ai/api';
import { EditorBridge } from '../ai/bridge';
import { useStore } from './store';
import { useWb } from './workbench';
import { useAssets } from './assets';
import { aiHeld, drainAIWrites, holdAI, releaseAI, trackAIWrite } from './aiControl';

/** One id per page load: a reload reopens documents under new engine ids, so old bindings must not match. */
export const CLIENT_SESSION_ID = `cs-${crypto.randomUUID()}`;

export const rid = (p: string) => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

async function encodePng(px: { width: number; height: number; pixels: ArrayBuffer }, maxSide: number) {
  const src = new OffscreenCanvas(px.width, px.height);
  src.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(px.pixels), px.width, px.height), 0, 0);
  const k = Math.min(1, maxSide / Math.max(px.width, px.height));
  const w = Math.max(1, Math.round(px.width * k)), h = Math.max(1, Math.round(px.height * k));
  const out = new OffscreenCanvas(w, h);
  out.getContext('2d')!.drawImage(src, 0, 0, w, h);
  const dataUrl = await blobToDataUrl(await out.convertToBlob({ type: 'image/png' }));
  return { dataUrl, width: w, height: h };
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.onerror = () => rej(fr.error); fr.readAsDataURL(blob); });
}

export const bridge = new EditorBridge({
  session: (docId) => useStore.getState().tabs.find((t) => t.docId === docId)?.session,
  afterEdit: (docId, damage) => useStore.getState().aiAfterEdit(docId, damage),
  assetBytes: async (id) => { const b = await wbApi.assetBlob(id); return { bytes: await b.arrayBuffer(), mime: b.type }; },
  encodePng,
  uploadAsset: async (dataUrl, name) => { const a = await wbApi.uploadAsset(dataUrl, name); void useAssets.getState().refresh(); return { id: a.id }; },
});

interface AgentState {
  task?: TaskSummary;
  events: TaskEvent[];
  error?: string;
  executing: boolean;
  start(prompt: string, onlySelected: boolean, model?: string): Promise<void>;
  act(kind: 'pause' | 'cancel' | 'resume' | 'retry' | 'approve' | 'reject'): Promise<void>;
  feedback(prompt: string, model?: string): Promise<void>;
  pauseForManual(docId: string): Promise<void>;
}

const errText = (e: unknown) => (e as Error).message;

export const useAgent = create<AgentState>((set, get) => ({
  events: [], executing: false,

  async start(prompt, onlySelected, model) {
    const st = useStore.getState();
    const tab = st.tabs.find((t) => t.docId === st.activeDocId);
    if (!tab) { set({ error: '先打开或新建一个文档' }); return; }
    set({ error: undefined, events: [] });
    try {
      const task = await wbApi.createTask({
        protocol: WB_PROTOCOL, requestId: rid('task'), prompt, ...(model ? { model } : {}), observedRevision: tab.session.currentRevision,
        target: { projectRef: `doc:${tab.name}`, clientSessionId: CLIENT_SESSION_ID, docId: tab.docId, name: tab.name },
        ...(onlySelected && st.selectedIds.length ? { allowedLayers: [...st.selectedIds] } : {}),
      });
      set({ task });
      if (aiHeld(tab.docId)) {
        if (!TERMINAL.includes(task.state)) set({ task: await wbApi.pause(task.id) });
        return;
      }
      schedule(0);
    } catch (e) { set({ error: errText(e) }); }
    void useWb.getState().load(); // quota changed
  },

  async act(kind) {
    const t = get().task;
    if (!t) return;
    set({ error: undefined });
    try {
      const rev = useStore.getState().tabs.find((x) => x.docId === t.target.docId)?.session.currentRevision;
      const step = t.steps.find((s) => s.where === 'client' && s.needsConfirmation && !s.confirmed && s.status === 'pending');
      if (kind === 'pause' || kind === 'cancel') holdAI(t.target.docId);
      if (kind === 'resume' || kind === 'retry') releaseAI(t.target.docId);
      const next = kind === 'pause' ? await wbApi.pause(t.id)
        : kind === 'cancel' ? await wbApi.cancel(t.id)
        : kind === 'resume' ? await wbApi.resume(t.id, rev == null ? {} : { observedRevision: rev })
        : kind === 'retry' ? await wbApi.resume(t.id, { retryUncertain: true, ...(rev == null ? {} : { observedRevision: rev }) })
        : step ? await wbApi.confirm(t.id, { stepId: step.stepId, inputDigest: step.inputDigest, approve: kind === 'approve' }) : t;
      publishTask(next);
      schedule(0);
    } catch (e) { set({ error: errText(e) }); }
  },

  async pauseForManual(docId) {
    holdAI(docId); // Prevent new writes immediately, including leases already on the wire.
    const t = get().task;
    if (t?.target.docId === docId && !TERMINAL.includes(t.state) && t.state !== 'paused') {
      try { publishTask(await wbApi.pause(t.id)); }
      catch (e) {
        const latest = await wbApi.task(t.id);
        publishTask(latest);
        if (!TERMINAL.includes(latest.state) && latest.state !== 'paused') throw e;
      }
    }
    await drainAIWrites(); // Do not enter manual editing until the in-flight engine operation finishes.
  },

  async feedback(prompt, model) {
    const t = get().task;
    if (!t) return;
    const rev = useStore.getState().tabs.find((x) => x.docId === t.target.docId)?.session.currentRevision;
    if (rev == null) { set({ error: '原任务的文档已关闭，请重新发起任务' }); return; }
    try {
      const task = await wbApi.feedback(t.id, { requestId: rid('fb'), prompt, observedRevision: rev, ...(model ? { model } : {}) });
      set({ task, events: [], error: undefined });
      if (aiHeld(task.target.docId)) {
        if (!TERMINAL.includes(task.state)) set({ task: await wbApi.pause(task.id) });
        return;
      }
      schedule(0);
    } catch (e) { set({ error: errText(e) }); }
  },
}));

function publishTask(task: TaskSummary) {
  const current = useAgent.getState().task;
  if (!current || current.id !== task.id || task.lastSeq >= current.lastSeq) useAgent.setState({ task });
}

let poller: ReturnType<typeof setTimeout> | undefined;
let ticking = false;

function schedule(ms: number) {
  if (poller) clearTimeout(poller);
  poller = setTimeout(() => void tick(), ms);
}

/** Poll events + state; when the task waits on *this* page's document, execute its next step. */
async function tick() {
  const { task } = useAgent.getState();
  if (!task) return;
  if (ticking) { schedule(200); return; }
  ticking = true;
  let next = 700;
  try {
    const after = useAgent.getState().events.at(-1)?.seq ?? 0;
    const ev = await wbApi.events(task.id, after);
    if (useAgent.getState().task?.id !== task.id) { next = 0; return; }
    const known = new Set(useAgent.getState().events.map((e) => e.seq));
    const add = ev.events.filter((e) => !known.has(e.seq));
    if (add.length) useAgent.setState({ events: [...useAgent.getState().events, ...add].slice(-300) });
    const fresh = await wbApi.task(task.id);
    if (useAgent.getState().task?.id !== task.id) { next = 0; return; }
    publishTask(fresh);
    if ((fresh.state === 'waiting_client' || fresh.state === 'executing') && fresh.target.clientSessionId === CLIENT_SESSION_ID && !useAgent.getState().executing && !aiHeld(fresh.target.docId)) {
      const { step } = await wbApi.claim(fresh.id, { clientSessionId: CLIENT_SESSION_ID, docId: fresh.target.docId });
      if (step) {
        useAgent.setState({ executing: true });
        try {
          const receipt = await trackAIWrite(() => bridge.execute(fresh, step));
          // The server runs the next model turn inside this request and returns the new state.
          publishTask(await wbApi.submit(fresh.id, receipt));
        } finally { useAgent.setState({ executing: false }); }
        next = 50;
        return;
      }
    }
    if (TERMINAL.includes(fresh.state)) { next = -1; void useWb.getState().load(); }
  } catch (e) {
    useAgent.setState({ error: e instanceof WbApiError ? `${e.code}：${e.message}` : String(e) });
  } finally {
    ticking = false;
    if (next >= 0) schedule(next);
  }
}
