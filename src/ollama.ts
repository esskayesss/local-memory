import { config } from "./config";

async function fetchJson(path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`${config.ollamaUrl}${path}`, init);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Ollama request failed (${res.status}): ${text}`);
  }
  return res.json();
}

export async function waitForOllama(timeoutMs = config.ollamaTimeoutMs): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await fetchJson("/api/tags");
      return;
    } catch {
      await Bun.sleep(1000);
    }
  }
  throw new Error(`Timed out waiting for Ollama after ${timeoutMs}ms`);
}

export async function ensureOllamaModel(modelName: string): Promise<void> {
  const payload = (await fetchJson("/api/tags")) as {
    models?: Array<{ name?: string; model?: string }>;
  };

  const hasModel = (payload.models ?? []).some((model) => {
    const names = [model.name, model.model].filter(Boolean) as string[];
    return names.some((name) => name === modelName || name.startsWith(`${modelName}:`));
  });

  if (hasModel) return;

  const pullRes = await fetch(`${config.ollamaUrl}/api/pull`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: modelName, stream: false }),
  });

  if (!pullRes.ok) {
    const text = await pullRes.text();
    throw new Error(`Failed to pull Ollama model '${modelName}': ${text}`);
  }
}
