import type { Database } from "bun:sqlite";

import { getBagPolicy } from "../bags/service";
import { config } from "../config";
import { nowIso } from "../db/client";
import { createEmbedding } from "../embeddings/provider";
import type { MemoryRecord, RecallMemoryInput, RecallResult } from "../types";
import { cosineSimilarity, importanceBoost, recencyBoost, tagBoost } from "./scoring";

interface CandidateRow {
  id: string;
  bag: string;
  kind: string;
  content: string;
  tags_json: string;
  importance: number;
  source_json: string;
  created_at: string;
  updated_at: string;
  last_accessed_at: string | null;
  expires_at: string | null;
  embedding_json: string;
  embedding_norm: number;
}

function toRecord(row: CandidateRow): MemoryRecord {
  return {
    id: row.id,
    bag: row.bag,
    kind: row.kind as MemoryRecord["kind"],
    content: row.content,
    tags: JSON.parse(row.tags_json),
    importance: row.importance,
    source: JSON.parse(row.source_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastAccessedAt: row.last_accessed_at,
    expiresAt: row.expires_at,
  };
}

function parseTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => String(entry).trim()).filter(Boolean);
}

function buildFilterQuery(input: RecallMemoryInput, candidateLimit: number): { sql: string; params: unknown[] } {
  const conditions: string[] = ["(m.expires_at IS NULL OR m.expires_at > ?)"];
  const params: unknown[] = [nowIso()];

  if (input.bag) {
    conditions.push("m.bag = ?");
    params.push(input.bag);
  }
  if (Array.isArray(input.kinds) && input.kinds.length > 0) {
    const placeholders = input.kinds.map(() => "?").join(", ");
    conditions.push(`m.kind IN (${placeholders})`);
    params.push(...input.kinds);
  }

  const sql = `
    SELECT
      m.id,
      m.bag,
      m.kind,
      m.content,
      m.tags_json,
      m.importance,
      m.source_json,
      m.created_at,
      m.updated_at,
      m.last_accessed_at,
      m.expires_at,
      v.embedding_json,
      v.embedding_norm
    FROM memories m
    JOIN memory_vectors v ON v.memory_id = m.id
    WHERE ${conditions.join(" AND ")}
    ORDER BY m.created_at DESC
    LIMIT ?
  `;

  params.push(candidateLimit);
  return { sql, params };
}

export async function recallMemories(db: Database, input: RecallMemoryInput): Promise<RecallResult[]> {
  const query = input.query?.trim();
  if (!query) throw new Error("query is required");

  const queryEmbedding = await createEmbedding(query);
  const queryTags = parseTags(input.tags);

  const bagPolicy = input.bag ? getBagPolicy(db, input.bag) : null;
  const topK = Math.max(1, Math.min(100, input.topK ?? bagPolicy?.defaultTopK ?? 8));
  const candidateLimit = Math.max(
    topK,
    Math.min(5000, input.candidateLimit ?? config.defaultCandidateLimit),
  );

  const { sql, params } = buildFilterQuery(input, candidateLimit);
  const rows = db.query(sql).all(...params) as CandidateRow[];

  const filteredRows = rows.filter((row) => {
    if (queryTags.length === 0) return true;
    const memoryTags = parseTags(JSON.parse(row.tags_json));
    return queryTags.some((queryTag) =>
      memoryTags.some((memoryTag) => memoryTag.toLowerCase() === queryTag.toLowerCase()),
    );
  });

  const ranked = filteredRows
    .map((row) => {
      const memory = toRecord(row);
      const embedding = JSON.parse(row.embedding_json) as number[];

      const similarity = cosineSimilarity(queryEmbedding, embedding, row.embedding_norm);
      const policy = getBagPolicy(db, memory.bag) ?? {
        name: memory.bag,
        description: null,
        defaultTopK: 8,
        recencyHalfLifeDays: 30,
        importanceWeight: 0.35,
        allowedKinds: [],
        createdAt: memory.createdAt,
        updatedAt: memory.updatedAt,
      };

      const recency = recencyBoost(memory.createdAt, policy.recencyHalfLifeDays);
      const importance = importanceBoost(memory.importance, policy);
      const tag = tagBoost(queryTags, memory.tags);
      const score = similarity + recency + importance + tag;

      return {
        memory,
        score,
        scoreBreakdown: {
          similarity,
          recencyBoost: recency,
          importanceBoost: importance,
          tagBoost: tag,
        },
      } satisfies RecallResult;
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  const now = nowIso();
  const markStmt = db.query(`UPDATE memories SET last_accessed_at = ? WHERE id = ?`);
  for (const item of ranked) markStmt.run(now, item.memory.id);

  return ranked;
}
