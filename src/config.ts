function parseNumber(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (!value) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

export const config = {
  host: process.env.HOST ?? "0.0.0.0",
  port: parseNumber(process.env.PORT, 8787),
  dbPath: process.env.DB_PATH ?? "./data/sqlite/memory.db",
  ollamaUrl: process.env.OLLAMA_URL ?? "http://ollama:11434",
  embeddingModel: process.env.EMBEDDING_MODEL ?? "nomic-embed-text",
  ollamaTimeoutMs: parseNumber(process.env.OLLAMA_TIMEOUT_MS, 120000),
  autoPullModel: parseBool(process.env.AUTO_PULL_MODEL, true),
  defaultCandidateLimit: parseNumber(process.env.DEFAULT_CANDIDATE_LIMIT, 600),
};
