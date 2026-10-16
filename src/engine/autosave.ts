// Autosave & crash recovery (HIS-003). The root document is snapshotted as `.pcraft` (the engine's
// own lossless project format) into IndexedDB after edits settle; on the next start the app offers
// to restore it. Saving explicitly (PSD / project) or discarding clears the snapshot.

export interface AutosaveRecord {
  /** Display name of the document the snapshot came from. */
  name: string;
  bytes: ArrayBuffer;
  savedAt: number;
  revision: number;
}

const DB = 'tjm-autosave';
const STORE = 'snapshots';
const KEY = 'current';

/** Quiet period after the last edit before snapshotting. */
export const AUTOSAVE_DEBOUNCE_MS = 4000;

/** Whether a snapshot is due: something changed since the last one and edits have settled. */
export function autosaveDue(o: { revision: number; savedRevision: number | null; lastEditAt: number; now: number; debounceMs?: number }): boolean {
  if (o.savedRevision != null && o.revision === o.savedRevision) return false;
  if (o.revision <= 0 && o.savedRevision == null) return false; // freshly opened, nothing to protect
  return o.now - o.lastEditAt >= (o.debounceMs ?? AUTOSAVE_DEBOUNCE_MS);
}

/** File name used when re-opening a snapshot: the bridge picks `.pcraft` by extension. */
export function recoveryFileName(name: string): string {
  const stem = name.replace(/\.(psd|psb|pcraft|png|jpe?g|webp|tiff?)$/i, '');
  return `${stem}（恢复）.pcraft`;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore(STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const r = run(t.objectStore(STORE));
      t.oncomplete = () => resolve(r.result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  } finally {
    db.close();
  }
}

export const putSnapshot = (rec: AutosaveRecord) => tx('readwrite', (s) => s.put(rec, KEY)).then(() => undefined);
export const getSnapshot = () => tx<AutosaveRecord | undefined>('readonly', (s) => s.get(KEY) as IDBRequest<AutosaveRecord | undefined>);
export const clearSnapshot = () => tx('readwrite', (s) => s.delete(KEY)).then(() => undefined);
