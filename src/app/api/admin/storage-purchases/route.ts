import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase/server";
import { getSupabaseAdminClient, isAdminUser } from "@/lib/supabase/admin";

export async function GET() {
  const { user } = await requireUser();
  if (!user || !isAdminUser(user.id)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const admin = getSupabaseAdminClient();
  if (!admin) return NextResponse.json({ error: "Admin storage is not configured" }, { status: 503 });
  const { data, error } = await admin.from("storage_purchases").select("id,user_id,bytes,status,network,token,tx_id,quoted_amount,created_at,arweave_tx_id,funded_at").eq("status", "arweave_pending").order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: "Could not load purchases" }, { status: 500 });
  return NextResponse.json({ purchases: data ?? [] });
}

export async function PATCH(request: Request) {
  const { user } = await requireUser();
  if (!user || !isAdminUser(user.id)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const admin = getSupabaseAdminClient();
  if (!admin) return NextResponse.json({ error: "Admin storage is not configured" }, { status: 503 });
  const body = await request.json().catch(() => null) as { purchaseId?: string; userId?: string; arweaveTxId?: string } | null;
  if (!body?.purchaseId || !body.userId || !/^[A-Za-z0-9_-]{43}$/.test(body.arweaveTxId ?? "")) return NextResponse.json({ error: "Purchase, user and Arweave transaction are required" }, { status: 400 });
  // The composite predicate is intentional: a payment can only credit its exact owner.
  const { data, error } = await admin.from("storage_purchases").update({ status: "confirmed", arweave_tx_id: body.arweaveTxId, funded_at: new Date().toISOString() }).eq("id", body.purchaseId).eq("user_id", body.userId).eq("status", "arweave_pending").select("id,user_id,bytes,status,arweave_tx_id").maybeSingle();
  if (error) return NextResponse.json({ error: "Could not confirm purchase" }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Purchase not found, already processed, or owner mismatch" }, { status: 409 });
  return NextResponse.json({ purchase: data });
}