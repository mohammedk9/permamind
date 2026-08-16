import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase/server";

export const runtime = "nodejs";

const SCOPES = new Set(["conversations", "memories", "projects"]);
const MAX_CIPHERTEXT_LENGTH = 8_000_000;

export async function GET(request: Request) {
  const { supabase, user } = await requireUser();
  if (!supabase || !user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const scope = new URL(request.url).searchParams.get("scope");
  if (!scope || !SCOPES.has(scope)) return NextResponse.json({ error: "Invalid sync scope" }, { status: 400 });

  const { data, error } = await supabase.from("memory_sync_blobs").select("data_scope,ciphertext,encryption_version,content_hash,updated_at").eq("user_id", user.id).eq("data_scope", scope).maybeSingle();
  if (error) return NextResponse.json({ error: "Could not load sync data" }, { status: 500 });
  return NextResponse.json({ blob: data ?? null });
}

export async function PUT(request: Request) {
  const { supabase, user } = await requireUser();
  if (!supabase || !user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });

  const body = await request.json().catch(() => null) as { scope?: string; ciphertext?: string; contentHash?: string; encryptionVersion?: number } | null;
  if (!body || !body.scope || !SCOPES.has(body.scope) || typeof body.ciphertext !== "string" || body.ciphertext.length < 1 || body.ciphertext.length > MAX_CIPHERTEXT_LENGTH) {
    return NextResponse.json({ error: "A valid encrypted sync payload is required" }, { status: 400 });
  }
  if (body.encryptionVersion !== 1) return NextResponse.json({ error: "Unsupported encryption version" }, { status: 400 });
  if (body.contentHash !== undefined && !/^[0-9a-f]{64}$/.test(body.contentHash)) return NextResponse.json({ error: "Invalid content hash" }, { status: 400 });

  const { data, error } = await supabase.from("memory_sync_blobs").upsert({ user_id: user.id, data_scope: body.scope, ciphertext: body.ciphertext, content_hash: body.contentHash ?? null, encryption_version: 1, updated_at: new Date().toISOString() }, { onConflict: "user_id,data_scope" }).select("data_scope,ciphertext,encryption_version,content_hash,updated_at").single();
  if (error) return NextResponse.json({ error: "Could not save sync data" }, { status: 500 });
  return NextResponse.json({ blob: data });
}