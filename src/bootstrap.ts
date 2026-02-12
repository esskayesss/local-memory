import "./db/migrate";

import { config } from "./config";
import { ensureOllamaModel, waitForOllama } from "./ollama";
import { startServer } from "./server";

async function bootstrap(): Promise<void> {
  console.log("Waiting for Ollama...");
  await waitForOllama();

  if (config.autoPullModel) {
    console.log(`Ensuring embedding model '${config.embeddingModel}' is available...`);
    await ensureOllamaModel(config.embeddingModel);
  }

  startServer();
}

bootstrap().catch((error) => {
  console.error("Bootstrap failed:", error);
  process.exit(1);
});
