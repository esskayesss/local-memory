import type { Database } from "bun:sqlite";

import { nowIso } from "../db/client";
import type { BagPolicy, MemoryKind } from "../types";

const KINDS: MemoryKind[] = [
  "summary",
  "preference",
  "constraint",
  "decision",
  "fact",
  "note",
];

const PROTECTED_BAGS = new Set(["session-summaries", "coding-style", "life-preferences"]);

function normalizeKinds(input: unknown): MemoryKind[] {
  if (!Array.isArray(input)) return [];
  const filtered = input.filter((kind): kind is MemoryKind =>
    typeof kind === "string" && KINDS.includes(kind as MemoryKind),
  );
  return [...new Set(filtered)];
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || Number.isNaN(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

function mapBagRow(row: Record<string, unknown>): BagPolicy {
  return {
    name: String(row.name),
    description: row.description === null ? null : String(row.description),
    defaultTopK: Number(row.default_top_k),
    recencyHalfLifeDays: Number(row.recency_half_life_days),
    importanceWeight: Number(row.importance_weight),
    allowedKinds: normalizeKinds(JSON.parse(String(row.allowed_kinds_json))),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function listBags(db: Database): BagPolicy[] {
  const rows = db
    .query(
      `SELECT name, description, default_top_k, recency_half_life_days, importance_weight, allowed_kinds_json, created_at, updated_at
       FROM bags ORDER BY name ASC`,
    )
    .all() as Record<string, unknown>[];

  return rows.map(mapBagRow);
}

export function getBagPolicy(db: Database, bag: string): BagPolicy | null {
  const row = db
    .query(
      `SELECT name, description, default_top_k, recency_half_life_days, importance_weight, allowed_kinds_json, created_at, updated_at
       FROM bags WHERE name = ?`,
    )
    .get(bag) as Record<string, unknown> | null;

  if (!row) return null;
  return mapBagRow(row);
}

export function upsertBag(
  db: Database,
  input: {
    name: string;
    description?: string | null;
    defaultTopK?: number;
    recencyHalfLifeDays?: number;
    importanceWeight?: number;
    allowedKinds?: MemoryKind[];
  },
): BagPolicy {
  const existing = getBagPolicy(db, input.name);
  const now = nowIso();

  const next = {
    name: input.name,
    description: input.description ?? existing?.description ?? null,
    defaultTopK: clampNumber(input.defaultTopK, existing?.defaultTopK ?? 8, 1, 100),
    recencyHalfLifeDays: clampNumber(
      input.recencyHalfLifeDays,
      existing?.recencyHalfLifeDays ?? 30,
      1,
      3650,
    ),
    importanceWeight: clampNumber(input.importanceWeight, existing?.importanceWeight ?? 0.35, 0, 2),
    allowedKinds: normalizeKinds(input.allowedKinds ?? existing?.allowedKinds ?? []),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  db.query(
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
    ON CONFLICT(name) DO UPDATE SET
      description = excluded.description,
      default_top_k = excluded.default_top_k,
      recency_half_life_days = excluded.recency_half_life_days,
      importance_weight = excluded.importance_weight,
      allowed_kinds_json = excluded.allowed_kinds_json,
      updated_at = excluded.updated_at
  `,
  ).run(
    next.name,
    next.description,
    next.defaultTopK,
    next.recencyHalfLifeDays,
    next.importanceWeight,
    JSON.stringify(next.allowedKinds),
    next.createdAt,
    next.updatedAt,
  );

  return getBagPolicy(db, input.name)!;
}

export function deleteBag(
  db: Database,
  input: {
    name: string;
    force?: boolean;
    allowSystem?: boolean;
  },
): { deleted: boolean; name: string; deletedMemories: number } {
  const name = input.name.trim();
  if (!name) throw new Error("name is required");

  const existing = getBagPolicy(db, name);
  if (!existing) {
    return { deleted: false, name, deletedMemories: 0 };
  }

  if (PROTECTED_BAGS.has(name) && !input.allowSystem) {
    throw new Error(`bag '${name}' is protected; set allowSystem=true to delete`);
  }

  const row = db
    .query(`SELECT COUNT(1) as count FROM memories WHERE bag = ?`)
    .get(name) as { count: number } | null;
  const memoryCount = Number(row?.count ?? 0);

  if (memoryCount > 0 && !input.force) {
    throw new Error(`bag '${name}' has ${memoryCount} memories; set force=true to delete`);
  }

  const runDelete = db.transaction((bagName: string, shouldDeleteMemories: boolean) => {
    if (shouldDeleteMemories) {
      db.query(`DELETE FROM memories WHERE bag = ?`).run(bagName);
    }
    return db.query(`DELETE FROM bags WHERE name = ?`).run(bagName) as { changes?: number };
  });

  const result = runDelete(name, memoryCount > 0);
  return {
    deleted: Number(result.changes ?? 0) > 0,
    name,
    deletedMemories: memoryCount,
  };
}
