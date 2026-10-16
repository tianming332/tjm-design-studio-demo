// Browser stand-in for the Admin's security.js. Everything here stays inside this browser: keys
// are kept in the local database as-is (there is no server to protect them from), and the
// "session" is a plain local marker so the shared workbench routes keep one owner id.
export function encryptSecret(value) {
  return value ? `local:${value}` : '';
}

export function decryptSecret(encoded) {
  return String(encoded || '').startsWith('local:') ? String(encoded).slice(6) : '';
}

export function createSession(_secret, payload) {
  return btoa(JSON.stringify(payload));
}

export function readSession(token) {
  try { return JSON.parse(atob(token)); } catch { return null; }
}

export function parseCookies(header = '') {
  return Object.fromEntries(String(header).split(';').map(p => p.trim()).filter(Boolean).map(p => { const i = p.indexOf('='); return [p.slice(0, i), decodeURIComponent(p.slice(i + 1))]; }));
}
