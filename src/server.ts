import { getDb } from "./db/client";
import { listBags, upsertBag } from "./bags/service";
import { deleteMemory, storeMemory, updateMemory } from "./memory/store";
import { recallMemories } from "./memory/recall";
import { config } from "./config";
import type { MemoryKind } from "./types";
import { handleMcpRequest } from "./mcp";

const SUPPORTED_KINDS = new Set(["summary", "preference", "constraint", "decision", "fact", "note"]);

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
