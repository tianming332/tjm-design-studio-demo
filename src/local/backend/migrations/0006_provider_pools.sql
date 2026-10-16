-- Key pools for every model vendor (Gemini keeps its gemini_projects pool), and per-style image
-- vendor/model. Only adds; existing styles keep provider 'gemini' and follow the global models.
CREATE TABLE IF NOT EXISTS provider_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  name TEXT NOT NULL,
  weight INTEGER NOT NULL DEFAULT 1,
  enabled INTEGER NOT NULL DEFAULT 1,
  key_encrypted TEXT NOT NULL DEFAULT '',
  fail_count INTEGER NOT NULL DEFAULT 0,
  cooldown_until TEXT,
  last_used_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_provider_keys_provider ON provider_keys(provider, enabled);
ALTER TABLE styles ADD COLUMN provider TEXT NOT NULL DEFAULT 'gemini';
ALTER TABLE styles ADD COLUMN image_model TEXT NOT NULL DEFAULT '';
