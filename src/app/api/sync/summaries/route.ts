import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase/server";

export const runtime = "nodejs";
const MAX_CIPHERTEXT_LENGTH = 1_000_000;

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