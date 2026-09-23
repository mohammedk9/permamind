import { requireUser } from "@/lib/supabase/server";

export const runtime = "nodejs";

const LABEL_LIMIT = 80;

export async function GET() {
  const { supabase, user } = await requireUser();
  if (!supabase || !user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const { data, error } = await supabase
    .from("mcp_tokens")
    .select("id,label,created_at,expires_at,last_used_at,revoked_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) return Response.json({ error: "MCP tokens are unavailable" }, { status: 503 });
  return Response.json({ tokens: data ?? [] });
}

export async function POST(request: Request) {
  const { supabase, user } = await requireUser();
  if (!supabase || !user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const body = await request.json().catch(() => ({})) as { label?: unknown };
  const label = typeof body.label === "string" ? body.label.trim().slice(0, LABEL_LIMIT) : "MCP client";
  const { data, error } = await supabase.rpc("issue_mcp_token", { p_label: label || "MCP client" });
  if (error) {
    const status = /too many active/i.test(error.message) ? 409 : 503;
    return Response.json({ error: status === 409 ? "Revoke an existing MCP token before creating another." : "MCP token could not be created." }, { status });
  }
  const issued = Array.isArray(data) ? data[0] : data;
  if (!issued?.token) return Response.json({ error: "MCP token could not be created." }, { status: 503 });
  return Response.json({ token: issued.token, id: issued.token_id, expiresAt: issued.expires_at }, { status: 201 });
}

export async function DELETE(request: Request) {
  const { supabase, user } = await requireUser();
  if (!supabase || !user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const id = new URL(request.url).searchParams.get("id");
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return Response.json({ error: "A valid token id is required" }, { status: 400 });
  const { data, error } = await supabase
    .from("mcp_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", user.id)
    .is("revoked_at", null)
    .select("id")
    .maybeSingle();
  if (error) return Response.json({ error: "MCP token could not be revoked" }, { status: 503 });
  if (!data) return Response.json({ error: "MCP token was not found" }, { status: 404 });
  return Response.json({ revoked: true });
}
