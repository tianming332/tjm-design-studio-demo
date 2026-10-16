// Browser stand-in for the Admin's db.js: only what the workbench modules import. Settings live in
// the same `settings` table (local SQLite); there are no experience codes, so quota calls are no-ops.
export const DEFAULTS = {
  global_system_prompt: '你是专业的视觉创作助手。严格遵循画风定义和参考图的视觉语言，保留用户主体要求，输出适合图片生成的结果。',
  gemini_endpoint: 'https://generativelanguage.googleapis.com/v1beta/interactions',
  gemini_text_model: 'gemini-3.1-flash-image',
  gemini_edit_model: 'gemini-3.1-flash-image',
  image_timeout_ms: '300000',
  image_only_prompt: '保留用户图片的主要人物、物体、姿态、构图关系和核心特征，将其转换为所选画风，输出一张完整、高质量的图片。'
};

export async function getSetting(db, key, fallback = '') {
  return (await db.get('SELECT value FROM settings WHERE key=?', [key]))?.value ?? fallback;
}

export async function setSetting(db, key, value) {
  await db.run('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', [key, String(value)]);
}

export async function geminiSettings(db) {
  const [textModel, editModel, imageOnlyPrompt, timeout] = await Promise.all([
    getSetting(db, 'gemini_text_model', DEFAULTS.gemini_text_model),
    getSetting(db, 'gemini_edit_model', DEFAULTS.gemini_edit_model),
    getSetting(db, 'image_only_prompt', DEFAULTS.image_only_prompt),
    getSetting(db, 'image_timeout_ms', DEFAULTS.image_timeout_ms)
  ]);
  // Official endpoint only; not configurable in the local edition.
  return { defaultProvider: 'gemini', endpoint: DEFAULTS.gemini_endpoint, textModel, editModel, byokEnabled: true, imageOnlyPrompt, timeoutMs: Number(timeout) || 300000 };
}

/** Local edition ships without official styles; a style id resolves only if one was added locally. */
export async function getStyle(db, id) {
  const row = await db.get('SELECT id,name,description,system_prompt AS systemPrompt,model,enabled FROM styles WHERE id=? AND enabled=1', [id]);
  return row ? { ...row, references: [] } : null;
}

export async function listStyles(db) {
  const rows = await db.all('SELECT id,name,description FROM styles WHERE enabled=1 ORDER BY id');
  return rows.map(r => ({ ...r, coverUrl: null, tags: [] }));
}

// Experience codes do not exist locally: the user pays their own vendor directly.
export async function reserveAccessUnits() {}
export async function completeReservation() {}
export async function refundReservation() {}
export const LOCAL_QUOTA = { used: 0, limit: 1_000_000, remaining: 1_000_000, exhausted: false, expiresAt: null };
