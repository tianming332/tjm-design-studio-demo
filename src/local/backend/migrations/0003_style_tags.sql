CREATE TABLE IF NOT EXISTS style_tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK(length(name) BETWEEN 1 AND 40),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS style_tag_links (
  style_id INTEGER NOT NULL REFERENCES styles(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES style_tags(id) ON DELETE CASCADE,
  PRIMARY KEY(style_id, tag_id)
);
CREATE INDEX IF NOT EXISTS idx_style_tag_links_tag ON style_tag_links(tag_id, style_id);

-- Labels are seeded once. Existing styles remain unclassified until explicitly tagged.
INSERT OR IGNORE INTO style_tags(name, sort_order) VALUES
  ('商业', 0), ('🎨', 1), ('设计', 2);
