import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { audit, consumeRateLimit, getMcpAuth, readAllowedSummaries, type McpAuth, type McpToolName } from "@/lib/mcp/security";

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
    catch { await audit(auth.userId, tool, "error", requestId); return error("The allowed summary could not be read."); }
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
