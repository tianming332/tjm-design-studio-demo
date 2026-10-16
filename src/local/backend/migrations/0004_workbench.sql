-- Design workbench (third tool): agent tasks, participant asset library, skill library.
-- Configuration lives in `settings` (workbench_* keys); API keys stay in gemini_projects.

CREATE TABLE IF NOT EXISTS workbench_skills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE CHECK(length(slug) BETWEEN 2 AND 60),
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 80),
  description TEXT NOT NULL DEFAULT '',
  triggers TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  tools TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','disabled')),
  version INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Published versions are immutable; running tasks pin (skill_id, version).
CREATE TABLE IF NOT EXISTS workbench_skill_versions (
  skill_id INTEGER NOT NULL REFERENCES workbench_skills(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  triggers TEXT NOT NULL,
  body TEXT NOT NULL,
  tools TEXT NOT NULL,
  published_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(skill_id, version)
);

CREATE TABLE IF NOT EXISTS workbench_tasks (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  state TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_workbench_tasks_owner ON workbench_tasks(owner, created_at);
CREATE INDEX IF NOT EXISTS idx_workbench_tasks_state ON workbench_tasks(state);

CREATE TABLE IF NOT EXISTS workbench_events (
  task_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  at INTEGER NOT NULL,
  type TEXT NOT NULL,
  message TEXT NOT NULL,
  data TEXT,
  PRIMARY KEY(task_id, seq)
);

-- Asset metadata; bytes are split into ≤ 1 MB chunks (D1 rows are size-limited).
CREATE TABLE IF NOT EXISTS workbench_assets (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('upload','generated','web')),
  name TEXT NOT NULL DEFAULT '',
  mime TEXT NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  alpha INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT '{}',
  deleted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_workbench_assets_owner ON workbench_assets(owner, deleted, created_at);

CREATE TABLE IF NOT EXISTS workbench_asset_chunks (
  asset_id TEXT NOT NULL REFERENCES workbench_assets(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  bytes BLOB NOT NULL,
  PRIMARY KEY(asset_id, idx)
);

-- Request dedup: `${owner}:${kind}:${requestId}` → result id + input digest.
CREATE TABLE IF NOT EXISTS workbench_requests (
  key TEXT PRIMARY KEY,
  ref TEXT NOT NULL,
  digest TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS workbench_generations (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
