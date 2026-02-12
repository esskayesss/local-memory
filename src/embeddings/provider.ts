import { embed } from "ai";
import { createOllama } from "ai-sdk-ollama";

import { config } from "../config";

const ollama = createOllama({
  baseURL: config.ollamaUrl,
});

export async function createEmbedding(text: string): Promise<number[]> {
  const normalized = text.trim();
  if (!normalized) throw new Error("Cannot embed empty text.");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.ollamaTimeoutMs);

  try {
    const result = await embed({
      model: ollama.embedding(config.embeddingModel),
      value: normalized,
      abortSignal: controller.signal,
    });
    return result.embedding;
  } finally {
    clearTimeout(timeout);
  }
}
