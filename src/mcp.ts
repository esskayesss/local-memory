import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod/v4";

import { deleteBag, listBags, upsertBag } from "./bags/service";
import { getDb } from "./db/client";
import { recallMemories } from "./memory/recall";
import { deleteMemory, storeMemory, updateMemory } from "./memory/store";
import type { MemoryKind } from "./types";

const SUPPORTED_KINDS = ["summary", "preference", "constraint", "decision", "fact", "note"] as const;

const memoryKindSchema = z.enum(SUPPORTED_KINDS);

interface McpSession {
  server: McpServer;
  transport: WebStandardStreamableHTTPServerTransport;
}

const sessions = new Map<string, McpSession>();

function buildMcpServer(): McpServer {
  const db = getDb();

  const server = new McpServer({
    name: "local-rag-memory",
    version: "0.1.0",
  });

  server.registerTool(
    "list_bags",
    {
      title: "List Bags",
      description: "List all memory bags and their retrieval policies.",
    },
    async () => {
      const bags = listBags(db);
      return {
        content: [{ type: "text", text: JSON.stringify({ bags }, null, 2) }],
        structuredContent: { bags },
      };
    },
  );

  server.registerTool(
    "upsert_bag",
    {
      title: "Upsert Bag",
      description: "Create or update a bag policy used for memory retrieval.",
      inputSchema: {
        name: z.string().min(1),
        description: z.string().nullable().optional(),
        defaultTopK: z.number().int().min(1).max(100).optional(),
        recencyHalfLifeDays: z.number().min(1).max(3650).optional(),
        importanceWeight: z.number().min(0).max(2).optional(),
        allowedKinds: z.array(memoryKindSchema).optional(),
      },
    },
    async (input) => {
      const bag = upsertBag(db, input);
      return {
        content: [{ type: "text", text: JSON.stringify({ bag }, null, 2) }],
        structuredContent: { bag },
      };
    },
  );

  server.registerTool(
    "delete_bag",
    {
      title: "Delete Bag",
      description: "Delete a bag policy. Requires force=true when memories exist.",
      inputSchema: {
        name: z.string().min(1),
        force: z.boolean().optional(),
        allowSystem: z.boolean().optional(),
      },
    },
    async (input) => {
      const result = deleteBag(db, input);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },
  );

  server.registerTool(
    "store_memory",
    {
      title: "Store Memory",
      description: "Store a memory item in a bag with semantic embedding.",
      inputSchema: {
        bag: z.string().min(1),
        kind: memoryKindSchema.default("note"),
        content: z.string().min(1),
        tags: z.array(z.string()).optional(),
        importance: z.number().int().min(1).max(5).optional(),
        source: z.record(z.string(), z.unknown()).optional(),
        expiresAt: z.string().datetime().nullable().optional(),
      },
    },
    async (input) => {
      const memory = await storeMemory(db, input);
      return {
        content: [{ type: "text", text: JSON.stringify({ memory }, null, 2) }],
        structuredContent: { memory },
      };
    },
  );

  server.registerTool(
    "recall_memories",
    {
      title: "Recall Memories",
      description: "Recall relevant memories by semantic query and optional filters.",
      inputSchema: {
        query: z.string().min(1),
        bag: z.string().optional(),
        kinds: z.array(memoryKindSchema).optional(),
        tags: z.array(z.string()).optional(),
        topK: z.number().int().min(1).max(100).optional(),
        candidateLimit: z.number().int().min(1).max(5000).optional(),
      },
    },
    async (input) => {
      const memories = await recallMemories(db, {
        ...input,
        kinds: input.kinds as MemoryKind[] | undefined,
      });
      return {
        content: [{ type: "text", text: JSON.stringify({ memories }, null, 2) }],
        structuredContent: { memories },
      };
    },
  );

  server.registerTool(
    "update_memory",
    {
      title: "Update Memory",
      description: "Update memory fields and re-embed if content changes.",
      inputSchema: {
        id: z.string().min(1),
        content: z.string().optional(),
        tags: z.array(z.string()).optional(),
        importance: z.number().int().min(1).max(5).optional(),
        source: z.record(z.string(), z.unknown()).optional(),
        expiresAt: z.string().datetime().nullable().optional(),
      },
    },
    async (input) => {
      const memory = await updateMemory(db, input);
      return {
        content: [{ type: "text", text: JSON.stringify({ memory }, null, 2) }],
        structuredContent: { memory },
      };
    },
  );

  server.registerTool(
    "delete_memory",
    {
      title: "Delete Memory",
      description: "Delete a memory record by id.",
      inputSchema: {
        id: z.string().min(1),
      },
    },
    async ({ id }) => {
      const result = deleteMemory(db, id);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },
  );

  return server;
}

export async function handleMcpRequest(request: Request): Promise<Response> {
  const incomingSessionId = request.headers.get("mcp-session-id");
  if (incomingSessionId) {
    const existing = sessions.get(incomingSessionId);
    if (!existing) {
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          error: { code: -32001, message: `Unknown MCP session: ${incomingSessionId}` },
          id: null,
        }),
        {
          status: 404,
          headers: { "content-type": "application/json" },
        },
      );
    }
    return existing.transport.handleRequest(request);
  }

  const server = buildMcpServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID(),
    enableJsonResponse: true,
    onsessioninitialized: (sessionId) => {
      sessions.set(sessionId, { server, transport });
    },
    onsessionclosed: async (sessionId) => {
      const current = sessions.get(sessionId);
      if (!current) return;
      sessions.delete(sessionId);
      await current.server.close();
      await current.transport.close();
    },
  });

  await server.connect(transport);
  const response = await transport.handleRequest(request);
  const createdSessionId = response.headers.get("mcp-session-id");
  if (!createdSessionId) {
    await server.close();
    await transport.close();
  }
  return response;
}
