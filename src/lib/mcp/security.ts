import { createHash } from "node:crypto";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

const WINDOW_MS = 60_000;
const LIMITS = { list_allowed_summaries: 30, get_allowed_summary: 60, search_allowed_summaries: 15 } as const;
const buckets = new Map<string, { startedAt: number; count: number }>();
const TOKEN_PATTERN = /^pmcp_[0-9a-f]{64}$/;

export type McpToolName = keyof typeof LIMITS;
export type McpAuth = { token: string; userId: string };

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Accepts only a separately issued MCP token, never a Supabase session JWT. */
export async function getMcpAuth(request: Request): Promise<McpAuth | null> {
  const bearer = request.headers.get("authorization")?.match(/^Bearer\s+(pmcp_[0-9a-f]{64})$/i)?.[1];
  const admin = getSupabaseAdminClient();
  if (!bearer || !TOKEN_PATTERN.test(bearer) || !admin) return null;
  const { data, error } = await admin.rpc("resolve_mcp_token", { p_token: bearer });
  if (error || typeof data !== "string" || data.length === 0) return null;
  return { token: bearer, userId: data };
}

export async function readAllowedSummaries(auth: McpAuth, options: { summaryId?: string; query?: string; limit: number }) {
  const admin = getSupabaseAdminClient();
  if (!admin) throw new Error("MCP storage is unavailable");
  const { data, error } = await admin.rpc("read_mcp_summaries", {
    p_token: auth.token,
    p_summary_id: options.summaryId ?? null,
    p_query: options.query ?? null,
    p_limit: options.limit,
  });
  if (error) throw error;
  return (data ?? []) as Array<Record<string, unknown>>;
}

export function consumeRateLimit(userId: string, tool: McpToolName): boolean {
  const now = Date.now();
  const key = `${userId}:${tool}`;
  const bucket = buckets.get(key);
  if (!bucket || now - bucket.startedAt >= WINDOW_MS) {
    buckets.set(key, { startedAt: now, count: 1 });
    return true;
  }
  if (bucket.count >= LIMITS[tool]) return false;
  bucket.count += 1;
  return true;
}

export async function audit(userId: string, tool: string, outcome: string, requestId?: string) {
  const admin = getSupabaseAdminClient();
  if (!admin) return;
  await admin.from("mcp_audit_log").insert({
    user_id: userId,
    tool,
    outcome,
    request_id: requestId ? tokenHash(requestId).slice(0, 32) : null,
  });
}
