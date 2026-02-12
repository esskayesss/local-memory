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

function bagAnchorId(name: string): string {
  return `bag-${encodeURIComponent(name)}`;
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

function parseSourceObject(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  } catch {
    return {};
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
        .join(" | ");

      const memoryCards =
        bagMemories.length === 0
          ? `<p class="empty">No memories stored in this bag.</p>`
          : bagMemories
              .map((memory, index) => {
                const tags = parseJsonArray(memory.tagsJson);
                const sourceObject = parseSourceObject(memory.sourceJson);
                const hasSourceFields = Object.keys(sourceObject).length > 0;
                const source = hasSourceFields
                  ? prettyJson(memory.sourceJson)
                  : JSON.stringify(
                      {
                        _note: "No explicit source metadata was provided when this memory was stored.",
                        derived: {
                          id: memory.id,
                          bag: memory.bag,
                          kind: memory.kind,
                          importance: memory.importance,
                          tags,
                          createdAt: memory.createdAt,
                          updatedAt: memory.updatedAt,
                        },
                      },
                      null,
                      2,
                    );
                const hiddenClass = index >= 25 ? " hidden" : "";
                return `
                <article class="memory${hiddenClass}" data-kind="${escapeHtml(memory.kind)}" data-memory-index="${index}">
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
                    <summary>${hasSourceFields ? "source json" : "source metadata (derived)"}</summary>
                    <pre>${escapeHtml(source)}</pre>
                  </details>
                </article>
              `;
              })
              .join("\n");

      const loadMore =
        bagMemories.length > 25
          ? `<button class="load-more" data-bag="${escapeHtml(bag.name)}" type="button">Load more (${bagMemories.length - 25} remaining)</button>`
          : "";

      return `
      <section class="bag" data-bag-name="${escapeHtml(bag.name)}" data-bag-description="${escapeHtml(bag.description ?? "")}" id="${bagAnchorId(bag.name)}">
        <details class="bag-details" ${bagMemories.length > 0 ? "" : "open"}>
          <summary>
            <span class="bag-title">${escapeHtml(bag.name)}</span>
            <span class="pill">${bagMemories.length} memories</span>
            <span class="pill">kinds: ${escapeHtml(kindSummary || "none")}</span>
          </summary>
          <div class="bag-body">
            <p>${escapeHtml(bag.description ?? "No description")}</p>
            <div class="stats">
              <span class="pill">defaultTopK ${bag.defaultTopK}</span>
              <span class="pill">recencyHalfLifeDays ${bag.recencyHalfLifeDays}</span>
              <span class="pill">importanceWeight ${bag.importanceWeight}</span>
              <span class="pill">allowed kinds: ${escapeHtml(bag.allowedKinds.length > 0 ? bag.allowedKinds.join(", ") : "all")}</span>
            </div>
            <div class="memory-list">${memoryCards}</div>
            ${loadMore}
          </div>
        </details>
      </section>
    `;
    })
    .join("\n");

  const bagLinks = bags
    .map((bag) => {
      const count = memoryByBag.get(bag.name)?.length ?? 0;
      return `<a href="#${bagAnchorId(bag.name)}">${escapeHtml(bag.name)} <span>${count}</span></a>`;
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
        --bg: #02040e;
        --ink: #dedfe5;
        --ink-soft: #bdbfcb;
        --surface: #060914;
        --line: #3E4049;
        --error-bg: #f35b4b;
        --error-fg: #4e0e0e;
        --warn-bg: #e3b352;
        --warn-fg: #4e3e0a;
        --success-bg: #aadb71;
        --success-fg: #213829;
        --id-text: #7088e5;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
        color: var(--ink);
        background: radial-gradient(circle at 20% 0%, #0a0d1c 0%, var(--bg) 55%);
      }
      main {
        max-width: 1240px;
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
        background: var(--bg);
        border: 1px solid var(--line);
        border-radius: 0;
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
        background: var(--bg);
        border-radius: 0;
        padding: 10px;
      }
      .metric strong { display: block; font-size: 1.2rem; }
      .layout {
        display: grid;
        grid-template-columns: 250px 1fr;
        gap: 14px;
      }
      .sidebar {
        border: 1px solid var(--line);
        background: var(--bg);
        padding: 12px;
        height: fit-content;
        position: sticky;
        top: 14px;
      }
      .sidebar h3 {
        margin: 0 0 8px;
        font-size: 0.95rem;
        letter-spacing: 0.03em;
        text-transform: uppercase;
        color: var(--ink-soft);
      }
      .sidebar nav {
        display: grid;
        gap: 6px;
        max-height: 70vh;
        overflow: auto;
      }
      .sidebar a {
        display: flex;
        justify-content: space-between;
        gap: 8px;
        text-decoration: none;
        color: var(--ink);
        border: 1px solid var(--line);
        border-left: 3px solid var(--line);
        padding: 7px 8px;
        background: var(--bg);
      }
      .sidebar a span { color: var(--ink-soft); }
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
        border-radius: 0;
        padding: 10px 12px;
        font: inherit;
        color: var(--ink);
        background: var(--bg);
      }
      .bag {
        border: 1px solid var(--line);
        background: var(--bg);
        border-radius: 0;
        padding: 14px;
        margin-bottom: 14px;
      }
      .bag-body p {
        margin: 6px 0 10px;
        color: var(--ink-soft);
      }
      .bag-details summary {
        display: flex;
        align-items: center;
        gap: 8px;
        list-style: none;
        cursor: pointer;
      }
      .bag-details summary::-webkit-details-marker { display: none; }
      .bag-title {
        font-size: 1.05rem;
        font-family: "Space Grotesk", "Avenir Next", sans-serif;
      }
      .bag-body { margin-top: 10px; }
      .stats {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        margin-bottom: 8px;
      }
      .pill {
        border-radius: 0;
        padding: 3px 10px;
        font-size: 0.82rem;
        border: 1px solid var(--line);
        background: var(--bg);
      }
      .memory-list {
        display: grid;
        gap: 10px;
      }
      .memory {
        border: 1px solid var(--line);
        border-radius: 0;
        padding: 10px;
        background: var(--bg);
      }
      .memory-head {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
      }
      .kind { background: var(--bg); border-color: var(--line); color: var(--ink-soft); }
      .importance { background: var(--warn-bg); border-color: var(--warn-bg); color: var(--warn-fg); }
      .id { margin-left: auto; color: var(--id-text); font-size: 0.78rem; }
      .content { margin: 10px 0; line-height: 1.45; white-space: pre-wrap; }
      .meta {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
        gap: 6px;
        color: var(--ink-soft);
        font-size: 0.84rem;
      }
      .tags { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 9px; }
      .tag { background: var(--bg); }
      .muted { color: var(--ink-soft); font-size: 0.84rem; }
      details { margin-top: 8px; }
      summary { cursor: pointer; color: var(--ink-soft); }
      pre {
        margin: 8px 0 0;
        background: var(--surface);
        border: 1px solid var(--line);
        border-radius: 0;
        padding: 8px;
        overflow: auto;
        font-size: 0.8rem;
      }
      .empty {
        color: var(--ink-soft);
        font-style: italic;
      }
      .load-more {
        margin-top: 10px;
        border: 1px solid var(--ink-soft);
        background: var(--ink-soft);
        color: var(--bg);
        padding: 7px 10px;
        font: inherit;
        cursor: pointer;
      }
      .hidden { display: none; }
      @media (max-width: 920px) {
        .layout { grid-template-columns: 1fr; }
        .sidebar {
          position: static;
          max-height: none;
        }
      }
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

      <section class="layout">
        <aside class="sidebar">
          <h3>Bags</h3>
          <nav>
            ${bagLinks || `<span class="muted">No bags available</span>`}
          </nav>
        </aside>
        <div>
          ${sections || `<section class="bag"><p class="empty">No bags found. Create a bag to begin storing memories.</p></section>`}
        </div>
      </section>
    </main>

    <script>
      const bagFilter = document.getElementById("bag-filter");
      const memoryFilter = document.getElementById("memory-filter");
      const bags = Array.from(document.querySelectorAll(".bag"));
      const PAGE_SIZE = 25;

      function refreshLoadMoreButtons() {
        for (const button of document.querySelectorAll(".load-more")) {
          const bagName = button.dataset.bag;
          const bag = document.querySelector('.bag[data-bag-name="' + bagName + '"]');
          if (!bag) continue;
          const hiddenCount = bag.querySelectorAll(".memory.hidden").length;
          if (hiddenCount <= 0) {
            button.classList.add("hidden");
          } else {
            button.classList.remove("hidden");
            button.textContent = "Load more (" + hiddenCount + " remaining)";
          }
        }
      }

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
            card.classList.toggle("hidden", !memoryMatches || Number(card.dataset.memoryIndex || 0) >= PAGE_SIZE);
            if (memoryMatches) visibleMemories += 1;
          }

          const hasAnyMemoryOrNoMemoryCards = memoryCards.length === 0 || visibleMemories > 0;
          bag.classList.toggle("hidden", !(bagMatches && hasAnyMemoryOrNoMemoryCards));
        }

        refreshLoadMoreButtons();
      }

      document.addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLButtonElement) || !target.classList.contains("load-more")) return;
        const bagName = target.dataset.bag;
        const bag = document.querySelector('.bag[data-bag-name="' + bagName + '"]');
        if (!bag) return;

        const hiddenCards = Array.from(bag.querySelectorAll(".memory.hidden"));
        hiddenCards.slice(0, PAGE_SIZE).forEach((card) => card.classList.remove("hidden"));
        refreshLoadMoreButtons();
      });

      bagFilter?.addEventListener("input", applyFilter);
      memoryFilter?.addEventListener("input", applyFilter);
      refreshLoadMoreButtons();
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

function buildSourceMetadata(request: Request, source: unknown): Record<string, unknown> {
  if (source && typeof source === "object" && !Array.isArray(source)) {
    const provided = source as Record<string, unknown>;
    if (Object.keys(provided).length > 0) return provided;
  }

  return {
    transport: "http",
    method: request.method,
    path: new URL(request.url).pathname,
    userAgent: request.headers.get("user-agent") ?? "unknown",
    forwardedFor: request.headers.get("x-forwarded-for") ?? "unknown",
    storedAt: new Date().toISOString(),
  };
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
              source: buildSourceMetadata(request, body.source),
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
