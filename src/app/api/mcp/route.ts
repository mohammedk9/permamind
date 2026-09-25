import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { audit, consumeRateLimit, getMcpAuth, readAllowedDecisions, readAllowedSummaries, type McpAuth, type McpToolName } from "@/lib/mcp/security";

export const runtime = "nodejs";

function text(value: unknown) { return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] }; }
function error(message: string) { return { content: [{ type: "text" as const, text: message }], isError: true }; }

function createMcpServer(auth: McpAuth, request: Request) {
  const server = new McpServer({ name: "permamind-cloud-readonly", version: "1.0.0" });
  const run = async (tool: McpToolName, action: () => Promise<unknown>) => {
    const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
    if (!consumeRateLimit(auth.userId, tool)) {
      await audit(auth.userId, tool, "rate_limited", requestId);
      return error("Rate limit exceeded. Please try again later.");
    }
    try { const result = await action(); await audit(auth.userId, tool, "success", requestId); return text(result); }
    catch { await audit(auth.userId, tool, "error", requestId); return error("The allowed memory could not be read."); }
  };
  const warning = "Only user-selected summaries are returned. This data may be sent to Claude, Cursor, or another connected MCP client.";

  server.registerTool("list_allowed_summaries", { title: "List allowed summaries", description: warning, inputSchema: { limit: z.number().int().min(1).max(50).default(20) } }, ({ limit }) => run("list_allowed_summaries", async () => {
    const summaries = await readAllowedSummaries(auth, { limit });
    return { readOnly: true, warning, summaries };
  }));
  server.registerTool("get_allowed_summary", { title: "Get allowed summary", description: warning, inputSchema: { summaryId: z.string().uuid() } }, ({ summaryId }) => run("get_allowed_summary", async () => {
    const summaries = await readAllowedSummaries(auth, { summaryId, limit: 1 });
    if (summaries.length === 0) return error("Summary not found or not allowed.");
    return { readOnly: true, warning, summary: summaries[0] };
  }));
  server.registerTool("search_allowed_summaries", { title: "Search allowed summaries", description: warning, inputSchema: { query: z.string().trim().min(1).max(100), limit: z.number().int().min(1).max(25).default(10) } }, ({ query, limit }) => run("search_allowed_summaries", async () => {
    const summaries = await readAllowedSummaries(auth, { query, limit });
    return { readOnly: true, warning, query, summaries };
  }));
  server.registerTool("search_memory", { title: "Search allowed decisions", description: warning, inputSchema: { query: z.string().trim().min(1).max(100), limit: z.number().int().min(1).max(25).default(10) } }, ({ query, limit }) => run("search_memory", async () => ({ readOnly: true, warning, memories: await readAllowedDecisions(auth, { query, limit }) })));
  server.registerTool("get_memory", { title: "Get an allowed decision", description: warning, inputSchema: { memoryId: z.string().trim().min(1).max(120) } }, ({ memoryId }) => run("get_memory", async () => {
    const memories = await readAllowedDecisions(auth, { memoryId, limit: 1 });
    return memories[0] ? { readOnly: true, warning, memory: memories[0] } : error("Memory not found or not allowed.");
  }));
  server.registerTool("list_decisions", { title: "List allowed decisions", description: warning, inputSchema: { limit: z.number().int().min(1).max(50).default(20) } }, ({ limit }) => run("list_decisions", async () => ({ readOnly: true, warning, decisions: (await readAllowedDecisions(auth, { limit })).filter((item) => item.kind === "decision") })));
  server.registerTool("save_memory", { title: "Save memory", description: "Disabled. PermaMind MCP is read-only.", inputSchema: { text: z.string().max(500) } }, () => run("save_memory", async () => {
    await audit(auth.userId, "save_memory", "rejected_write");
    return error("MCP is read-only. Saving memory is not available.");
  }));
  return server;
}

async function handle(request: Request) {
  const auth = await getMcpAuth(request);
  if (!auth) return Response.json({ error: "A valid MCP token is required" }, { status: 401 });
  const server = createMcpServer(auth, request);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);
  // The SDK's Node adapter types IncomingMessage/ServerResponse, while Next's
  // route handler uses the Web Request/Response pair. The transport itself
  // accepts the Web request at runtime; keep the adapter boundary isolated.
  return (transport.handleRequest as unknown as (request: Request) => Promise<Response>)(request);
}
export const POST = handle;
export const GET = handle;
