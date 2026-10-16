CREATE TABLE IF NOT EXISTS style_cover_blobs (
  style_id INTEGER PRIMARY KEY REFERENCES styles(id) ON DELETE CASCADE,
  mime TEXT NOT NULL,
  bytes BLOB NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Preserve existing public covers without changing any generation references.
-- This is a one-time copy; future cover and reference edits are independent.
INSERT OR IGNORE INTO style_cover_blobs(style_id, mime, bytes)
SELECT r.style_id, r.mime, r.bytes
FROM style_reference_blobs r
WHERE r.id = (
  SELECT first.id FROM style_reference_blobs first
  WHERE first.style_id = r.style_id
  ORDER BY first.sort_order, first.id
  LIMIT 1
);
