# Local RAG Memory DB

Lightweight local memory service designed for agent takeaways and long-term preferences.

## Features

- Bun + TypeScript single-process API
- SQLite-backed memory store with semantic retrieval
- Local embeddings via Ollama (`nomic-embed-text`) using AI SDK
- Bag-aware organization (`session-summaries`, `coding-style`, `life-preferences`, etc.)
- One-command deployment with Docker Compose

## One-command deployment (Raspberry Pi / local)

```bash
docker compose up -d --build
```

This will:

1. Start Ollama
2. Build and run the memory API service
3. Auto-run DB migrations
4. Auto-pull `nomic-embed-text` if missing

API is exposed at `http://<host>:8787`.

MCP endpoint is exposed at `http://<host>:8787/mcp`.

## API

### Health

`GET /health`

### MCP

- Streamable HTTP MCP endpoint: `POST/GET/DELETE /mcp`
- Registered tools:
  - `list_bags`
  - `upsert_bag`
  - `store_memory`
  - `recall_memories`
  - `update_memory`
  - `delete_memory`

Example MCP client config (address-based):

```json
{
  "mcpServers": {
    "local-rag": {
      "url": "http://<host>:8787/mcp"
    }
  }
}
```

### Bags

- `GET /bags`
- `POST /bags/upsert`

Example payload:

```json
{
  "name": "session-summaries",
  "description": "Short summaries per conversation",
  "defaultTopK": 8,
  "recencyHalfLifeDays": 14,
  "importanceWeight": 0.4,
  "allowedKinds": ["summary", "decision", "note"]
}
```

### Memories

- `POST /memories/store`
- `POST /memories/recall`
- `POST /memories/update`
- `POST /memories/delete`

Store example:

```json
{
  "bag": "coding-style",
  "kind": "preference",
  "content": "Prefer Bun + TypeScript for local tools.",
  "tags": ["bun", "typescript", "runtime"],
  "importance": 5,
  "source": {
    "sessionId": "abc-123"
  }
}
```

Recall example:

```json
{
  "query": "what stack does the user prefer for local tools?",
  "bag": "coding-style",
  "topK": 5,
  "tags": ["bun"]
}
```

## Local development

```bash
bun install
bun run migrate
bun run dev
```

Use `.env.example` as reference if you want to run outside Docker.

## Storage

- Memory DB in Docker volume `memory_data`
- Ollama model cache in Docker volume `ollama_data`

These persist across restarts/redeploys.
