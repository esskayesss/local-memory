import { describe, expect, test } from "bun:test";

import { cosineSimilarity, recencyBoost, tagBoost, vectorNorm } from "../src/memory/scoring";

describe("scoring utilities", () => {
  test("vector norm computes correctly", () => {
    expect(vectorNorm([3, 4])).toBe(5);
  });

  test("cosine similarity works for identical vectors", () => {
    const score = cosineSimilarity([1, 2, 3], [1, 2, 3]);
    expect(score).toBeCloseTo(1, 6);
  });

  test("tag boost increases with overlap", () => {
    const low = tagBoost(["bun"], ["typescript"]);
    const high = tagBoost(["bun", "typescript"], ["bun", "typescript"]);
    expect(low).toBe(0);
    expect(high).toBeGreaterThan(0);
  });

  test("recency boost favors newer memories", () => {
    const now = new Date().toISOString();
    const old = new Date(Date.now() - 1000 * 60 * 60 * 24 * 60).toISOString();
    expect(recencyBoost(now, 30)).toBeGreaterThan(recencyBoost(old, 30));
  });
});
