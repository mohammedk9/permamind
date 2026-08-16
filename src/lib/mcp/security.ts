import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { getSupabaseServerClient } from "@/lib/supabase/server";

const WINDOW_MS = 60_000;
const LIMITS = { list_allowed_summaries: 30, get_allowed_summary: 60, search_allowed_summaries: 15 } as const;
const buckets = new Map<string, { startedAt: number; count: number }>();

export type McpToolName = keyof typeof LIMITS;

export async function getMcpUser(request: Request): Promise<{ supabase: SupabaseClient; user: User } | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  const bearer = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  const supabase = bearer
    ? createClient(url, anonKey, { global: { headers: { Authorization: `Bearer ${bearer}` } }, auth: { persistSession: false, autoRefreshToken: false } })
    : await getSupabaseServerClient();
  if (!supabase) return null;
  const { data: { user } } = await supabase.auth.getUser();
  return user ? { supabase, user } : null;
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

export async function audit(supabase: SupabaseClient, userId: string, tool: string, outcome: string, requestId?: string) {
  await supabase.from("mcp_audit_log").insert({ user_id: userId, tool, outcome, request_id: requestId ?? null });
}