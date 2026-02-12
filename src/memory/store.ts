import { randomUUID } from "node:crypto";
import type { Database } from "bun:sqlite";

import { getBagPolicy } from "../bags/service";
import { config } from "../config";
import { nowIso } from "../db/client";
import { createEmbedding } from "../embeddings/provider";
import type { MemoryRecord, StoreMemoryInput } from "../types";
import { vectorNorm } from "./scoring";

const SUPPORTED_KINDS = new Set(["summary", "preference", "constraint", "decision", "fact", "note"]);

function parseRecord(row: Record<string, unknown>): MemoryRecord {
  return {
    id: String(row.id),
    bag: String(row.bag),
    kind: String(row.kind) as MemoryRecord["kind"],
    content: String(row.content),
    tags: JSON.parse(String(row.tags_json)),
    importance: Number(row.importance),
    source: JSON.parse(String(row.source_json)),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    lastAccessedAt: row.last_accessed_at ? String(row.last_accessed_at) : null,
    expiresAt: row.expires_at ? String(row.expires_at) : null,
  };
}

function sanitizeInput(input: StoreMemoryInput): StoreMemoryInput {
  return {
    bag: input.bag.trim(),
    kind: input.kind,
    content: input.content.trim(),
    tags: (input.tags ?? []).map((tag) => tag.trim()).filter(Boolean),
    importance: Math.max(1, Math.min(5, input.importance ?? 3)),
    source: input.source ?? {},
    expiresAt: input.expiresAt ?? null,
  };
}

export async function storeMemory(db: Database, input: StoreMemoryInput): Promise<MemoryRecord> {
  const sanitized = sanitizeInput(input);
  if (!sanitized.bag) throw new Error("bag is required");
  if (!sanitized.content) throw new Error("content is required");
  if (!SUPPORTED_KINDS.has(sanitized.kind)) {
    throw new Error(`unsupported kind: ${sanitized.kind}`);
  }

  const bag = getBagPolicy(db, sanitized.bag);
  if (!bag) throw new Error(`unknown bag: ${sanitized.bag}`);
  if (bag.allowedKinds.length > 0 && !bag.allowedKinds.includes(sanitized.kind)) {
    throw new Error(`kind '${sanitized.kind}' is not allowed in bag '${sanitized.bag}'`);
  }

  const embedding = await createEmbedding(sanitized.content);
  const now = nowIso();
  const id = randomUUID();

  const tx = db.transaction(() => {
    db.query(
      `
      INSERT INTO memories (
        id, bag, kind, content, tags_json, importance, source_json,
        created_at, updated_at, last_accessed_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    ).run(
      id,
      sanitized.bag,
      sanitized.kind,
      sanitized.content,
      JSON.stringify(sanitized.tags),
      sanitized.importance,
      JSON.stringify(sanitized.source),
      now,
      now,
      null,
      sanitized.expiresAt,
    );

    db.query(
      `
      INSERT INTO memory_vectors (
        memory_id, embedding_json, embedding_model, embedding_dim, embedding_norm, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    ).run(
      id,
      JSON.stringify(embedding),
      config.embeddingModel,
      embedding.length,
      vectorNorm(embedding),
      now,
      now,
    );
  });

  tx();

  const row = db
    .query(
      `
      SELECT id, bag, kind, content, tags_json, importance, source_json, created_at, updated_at, last_accessed_at, expires_at
      FROM memories WHERE id = ?
    `,
    )
    .get(id) as Record<string, unknown> | null;

  if (!row) throw new Error("failed to fetch stored memory");
  return parseRecord(row);
}

export async function updateMemory(
  db: Database,
  input: {
    id: string;
    content?: string;
    tags?: string[];
    importance?: number;
    source?: Record<string, unknown>;
    expiresAt?: string | null;
  },
): Promise<MemoryRecord> {
  const existing = db
    .query(
      `SELECT id, bag, kind, content, tags_json, importance, source_json, created_at, updated_at, last_accessed_at, expires_at
       FROM memories WHERE id = ?`,
    )
    .get(input.id) as Record<string, unknown> | null;

  if (!existing) throw new Error(`memory not found: ${input.id}`);

  const nextContent = input.content?.trim() ?? String(existing.content);
  const nextTags = input.tags
    ? input.tags.map((tag) => tag.trim()).filter(Boolean)
    : (JSON.parse(String(existing.tags_json)) as string[]);
  const nextImportance = Math.max(1, Math.min(5, input.importance ?? Number(existing.importance)));
  const nextSource = input.source ?? (JSON.parse(String(existing.source_json)) as Record<string, unknown>);
  const nextExpiresAt = input.expiresAt === undefined ? (existing.expires_at as string | null) : input.expiresAt;
  const now = nowIso();
  const nextEmbedding = input.content !== undefined ? await createEmbedding(nextContent) : null;

  const tx = db.transaction(() => {
    db.query(
      `
      UPDATE memories
      SET content = ?, tags_json = ?, importance = ?, source_json = ?, updated_at = ?, expires_at = ?
      WHERE id = ?
    `,
    ).run(
      nextContent,
      JSON.stringify(nextTags),
      nextImportance,
      JSON.stringify(nextSource),
      now,
      nextExpiresAt,
      input.id,
    );

    if (nextEmbedding) {
      db.query(
        `
        UPDATE memory_vectors
        SET embedding_json = ?, embedding_model = ?, embedding_dim = ?, embedding_norm = ?, updated_at = ?
        WHERE memory_id = ?
      `,
      ).run(
        JSON.stringify(nextEmbedding),
        config.embeddingModel,
        nextEmbedding.length,
        vectorNorm(nextEmbedding),
        now,
        input.id,
      );
    }
  });

  tx();

  const next = db
    .query(
      `SELECT id, bag, kind, content, tags_json, importance, source_json, created_at, updated_at, last_accessed_at, expires_at
       FROM memories WHERE id = ?`,
    )
    .get(input.id) as Record<string, unknown> | null;

  if (!next) throw new Error(`memory not found after update: ${input.id}`);
  return parseRecord(next);
}

export function deleteMemory(db: Database, id: string): { deleted: boolean } {
  const result = db.query(`DELETE FROM memories WHERE id = ?`).run(id);
  return { deleted: result.changes > 0 };
}
