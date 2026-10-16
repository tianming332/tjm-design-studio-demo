PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS styles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  system_prompt TEXT NOT NULL,
  model TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS style_reference_blobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  style_id INTEGER NOT NULL REFERENCES styles(id) ON DELETE CASCADE,
  mime TEXT NOT NULL,
  bytes BLOB NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_style_reference_blobs_style
  ON style_reference_blobs(style_id, sort_order, id);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS access_code_issues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code_hash TEXT NOT NULL,
  code_lookup TEXT,
  label TEXT NOT NULL DEFAULT '',
  max_uses INTEGER NOT NULL CHECK(max_uses > 0),
  used INTEGER NOT NULL DEFAULT 0 CHECK(used >= 0),
  retired INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  retired_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_access_code_lookup
  ON access_code_issues(code_lookup) WHERE code_lookup IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_access_code_active
  ON access_code_issues(retired, expires_at, used, max_uses);

CREATE TABLE IF NOT EXISTS access_code_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  issue_id INTEGER NOT NULL REFERENCES access_code_issues(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL UNIQUE,
  tool TEXT NOT NULL,
  units INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS access_reservations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT NOT NULL UNIQUE,
  operation_id TEXT NOT NULL,
  issue_id INTEGER NOT NULL REFERENCES access_code_issues(id) ON DELETE CASCADE,
  tool TEXT NOT NULL,
  units INTEGER NOT NULL DEFAULT 1 CHECK(units > 0),
  status TEXT NOT NULL DEFAULT 'held' CHECK(status IN ('held','completed','refunded','rejected')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_access_reservations_operation
  ON access_reservations(operation_id, status);
CREATE INDEX IF NOT EXISTS idx_access_reservations_stale
  ON access_reservations(status, created_at);

CREATE TRIGGER IF NOT EXISTS access_reservation_validate
BEFORE INSERT ON access_reservations
WHEN NOT EXISTS (SELECT 1 FROM access_reservations WHERE request_id = NEW.request_id)
BEGIN
  SELECT (CASE WHEN NOT EXISTS (
    SELECT 1 FROM access_code_issues
    WHERE id = NEW.issue_id
      AND retired = 0
      AND used + NEW.units <= max_uses
      AND (expires_at IS NULL OR datetime(expires_at) > CURRENT_TIMESTAMP)
  ) THEN RAISE(ABORT, 'quota_unavailable') END);
END;

CREATE TRIGGER IF NOT EXISTS access_reservation_hold
AFTER INSERT ON access_reservations
WHEN NEW.status = 'held'
BEGIN
  UPDATE access_code_issues
  SET used = used + NEW.units,
      retired = (CASE WHEN used + NEW.units >= max_uses THEN 1 ELSE retired END),
      retired_at = (CASE WHEN used + NEW.units >= max_uses THEN CURRENT_TIMESTAMP ELSE retired_at END)
  WHERE id = NEW.issue_id;
  INSERT OR IGNORE INTO access_code_usage(issue_id, request_id, tool, units)
  VALUES (NEW.issue_id, NEW.request_id, NEW.tool, NEW.units);
END;

CREATE TRIGGER IF NOT EXISTS access_reservation_refund
AFTER UPDATE OF status ON access_reservations
WHEN OLD.status = 'held' AND NEW.status = 'refunded'
BEGIN
  UPDATE access_code_issues
  SET used = MAX(0, used - OLD.units),
      retired = (CASE
        WHEN expires_at IS NULL OR datetime(expires_at) > CURRENT_TIMESTAMP THEN 0
        ELSE retired
      END),
      retired_at = (CASE
        WHEN expires_at IS NULL OR datetime(expires_at) > CURRENT_TIMESTAMP THEN NULL
        ELSE retired_at
      END)
  WHERE id = OLD.issue_id;
END;

CREATE TABLE IF NOT EXISTS gemini_projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  weight INTEGER NOT NULL DEFAULT 1 CHECK(weight BETWEEN 1 AND 100),
  enabled INTEGER NOT NULL DEFAULT 1,
  key_encrypted TEXT NOT NULL DEFAULT '',
  fail_count INTEGER NOT NULL DEFAULT 0,
  cooldown_until TEXT,
  last_used_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 0
);

INSERT OR IGNORE INTO settings(key, value) VALUES
  ('max_upload_mb', '8'),
  ('global_system_prompt', '你是专业的视觉创作助手。严格遵循画风定义和参考图的视觉语言，保留用户主体要求，输出适合图片生成的结果。'),
  ('default_model', 'gemini-3.1-flash-image'),
  ('default_image_provider', 'gemini'),
  ('gemini_endpoint', 'https://generativelanguage.googleapis.com/v1beta/interactions'),
  ('gemini_text_model', 'gemini-3.1-flash-image'),
  ('gemini_edit_model', 'gemini-3.1-flash-image'),
  ('gemini_byok_enabled', '1'),
  ('image_timeout_ms', '300000'),
  ('image_only_prompt', '保留用户图片的主要人物、物体、姿态、构图关系和核心特征，将其转换为所选画风，输出一张完整、高质量的图片。'),
  ('admin_password_version', '1'),
  ('contact_note', '需要体验 AI 模式？联系获取体验码。'),
  ('contact_email', ''),
  ('contact_link', ''),
  ('style_ai_enabled', '1'),
  ('autobook_enabled', '1'),
  ('autobook_model', 'gemini-3.6-flash'),
  ('autobook_info_coverage', '0.5'),
  ('autobook_max_vision', '40'),
  ('autobook_system_prompt', '你是印刷画册的分页导演。只返回符合约定结构的 JSON，不编造正文、时间、地点或素材。');
