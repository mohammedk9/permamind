import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase/server";

export const runtime = "nodejs";
const MAX_CIPHERTEXT_LENGTH = 1_000_000;
/** Upper bound on one delta page, so a large history cannot produce an unbounded response. */
const MAX_PAGE = 500;

/**
 * Returns conversation summaries that changed since a given timestamp.
 *
 * This is the read half of multi-device sync. The previous design pulled the
 * whole encrypted blob for a scope, so two devices editing two different
 * conversations could not both survive: the second upload overwrote the first.
 * Fetching only rows newer than the caller's last successful sync turns that
 * into a per-conversation merge, because the table is already keyed on
 * `(user_id, conversation_id)`.
 *
 * `since` is the caller's own high-water mark. When omitted the full history is
 * returned, which is what a fresh device needs.
 */
export async function GET(request: Request) {
  const { supabase, user } = await requireUser();
  if (!supabase || !user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });

  const params = new URL(request.url).searchParams;
  const sinceRaw = params.get("since");
  const limitRaw = Number(params.get("limit") ?? MAX_PAGE);

  if (sinceRaw !== null && Number.isNaN(Date.parse(sinceRaw))) {
    return NextResponse.json({ error: "Invalid since timestamp" }, { status: 400 });
  }
  const limit = Math.min(MAX_PAGE, Math.max(1, Number.isFinite(limitRaw) ? limitRaw : MAX_PAGE));

  const query = supabase
    .from("cloud_conversation_summaries")
    .select("conversation_id,ciphertext,encryption_version,content_hash,source_created_at,source_updated_at,updated_at")
    .eq("user_id", user.id)
    .not("ciphertext", "is", null)
    .order("updated_at", { ascending: true })
    .limit(limit);

  if (sinceRaw) query.gt("updated_at", new Date(sinceRaw).toISOString());

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: "Could not load sync data" }, { status: 500 });

  const summaries = data ?? [];
  // The next call uses the newest row's updated_at as its watermark. When nothing
  // matched, the caller's own mark is echoed back so it does not reset.
  const lastSyncedAt =
    summaries.length > 0
      ? (summaries[summaries.length - 1].updated_at as string)
      : (sinceRaw ?? new Date().toISOString());

  return NextResponse.json({ summaries, lastSyncedAt, hasMore: summaries.length === limit });
}

export async function PUT(request: Request) {
  const { supabase, user } = await requireUser();
  if (!supabase || !user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body.conversationId !== "string" || !body.conversationId || typeof body.ciphertext !== "string" || typeof body.contentHash !== "string" || typeof body.sourceCreatedAt !== "string" || typeof body.sourceUpdatedAt !== "string") {
    return NextResponse.json({ error: "A valid conversation summary is required" }, { status: 400 });
  }
  if (body.ciphertext.length < 1 || body.ciphertext.length > MAX_CIPHERTEXT_LENGTH || !/^[0-9a-f]{64}$/.test(body.contentHash) || body.encryptionVersion !== 1 || Number.isNaN(Date.parse(body.sourceCreatedAt)) || Number.isNaN(Date.parse(body.sourceUpdatedAt))) {
    return NextResponse.json({ error: "Summary is too large or invalid" }, { status: 400 });
  }

  const existing = await supabase.from("cloud_conversation_summaries").select("content_hash").eq("user_id", user.id).eq("conversation_id", body.conversationId).maybeSingle();
  if (existing.error) return NextResponse.json({ error: "Could not check summary" }, { status: 500 });
  if (existing.data?.content_hash === body.contentHash) return new Response(null, { status: 304 });

  const { data, error } = await supabase.from("cloud_conversation_summaries").upsert({
    user_id: user.id,
    conversation_id: body.conversationId,
    ciphertext: body.ciphertext,
    ciphertext_bytes: Buffer.byteLength(body.ciphertext, "utf8"),
    content_hash: body.contentHash,
    source_created_at: body.sourceCreatedAt,
    source_updated_at: body.sourceUpdatedAt,
    title: typeof body.title === "string" ? body.title.slice(0, 500) : null,
    summary: typeof body.summary === "string" ? body.summary.slice(0, 50_000) : null,
    topics: Array.isArray(body.topics) ? body.topics.filter((item): item is string => typeof item === "string").slice(0, 100) : [],
    tags: Array.isArray(body.tags) ? body.tags.filter((item): item is string => typeof item === "string").slice(0, 100) : [],
    mcp_allowed: body.mcpAllowed === true,
    updated_at: new Date().toISOString(),
  }, { onConflict: "user_id,conversation_id" }).select("conversation_id,content_hash,updated_at").single();
  if (error) return NextResponse.json({ error: "Could not save conversation summary" }, { status: 500 });
  return NextResponse.json({ summary: data });
}

export async function DELETE(request: Request) {
  const { supabase, user } = await requireUser();
  if (!supabase || !user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });

  const conversationId = new URL(request.url).searchParams.get("conversationId");
  if (!conversationId || conversationId.length > 200) {
    return NextResponse.json({ error: "A valid conversation id is required" }, { status: 400 });
  }

  const { error } = await supabase
    .from("cloud_conversation_summaries")
    .delete()
    .eq("user_id", user.id)
    .eq("conversation_id", conversationId);
  if (error) return NextResponse.json({ error: "Could not delete conversation summary" }, { status: 500 });

  return NextResponse.json({ deleted: true });
}