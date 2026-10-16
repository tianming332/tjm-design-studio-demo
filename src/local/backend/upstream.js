// Browser stand-in for the Admin's upstream.js: the Gemini "project pool" is the single key the
// user saved locally, and image generation calls the official Gemini Interactions API directly.
import { getSetting, geminiSettings } from './db.js';
import { decryptSecret } from './security.js';

function uploadedReference(dataUrl, index = 0) {
  const match = String(dataUrl || '').match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/);
  return match ? { mime: match[1], data: match[2], filename: `upload-${index + 1}` } : null;
}

function bytesToBase64(value) {
  if (typeof value === 'string') return value;
  const bytes = value instanceof ArrayBuffer ? new Uint8Array(value) : ArrayBuffer.isView(value) ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength) : null;
  if (!bytes) return '';
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export async function collectImageInputs(style, input) {
  const images = [];
  for (const [index, reference] of (style.references || []).entries()) {
    const data = bytesToBase64(reference.bytes);
    if (data) images.push({ mime: reference.referenceMime, data, filename: `style-${index + 1}` });
  }
  const user = uploadedReference(input.imageDataUrl, images.length);
  if (user) images.push(user);
  return images;
}

export async function buildDirectImagePrompt(db, style, input) {
  const globalPrompt = await getSetting(db, 'global_system_prompt', '');
  const fallback = await getSetting(db, 'image_only_prompt', '');
  return [globalPrompt, style.systemPrompt, String(input.prompt || '').trim() || fallback].filter(Boolean).join('\n\n');
}

/** One "project" = the locally saved Gemini key (id 1 so task pinning keeps working). */
export async function geminiProjectCandidates(db, config) {
  const encoded = await getSetting(db, 'gemini_key_encrypted', '');
  const apiKey = encoded ? decryptSecret(encoded, config.dataEncryptionKey) : '';
  return apiKey ? [{ id: 1, name: 'local', apiKey, weight: 1 }] : [];
}

function findImage(value, depth = 0) {
  if (!value || depth > 8 || typeof value !== 'object') return null;
  if (Array.isArray(value)) { for (const v of value) { const f = findImage(v, depth + 1); if (f) return f; } return null; }
  const mime = String(value.mime_type || value.mimeType || '').toLowerCase();
  if (typeof value.data === 'string' && mime.startsWith('image/')) return { data: value.data.replace(/\s/g, ''), mime: mime === 'image/jpg' ? 'image/jpeg' : mime.split(';')[0] };
  for (const child of Object.values(value)) { const f = findImage(child, depth + 1); if (f) return f; }
  return null;
}

function findText(value, depth = 0) {
  if (!value || depth > 8) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(v => findText(v, depth + 1)).filter(Boolean).join('\n');
  if (typeof value !== 'object') return '';
  if (typeof value.text === 'string') return value.text;
  return Object.values(value).map(v => findText(v, depth + 1)).filter(Boolean).join('\n');
}

/** Text-to-image or edit through Gemini; returns `{ imageUrl: data:… }` like the Admin version. */
export async function generate(db, config, style, input, options = {}) {
  const settings = await geminiSettings(db);
  const [project] = await geminiProjectCandidates(db, config);
  if (!project) throw Object.assign(new Error('请先在「AI 设置」里填写 Gemini Key'), { status: 503, code: 'gemini_not_configured' });
  const images = await collectImageInputs(style, input);
  const body = {
    model: options.model || (images.length ? settings.editModel : settings.textModel),
    input: [{ type: 'text', text: await buildDirectImagePrompt(db, style, input) }, ...images.map(i => ({ type: 'image', mime_type: i.mime, data: i.data }))],
    response_format: { type: 'image', ...(options.aspectRatio ? { aspect_ratio: options.aspectRatio } : {}), ...(options.imageSize ? { image_size: options.imageSize } : {}) }
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), settings.timeoutMs);
  let response;
  try {
    response = await fetch(settings.endpoint, { method: 'POST', signal: controller.signal, headers: { 'content-type': 'application/json', 'x-goog-api-key': project.apiKey }, body: JSON.stringify(body) });
  } catch (error) {
    throw Object.assign(new Error(error.name === 'AbortError' ? `Gemini 图片接口超时（${settings.timeoutMs} ms）` : 'Gemini 图片接口连接失败'), { code: error.name === 'AbortError' ? 'upstream_timeout' : 'upstream_error' });
  } finally { clearTimeout(timer); }
  const data = await response.json().catch(() => null);
  if (!response.ok || !data || data.error) throw Object.assign(new Error(`Gemini 图片接口 HTTP ${response.status}：${String(data?.error?.message || '请求失败').slice(0, 300)}`), { code: 'upstream_error' });
  const image = findImage(data);
  return image ? { imageUrl: `data:${image.mime};base64,${image.data}`, provider: 'gemini' } : { text: findText(data).trim(), provider: 'gemini' };
}
