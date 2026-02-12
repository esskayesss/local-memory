import { readFileSync } from "node:fs";
import { join } from "node:path";

import { getDb, nowIso } from "./client";

const db = getDb();
const schemaPath = join(import.meta.dir, "schema.sql");
const sql = readFileSync(schemaPath, "utf8");

db.exec(sql);

const defaultBagStmt = db.query(
  `
  INSERT INTO bags (
    name,
    description,
    default_top_k,
    recency_half_life_days,
    importance_weight,
    allowed_kinds_json,
    created_at,
    updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(name) DO NOTHING
`,
);

const timestamp = nowIso();
defaultBagStmt.run(
  "session-summaries",
  "Session-level takeaways and brief summaries.",
  8,
  14,
  0.4,
  JSON.stringify(["summary", "decision", "note"]),
  timestamp,
  timestamp,
);
defaultBagStmt.run(
  "coding-style",
  "User preferences for code style and implementation choices.",
  8,
  120,
  0.45,
  JSON.stringify(["preference", "constraint", "fact", "note"]),
  timestamp,
  timestamp,
);
defaultBagStmt.run(
  "life-preferences",
  "Personal preferences and non-technical context.",
  6,
  180,
  0.5,
  JSON.stringify(["preference", "fact", "note"]),
  timestamp,
  timestamp,
);

console.log("Migrations complete.");
