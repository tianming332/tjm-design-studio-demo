// The Admin's store interface (all/get/run/exec/batch) on sql.js, persisted to IndexedDB. The
// whole database is one blob: it is re-saved shortly after every write request.
import initSqlJs from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm-browser.wasm?url';

const MIGRATIONS = import.meta.glob('./backend/migrations/*.sql', { query: '?raw', import: 'default', eager: true });
const IDB = { name: 'tjm-local', store: 'kv', key: 'sqlite' };

function idb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB.name, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB.store);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbGet() {
  const db = await idb();
  return new Promise((resolve, reject) => { const r = db.transaction(IDB.store).objectStore(IDB.store).get(IDB.key); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
}
async function idbPut(bytes) {
  const db = await idb();
  return new Promise((resolve, reject) => { const tx = db.transaction(IDB.store, 'readwrite'); tx.objectStore(IDB.store).put(bytes, IDB.key); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
}

const toParams = params => params.map(v => v instanceof ArrayBuffer ? new Uint8Array(v) : v === undefined ? null : v);

function rows(database, sql, params) {
  const stmt = database.prepare(sql);
  try {
    stmt.bind(toParams(params));
    const out = [];
    while (stmt.step()) out.push(stmt.getAsObject());
    return out;
  } finally { stmt.free(); }
}

function runOne(database, sql, params) {
  database.run(sql, toParams(params));
  const changes = database.getRowsModified();
  const lastRowId = Number(database.exec('SELECT last_insert_rowid() AS id')[0]?.values[0][0] || 0);
  return { changes, lastRowId };
}

export async function openLocalStore() {
  const SQL = await initSqlJs({ locateFile: () => wasmUrl });
  const saved = await idbGet().catch(() => undefined);
  const database = saved ? new SQL.Database(new Uint8Array(saved)) : new SQL.Database();
  database.exec('PRAGMA foreign_keys=ON; CREATE TABLE IF NOT EXISTS local_migrations (name TEXT PRIMARY KEY)');
  for (const [file, sql] of Object.entries(MIGRATIONS).sort(([a], [b]) => a.localeCompare(b))) {
    const name = file.split('/').pop();
    if (rows(database, 'SELECT name FROM local_migrations WHERE name=?', [name]).length) continue;
    database.exec('BEGIN');
    try { database.exec(sql); database.run('INSERT INTO local_migrations(name) VALUES(?)', [name]); database.exec('COMMIT'); }
    catch (error) { database.exec('ROLLBACK'); throw error; }
  }
  let timer = 0;
  const store = {
    kind: 'browser-sqlite',
    async all(sql, params = []) { return rows(database, sql, params); },
    async get(sql, params = []) { return rows(database, sql, params)[0] || null; },
    async run(sql, params = []) { return runOne(database, sql, params); },
    async exec(sql) { database.exec(sql); },
    async batch(operations) {
      database.exec('BEGIN');
      try { const out = operations.map(({ sql, params = [] }) => runOne(database, sql, params)); database.exec('COMMIT'); return out; }
      catch (error) { try { database.exec('ROLLBACK'); } catch {} throw error; }
    },
    /** Debounced save; returns when the snapshot is on disk. */
    persist() {
      clearTimeout(timer);
      return new Promise(resolve => { timer = setTimeout(() => { const bytes = database.export(); database.exec('PRAGMA foreign_keys=ON'); idbPut(bytes).then(resolve, resolve); }, 60); });
    },
    raw: database
  };
  await store.persist();
  return store;
}
