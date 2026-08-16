import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { audit, consumeRateLimit, getMcpUser, type McpToolName } from "@/lib/mcp/security";

export const runtime = "nodejs";

function text(value: unknown) { return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] }; }
function error(message: string) { return { content: [{ type: "text" as const, text: message }], isError: true }; }

function createMcpServer(auth: NonNullable<Awaited<ReturnType<typeof getMcpUser>>>, request: Request) {
  const { supabase, user } = auth;
  const server = new McpServer({ name: "permamind-cloud-readonly", version: "1.0.0" });
  const run = async (tool: McpToolName, action: () => Promise<unknown>) => {
    const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
    if (!consumeRateLimit(user.id, tool)) {
      await audit(supabase, user.id, tool, "rate_limited", requestId);
      return error("Rate limit exceeded. Please try again later.");
    }
    try { const result = await action(); await audit(supabase, user.id, tool, "success", requestId); return text(result); }
    catch { await audit(supabase, user.id, tool, "error", requestId); return error("The allowed summary could not be read."); }
  };
  const columns = "id,conversation_id,title,summary,topics,tags,source_created_at,source_updated_at,updated_at";
  const warning = "Only user-selected summaries are returned. This data may be sent to Claude, Cursor, or another connected MCP client.";

  server.registerTool("list_allowed_summaries", { title: "List allowed summaries", description: warning, inputSchema: { limit: z.number().int().min(1).max(50).default(20) } }, ({ limit }) => run("list_allowed_summaries", async () => {
    const { data, error: dbError } = await supabase.from("cloud_conversation_summaries").select(columns).eq("user_id", user.id).eq("mcp_allowed", true).not("summary", "is", null).order("updated_at", { ascending: false }).limit(limit);
    if (dbError) throw dbError; return { readOnly: true, warning, summaries: data ?? [] };
  }));
  server.registerTool("get_allowed_summary", { title: "Get allowed summary", description: warning, inputSchema: { summaryId: z.string().uuid() } }, ({ summaryId }) => run("get_allowed_summary", async () => {
    const { data, error: dbError } = await supabase.from("cloud_conversation_summaries").select(columns).eq("id", summaryId).eq("user_id", user.id).eq("mcp_allowed", true).not("summary", "is", null).maybeSingle();
    if (dbError) throw dbError; if (!data) return error("Summary not found or not allowed."); return { readOnly: true, warning, summary: data };
  }));
  server.registerTool("search_allowed_summaries", { title: "Search allowed summaries", description: warning, inputSchema: { query: z.string().trim().min(1).max(100), limit: z.number().int().min(1).max(25).default(10) } }, ({ query, limit }) => run("search_allowed_summaries", async () => {
    const { data, error: dbError } = await supabase.from("cloud_conversation_summaries").select(columns).eq("user_id", user.id).eq("mcp_allowed", true).not("summary", "is", null).ilike("summary", `%${query.replace(/[%_,]/g, "\\$&")}%`).limit(limit);
    if (dbError) throw dbError; return { readOnly: true, warning, query, summaries: data ?? [] };
  }));
  return server;
}

async function handle(request: Request) {
  const auth = await getMcpUser(request);
  if (!auth) return Response.json({ error: "Authentication required" }, { status: 401 });
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