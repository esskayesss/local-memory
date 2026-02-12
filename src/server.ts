import { getDb } from "./db/client";
import { deleteBag, listBags, upsertBag } from "./bags/service";
import { deleteMemory, storeMemory, updateMemory } from "./memory/store";
import { recallMemories } from "./memory/recall";
import { config } from "./config";
import type { MemoryKind } from "./types";
import { handleMcpRequest } from "./mcp";

const SUPPORTED_KINDS = new Set(["summary", "preference", "constraint", "decision", "fact", "note"]);

interface AuditMemoryRow {
  id: string;
  bag: string;
  kind: MemoryKind;
  content: string;
  tagsJson: string;
  importance: number;
  sourceJson: string;
  createdAt: string;
  updatedAt: string;
  lastAccessedAt: string | null;
  expiresAt: string | null;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function parseJsonArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((value) => String(value));
  } catch {
    return [];
  }
}

function prettyJson(raw: string): string {
  try {
    const parsed = JSON.parse(raw);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return raw;
  }
}

function renderAuditPage(db: ReturnType<typeof getDb>): string {
  const bags = listBags(db);
  const memoryRows = db
    .query(
      `SELECT id, bag, kind, content, tags_json, importance, source_json, created_at, updated_at, last_accessed_at, expires_at
       FROM memories
       ORDER BY bag ASC, created_at DESC`,
    )
    .all() as Record<string, unknown>[];

  const memories = memoryRows.map((row) => {
    return {
      id: String(row.id),
      bag: String(row.bag),
      kind: String(row.kind) as MemoryKind,
      content: String(row.content),
      tagsJson: String(row.tags_json),
      importance: Number(row.importance),
      sourceJson: String(row.source_json),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      lastAccessedAt: row.last_accessed_at ? String(row.last_accessed_at) : null,
      expiresAt: row.expires_at ? String(row.expires_at) : null,
    } satisfies AuditMemoryRow;
  });

  const memoryByBag = new Map<string, AuditMemoryRow[]>();
  for (const memory of memories) {
    const list = memoryByBag.get(memory.bag) ?? [];
    list.push(memory);
    memoryByBag.set(memory.bag, list);
  }

  const totalExpired = memories.filter((memory) => memory.expiresAt && memory.expiresAt <= new Date().toISOString()).length;

  const sections = bags
    .map((bag) => {
      const bagMemories = memoryByBag.get(bag.name) ?? [];
      const kindCounts = new Map<string, number>();
      for (const memory of bagMemories) {
        kindCounts.set(memory.kind, (kindCounts.get(memory.kind) ?? 0) + 1);
      }
      const kindSummary = [...kindCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([kind, count]) => `${kind} (${count})`)
        .join(" • ");

      const memoryCards =
        bagMemories.length === 0
          ? `<p class="empty">No memories stored in this bag.</p>`
          : bagMemories
              .map((memory) => {
                const tags = parseJsonArray(memory.tagsJson);
                const source = prettyJson(memory.sourceJson);
                return `
                <article class="memory" data-kind="${escapeHtml(memory.kind)}">
                  <div class="memory-head">
                    <span class="pill kind">${escapeHtml(memory.kind)}</span>
                    <span class="pill importance">importance ${memory.importance}</span>
                    <span class="id">${escapeHtml(memory.id)}</span>
                  </div>
                  <p class="content">${escapeHtml(memory.content)}</p>
                  <div class="meta">
                    <span>created ${escapeHtml(memory.createdAt)}</span>
                    <span>updated ${escapeHtml(memory.updatedAt)}</span>
                    <span>last accessed ${escapeHtml(memory.lastAccessedAt ?? "never")}</span>
                    <span>expires ${escapeHtml(memory.expiresAt ?? "never")}</span>
                  </div>
                  <div class="tags">
                    ${tags.length > 0 ? tags.map((tag) => `<span class="pill tag">${escapeHtml(tag)}</span>`).join("") : `<span class="muted">no tags</span>`}
                  </div>
                  <details>
                    <summary>source json</summary>
                    <pre>${escapeHtml(source)}</pre>
                  </details>
                </article>
              `;
              })
              .join("\n");

      return `
      <section class="bag" data-bag-name="${escapeHtml(bag.name)}" data-bag-description="${escapeHtml(bag.description ?? "")}">
        <header>
          <h2>${escapeHtml(bag.name)}</h2>
          <p>${escapeHtml(bag.description ?? "No description")}</p>
          <div class="stats">
            <span class="pill">${bagMemories.length} memories</span>
            <span class="pill">defaultTopK ${bag.defaultTopK}</span>
            <span class="pill">recencyHalfLifeDays ${bag.recencyHalfLifeDays}</span>
            <span class="pill">importanceWeight ${bag.importanceWeight}</span>
          </div>
          <div class="stats">
            <span class="pill">allowed kinds: ${escapeHtml(bag.allowedKinds.length > 0 ? bag.allowedKinds.join(", ") : "all")}</span>
            <span class="pill">kinds present: ${escapeHtml(kindSummary || "none")}</span>
          </div>
        </header>
        <div class="memory-list">${memoryCards}</div>
      </section>
    `;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Local RAG Memory Audit</title>
    <style>
      :root {
        --bg: #f3f7f4;
        --ink: #13211a;
        --ink-soft: #395247;
        --surface: #ffffff;
        --line: #d7e2db;
        --accent: #0a8f62;
        --accent-soft: #e3f6ee;
        --warn: #a84a1a;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
        color: var(--ink);
        background: radial-gradient(circle at 15% 0%, #d8efe4 0%, #edf4f0 42%, #f6f8f7 100%);
      }
      main {
        max-width: 1120px;
        margin: 0 auto;
        padding: 28px 18px 40px;
      }
      h1, h2 {
        margin: 0;
        font-family: "Space Grotesk", "Avenir Next", sans-serif;
      }
      h1 { font-size: clamp(1.4rem, 3vw, 2.2rem); }
      h2 { font-size: 1.2rem; }
      .top {
        background: linear-gradient(130deg, #e8f8f0, #f7fcfa 52%, #ffffff);
        border: 1px solid var(--line);
        border-radius: 14px;
        padding: 16px;
        margin-bottom: 18px;
      }
      .top p { margin: 8px 0 0; color: var(--ink-soft); }
      .overview {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
        gap: 10px;
        margin-top: 14px;
      }
      .metric {
        border: 1px solid var(--line);
        background: var(--surface);
        border-radius: 10px;
        padding: 10px;
      }
      .metric strong { display: block; font-size: 1.2rem; }
      .controls {
        margin: 14px 0 22px;
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
      }
      .controls input {
        flex: 1;
        min-width: 220px;
        border: 1px solid var(--line);
        border-radius: 10px;
        padding: 10px 12px;
        font: inherit;
      }
      .bag {
        border: 1px solid var(--line);
        background: var(--surface);
        border-radius: 14px;
        padding: 14px;
        margin-bottom: 14px;
      }
      .bag header p {
        margin: 6px 0 10px;
        color: var(--ink-soft);
      }
      .stats {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        margin-bottom: 8px;
      }
      .pill {
        border-radius: 999px;
        padding: 3px 10px;
        font-size: 0.82rem;
        border: 1px solid var(--line);
        background: #fbfdfb;
      }
      .memory-list {
        display: grid;
        gap: 10px;
      }
      .memory {
        border: 1px solid var(--line);
        border-radius: 10px;
        padding: 10px;
        background: #fcfffd;
      }
      .memory-head {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
      }
      .kind { background: var(--accent-soft); border-color: #b9e8d2; }
      .importance { border-color: #f1c29d; color: var(--warn); }
      .id { margin-left: auto; color: #637a70; font-size: 0.78rem; }
      .content { margin: 10px 0; line-height: 1.45; white-space: pre-wrap; }
      .meta {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
        gap: 6px;
        color: #4b6157;
        font-size: 0.84rem;
      }
      .tags { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 9px; }
      .tag { background: #f8faf9; }
      .muted { color: #6e8379; font-size: 0.84rem; }
      details { margin-top: 8px; }
      summary { cursor: pointer; color: #295645; }
      pre {
        margin: 8px 0 0;
        background: #f4faf6;
        border: 1px solid var(--line);
        border-radius: 8px;
        padding: 8px;
        overflow: auto;
        font-size: 0.8rem;
      }
      .empty {
        color: #5d7269;
        font-style: italic;
      }
      .hidden { display: none; }
    </style>
  </head>
  <body>
    <main>
      <section class="top">
        <h1>Local RAG Memory Audit</h1>
        <p>Inspect every bag and memory currently stored in this instance.</p>
        <div class="overview">
          <div class="metric"><strong>${bags.length}</strong>bags</div>
          <div class="metric"><strong>${memories.length}</strong>memories</div>
          <div class="metric"><strong>${totalExpired}</strong>expired by timestamp</div>
        </div>
      </section>

      <section class="controls">
        <input id="bag-filter" type="search" placeholder="Filter by bag name or description" />
        <input id="memory-filter" type="search" placeholder="Filter memories by content" />
      </section>

      ${sections || `<section class="bag"><p class="empty">No bags found. Create a bag to begin storing memories.</p></section>`}
    </main>

    <script>
      const bagFilter = document.getElementById("bag-filter");
      const memoryFilter = document.getElementById("memory-filter");
      const bags = Array.from(document.querySelectorAll(".bag"));

      function applyFilter() {
        const bagNeedle = (bagFilter.value || "").toLowerCase();
        const memoryNeedle = (memoryFilter.value || "").toLowerCase();

        for (const bag of bags) {
          const name = (bag.dataset.bagName || "").toLowerCase();
          const description = (bag.dataset.bagDescription || "").toLowerCase();
          const bagMatches = !bagNeedle || name.includes(bagNeedle) || description.includes(bagNeedle);

          let visibleMemories = 0;
          const memoryCards = bag.querySelectorAll(".memory");
          for (const card of memoryCards) {
            const text = (card.textContent || "").toLowerCase();
            const memoryMatches = !memoryNeedle || text.includes(memoryNeedle);
            card.classList.toggle("hidden", !memoryMatches);
            if (memoryMatches) visibleMemories += 1;
          }

          const hasAnyMemoryOrNoMemoryCards = memoryCards.length === 0 || visibleMemories > 0;
          bag.classList.toggle("hidden", !(bagMatches && hasAnyMemoryOrNoMemoryCards));
        }
      }

      bagFilter?.addEventListener("input", applyFilter);
      memoryFilter?.addEventListener("input", applyFilter);
    </script>
  </body>
</html>`;
}

function parseKinds(input: unknown): MemoryKind[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const kinds = input
    .map((kind) => String(kind))
    .filter((kind): kind is MemoryKind => SUPPORTED_KINDS.has(kind));
  return [...new Set(kinds)];
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function badRequest(message: string): Response {
  return json({ error: message }, 400);
}

async function parseJson(request: Request): Promise<Record<string, unknown>> {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    throw new Error("Invalid JSON body");
  }
}

export function startServer(): void {
  const db = getDb();

  Bun.serve({
    hostname: config.host,
    port: config.port,
    idleTimeout: 30,
    routes: {
      "/health": {
        GET: () =>
          json({
            ok: true,
            service: "local-rag-memory",
            embeddingModel: config.embeddingModel,
            ollamaUrl: config.ollamaUrl,
            mcpEndpoint: `http://${config.host}:${config.port}/mcp`,
            timestamp: new Date().toISOString(),
          }),
      },
      "/": {
        GET: () =>
          new Response(renderAuditPage(db), {
            headers: { "content-type": "text/html; charset=utf-8" },
          }),
      },
      "/bags": {
        GET: () => json({ bags: listBags(db) }),
      },
      "/bags/upsert": {
        POST: async (request) => {
          try {
            const body = await parseJson(request);
            const name = String(body.name ?? "").trim();
            if (!name) return badRequest("name is required");

            const bag = upsertBag(db, {
              name,
              description:
                body.description === undefined
                  ? undefined
                  : body.description === null
                    ? null
                    : String(body.description),
              defaultTopK: typeof body.defaultTopK === "number" ? body.defaultTopK : undefined,
              recencyHalfLifeDays:
                typeof body.recencyHalfLifeDays === "number" ? body.recencyHalfLifeDays : undefined,
              importanceWeight:
                typeof body.importanceWeight === "number" ? body.importanceWeight : undefined,
              allowedKinds: Array.isArray(body.allowedKinds)
                ? body.allowedKinds.map((kind) => String(kind))
                : undefined,
            });

            return json({ bag }, 200);
          } catch (error) {
            return badRequest(error instanceof Error ? error.message : "Failed to upsert bag");
          }
        },
      },
      "/bags/delete": {
        POST: async (request) => {
          try {
            const body = await parseJson(request);
            const name = String(body.name ?? "").trim();
            if (!name) return badRequest("name is required");

            const result = deleteBag(db, {
              name,
              force: Boolean(body.force),
              allowSystem: Boolean(body.allowSystem),
            });
            return json(result);
          } catch (error) {
            return badRequest(error instanceof Error ? error.message : "Failed to delete bag");
          }
        },
      },
      "/memories/store": {
        POST: async (request) => {
          try {
            const body = await parseJson(request);
            const memory = await storeMemory(db, {
              bag: String(body.bag ?? ""),
              kind: String(body.kind ?? "note") as MemoryKind,
              content: String(body.content ?? ""),
              tags: Array.isArray(body.tags) ? body.tags.map((tag) => String(tag)) : [],
              importance: typeof body.importance === "number" ? body.importance : undefined,
              source:
                body.source && typeof body.source === "object"
                  ? (body.source as Record<string, unknown>)
                  : {},
              expiresAt:
                body.expiresAt === undefined
                  ? null
                  : body.expiresAt === null
                    ? null
                    : String(body.expiresAt),
            });
            return json({ memory }, 201);
          } catch (error) {
            return badRequest(error instanceof Error ? error.message : "Failed to store memory");
          }
        },
      },
      "/memories/recall": {
        POST: async (request) => {
          try {
            const body = await parseJson(request);
            const memories = await recallMemories(db, {
              query: String(body.query ?? ""),
              bag: body.bag ? String(body.bag) : undefined,
              kinds: parseKinds(body.kinds),
              tags: Array.isArray(body.tags) ? body.tags.map((tag) => String(tag)) : undefined,
              topK: typeof body.topK === "number" ? body.topK : undefined,
              candidateLimit:
                typeof body.candidateLimit === "number" ? body.candidateLimit : undefined,
            });
            return json({ memories });
          } catch (error) {
            return badRequest(error instanceof Error ? error.message : "Failed to recall memory");
          }
        },
      },
      "/memories/update": {
        POST: async (request) => {
          try {
            const body = await parseJson(request);
            const id = String(body.id ?? "").trim();
            if (!id) return badRequest("id is required");

            const memory = await updateMemory(db, {
              id,
              content: body.content === undefined ? undefined : String(body.content),
              tags: Array.isArray(body.tags) ? body.tags.map((tag) => String(tag)) : undefined,
              importance: typeof body.importance === "number" ? body.importance : undefined,
              source:
                body.source && typeof body.source === "object"
                  ? (body.source as Record<string, unknown>)
                  : undefined,
              expiresAt:
                body.expiresAt === undefined
                  ? undefined
                  : body.expiresAt === null
                    ? null
                    : String(body.expiresAt),
            });
            return json({ memory });
          } catch (error) {
            return badRequest(error instanceof Error ? error.message : "Failed to update memory");
          }
        },
      },
      "/memories/delete": {
        POST: async (request) => {
          try {
            const body = await parseJson(request);
            const id = String(body.id ?? "").trim();
            if (!id) return badRequest("id is required");

            return json(deleteMemory(db, id));
          } catch (error) {
            return badRequest(error instanceof Error ? error.message : "Failed to delete memory");
          }
        },
      },
    },
    fetch: async (request) => {
      const url = new URL(request.url);
      if (url.pathname === "/mcp") {
        try {
          return await handleMcpRequest(request);
        } catch (error) {
          return json(
            {
              jsonrpc: "2.0",
              error: {
                code: -32603,
                message: error instanceof Error ? error.message : "MCP server error",
              },
              id: null,
            },
            500,
          );
        }
      }

      return json({ error: "not_found" }, 404);
    },
  });

  console.log(`Server running at http://${config.host}:${config.port}`);
}

if (import.meta.main) {
  startServer();
}
