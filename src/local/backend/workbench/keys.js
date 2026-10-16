// Key pools for every model vendor (local edition: Gemini is a pool like the others, all in
// provider_keys): weighted pick, cooldown on 429/5xx, auto-disable on 401/403.
import { getSetting, setSetting, pickGeminiProject } from '../db.js';
import { encryptSecret, decryptSecret } from '../security.js';
import { ProviderError } from './gemini.js';

const mask = value => value ? `••••••••${value.slice(-4)}` : '';

/** The single-key settings of the previous version become the first pool entry. */
async function migrateLegacy(db, vendor) {
  if (!['gemini', 'openai', 'anthropic'].includes(vendor)) return;
  const legacy = await getSetting(db, `${vendor}_key_encrypted`, '');
  if (!legacy) return;
  await db.run('INSERT INTO provider_keys(provider,name,weight,enabled,key_encrypted) VALUES(?,?,?,?,?)', [vendor, '默认', 1, 1, legacy]);
  await setSetting(db, `${vendor}_key_encrypted`, '');
}

export async function listPool(db, vendor, secret) {
  const decrypt = encoded => { try { return decryptSecret(encoded, secret); } catch { return ''; } };
  await migrateLegacy(db, vendor);
  const rows = await db.all('SELECT id,name,weight,enabled,key_encrypted AS keyEncrypted,fail_count AS failCount,cooldown_until AS cooldownUntil,last_used_at AS lastUsedAt FROM provider_keys WHERE provider=? ORDER BY id', [vendor]);
  return rows.map(({ keyEncrypted, ...r }) => ({ ...r, enabled: !!r.enabled, keySaved: !!keyEncrypted, keyMasked: keyEncrypted ? (mask(decrypt(keyEncrypted)) || '••••••••（无法解密）') : '' }));
}

function cleanKey(apiKey) {
  const key = String(apiKey || '').trim();
  if (key.length < 8 || key.length > 400 || /\s/.test(key)) throw new ProviderError({ code: 'BAD_REQUEST', message: 'API Key 格式无效' });
  return key;
}

/** Adds a key, or updates name / weight / enabled (and optionally replaces the key) of one entry. */
export async function saveKey(db, vendor, body, secret) {
  if (!secret) throw new ProviderError({ code: 'NOT_CONFIGURED', message: 'DATA_ENCRYPTION_KEY 未配置，无法保存 Key' });
  const id = body.id ? Number(body.id) : 0;
  const name = String(body.name || '').trim().slice(0, 40) || (id ? '' : `Key ${new Date().toISOString().slice(0, 10)}`);
  const weight = body.weight === undefined ? undefined : Number(body.weight);
  if (weight !== undefined && (!Number.isInteger(weight) || weight < 1 || weight > 100)) throw new ProviderError({ code: 'BAD_REQUEST', message: '权重必须为 1–100' });
  const keyEncrypted = body.apiKey ? encryptSecret(cleanKey(body.apiKey), secret) : undefined;
  if (!id && !keyEncrypted) throw new ProviderError({ code: 'BAD_REQUEST', message: '请填写 API Key' });
  await migrateLegacy(db, vendor);
  if (!id) {
    const r = await db.run('INSERT INTO provider_keys(provider,name,weight,enabled,key_encrypted) VALUES(?,?,?,?,?)', [vendor, name, weight ?? 1, body.enabled === false ? 0 : 1, keyEncrypted]);
    return r.lastRowId;
  }
  const row = await db.get('SELECT id,name,weight,enabled,key_encrypted AS keyEncrypted FROM provider_keys WHERE id=? AND provider=?', [id, vendor]);
  if (!row) throw new ProviderError({ code: 'NOT_FOUND', message: 'Key 不存在' });
  const enabled = body.enabled === undefined ? row.enabled : body.enabled !== false ? 1 : 0;
  await db.run(`UPDATE provider_keys SET name=?,weight=?,enabled=?,key_encrypted=?,
    fail_count=CASE WHEN ?=1 THEN 0 ELSE fail_count END, cooldown_until=CASE WHEN ?=1 THEN NULL ELSE cooldown_until END,
    updated_at=CURRENT_TIMESTAMP WHERE id=?`, [name || row.name, weight ?? row.weight, enabled, keyEncrypted ?? row.keyEncrypted, enabled, enabled, id]);
  return id;
}

export async function removeKey(db, vendor, id) {
  await db.run('DELETE FROM provider_keys WHERE id=? AND provider=?', [Number(id), vendor]);
}

/** Usable keys in try order: a weighted first pick, then the rest (failover). */
export async function keyCandidates(db, config, vendor, random = Math.random) {
  await migrateLegacy(db, vendor);
  const rows = await db.all(`SELECT id,name,weight,key_encrypted AS keyEncrypted FROM provider_keys
    WHERE provider=? AND enabled=1 AND key_encrypted<>'' AND (cooldown_until IS NULL OR datetime(cooldown_until)<datetime(?))
    ORDER BY COALESCE(last_used_at,''),id`, [vendor, new Date().toISOString()]);
  const available = [];
  for (const r of rows) { try { const apiKey = decryptSecret(r.keyEncrypted, config.dataEncryptionKey); if (apiKey) available.push({ id: r.id, name: r.name, weight: r.weight, apiKey }); } catch {} }
  const first = pickGeminiProject(available, random);
  return first ? [first, ...available.filter(k => k.id !== first.id)] : available;
}

export async function markKey(db, vendor, id, ok, upstreamStatus) {
  if (!id) return;
  if (ok) { await db.run('UPDATE provider_keys SET fail_count=0,cooldown_until=NULL,last_used_at=CURRENT_TIMESTAMP WHERE id=?', [id]); return; }
  const status = Number(upstreamStatus || 0);
  if (status === 401 || status === 403) { await db.run('UPDATE provider_keys SET enabled=0,fail_count=fail_count+1,updated_at=CURRENT_TIMESTAMP WHERE id=?', [id]); return; }
  if (status === 429 || status >= 500 || status === 0) {
    const row = await db.get('SELECT fail_count AS failCount FROM provider_keys WHERE id=?', [id]);
    const count = Number(row?.failCount || 0) + 1;
    const seconds = count <= 1 ? 30 : count === 2 ? 120 : 600;
    await db.run("UPDATE provider_keys SET fail_count=?,cooldown_until=datetime('now',?),updated_at=CURRENT_TIMESTAMP WHERE id=?", [count, `+${seconds} seconds`, id]);
  }
}
