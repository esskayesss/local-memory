# Local RAG Memory DB

Lightweight local memory service designed for agent takeaways and long-term preferences.

## Important: Local Network Only

This project is intentionally optimized for trusted local environments (home lab, LAN, single host).

- No built-in authentication or authorization
- No TLS termination in-app
- No multi-tenant isolation
- Minimal hardening by design for low-friction local use

Do not expose this service directly to the public internet.

## Features

- Bun + TypeScript single-process API
- SQLite-backed memory store with semantic retrieval
- Local embeddings via Ollama (`nomic-embed-text`) using AI SDK
- Bag-aware organization (`session-summaries`, `coding-style`, `life-preferences`, etc.)
- Safe bag lifecycle operations (`list`, `upsert`, `delete` with guardrails)
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

## Security Model

This service assumes the caller is trusted.

- Intended scope: private local network or local machine
- Threat model: cooperative internal tools and agents
- Not included: user auth, RBAC, API keys, mTLS, audit trails, abuse protections

If you want to run this beyond a trusted LAN, place it behind a proper gateway/reverse proxy and add at least:

1. TLS
2. Authentication (API key or OIDC)
3. Network allowlisting/firewall rules
4. Request logging and rate limiting

## API

### Health

`GET /health`

### MCP

- Streamable HTTP MCP endpoint: `POST/GET/DELETE /mcp`
- Registered tools:
  - `list_bags`
  - `upsert_bag`
  - `delete_bag`
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
- `POST /bags/delete`

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

Delete bag example:

```json
{
  "name": "scratch-space",
  "force": true,
  "allowSystem": false
}
```

Notes:

- Deleting a non-empty bag requires `force: true`.
- Seeded system bags are protected by default and require `allowSystem: true`.

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

## Maintainer and Credits

- Maintainer: `esskayesss` (`imesskayesss@protonmail.com`)
- Built and iterated with OpenCode (`openai/gpt-5.3-codex`) as the coding copilot

If you use this in your own setup, feel free to fork and shape it to your memory workflow.

## Storage

- Memory DB in Docker volume `memory_data`
- Ollama model cache in Docker volume `ollama_data`

These persist across restarts/redeploys.
