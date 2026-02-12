PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS bags (
  name TEXT PRIMARY KEY,
  description TEXT,
  default_top_k INTEGER NOT NULL DEFAULT 8,
  recency_half_life_days REAL NOT NULL DEFAULT 30,
  importance_weight REAL NOT NULL DEFAULT 0.35,
  allowed_kinds_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  bag TEXT NOT NULL,
  kind TEXT NOT NULL,
  content TEXT NOT NULL,
  tags_json TEXT NOT NULL,
  importance INTEGER NOT NULL DEFAULT 3,
  source_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_accessed_at TEXT,
  expires_at TEXT,
  FOREIGN KEY (bag) REFERENCES bags(name)
);

CREATE INDEX IF NOT EXISTS idx_memories_bag ON memories(bag);
CREATE INDEX IF NOT EXISTS idx_memories_kind ON memories(kind);
CREATE INDEX IF NOT EXISTS idx_memories_created_at ON memories(created_at);
CREATE INDEX IF NOT EXISTS idx_memories_expires_at ON memories(expires_at);

CREATE TABLE IF NOT EXISTS memory_vectors (
  memory_id TEXT PRIMARY KEY,
  embedding_json TEXT NOT NULL,
  embedding_model TEXT NOT NULL,
  embedding_dim INTEGER NOT NULL,
  embedding_norm REAL NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE
);
