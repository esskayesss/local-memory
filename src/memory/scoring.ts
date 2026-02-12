import type { BagPolicy } from "../types";

export function vectorNorm(values: number[]): number {
  let sum = 0;
  for (const value of values) sum += value * value;
  return Math.sqrt(sum);
}

export function cosineSimilarity(a: number[], b: number[], bNorm?: number): number {
  if (a.length !== b.length) return -1;
  const aNorm = vectorNorm(a);
  const rightNorm = bNorm ?? vectorNorm(b);
  if (aNorm === 0 || rightNorm === 0) return 0;

  let dot = 0;
  for (let i = 0; i < a.length; i += 1) dot += a[i] * b[i];
  return dot / (aNorm * rightNorm);
}

export function recencyBoost(createdAtIso: string, halfLifeDays: number): number {
  const createdAt = new Date(createdAtIso).getTime();
  if (Number.isNaN(createdAt)) return 0;

  const ageMs = Date.now() - createdAt;
  if (ageMs <= 0) return 0.15;

  const halfLifeMs = halfLifeDays * 24 * 60 * 60 * 1000;
  if (halfLifeMs <= 0) return 0;

  const decay = Math.pow(0.5, ageMs / halfLifeMs);
  return decay * 0.2;
}

export function importanceBoost(importance: number, policy: BagPolicy): number {
  const normalized = Math.max(1, Math.min(5, importance)) / 5;
  return normalized * policy.importanceWeight;
}

export function tagBoost(queryTags: string[], memoryTags: string[]): number {
  if (queryTags.length === 0 || memoryTags.length === 0) return 0;
  const memorySet = new Set(memoryTags.map((tag) => tag.toLowerCase()));
  let overlap = 0;
  for (const tag of queryTags) {
    if (memorySet.has(tag.toLowerCase())) overlap += 1;
  }
  if (overlap === 0) return 0;
  return Math.min(0.2, overlap * 0.06);
}
