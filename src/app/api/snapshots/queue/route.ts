import { NextResponse } from "next/server";
import type { SnapshotMeta } from "@/lib/arweave/snapshot-types";
import { validateDurableQueueInput, type DurableQueueStatus } from "@/lib/arweave/durable-queue";
import { requireUser } from "@/lib/supabase/server";

/** Stores an already-encrypted snapshot envelope. Plaintext is rejected. */
export async function POST(request: Request) {
  const { supabase, user } = await requireUser();
  if (!supabase || !user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as {
    id?: string;
    contentHash?: string;
    snapshotVersion?: number;
    ciphertext?: string;
    metadata?: SnapshotMeta;
  } | null;
  if (!body?.id || !body.contentHash || !body.snapshotVersion || !body.ciphertext || !body.metadata) {
    return NextResponse.json({ error: "Invalid encrypted queue item" }, { status: 400 });
  }
  const input = {
    id: body.id,
    contentHash: body.contentHash,
    snapshotVersion: body.snapshotVersion,
    ciphertext: body.ciphertext,
    metadata: body.metadata,
  };
  const invalid = validateDurableQueueInput(input);
  if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });

  const { data, error } = await supabase
    .from("arweave_upload_queue")
    .upsert(
      {
        id: input.id,
        user_id: user.id,
        content_hash: input.contentHash,
        snapshot_version: input.snapshotVersion,
        ciphertext: input.ciphertext,
        metadata: input.metadata,
        status: "pending",
        attempts: 0,
        tx_id: null,
      },
      { onConflict: "user_id,content_hash", ignoreDuplicates: true },
    )
    .select("id, status, tx_id")
    .maybeSingle();

  if (error) return NextResponse.json({ error: "Could not persist the encrypted queue item" }, { status: 500 });

  const existing = data ?? await supabase
    .from("arweave_upload_queue")
    .select("id, status, tx_id")
    .eq("user_id", user.id)
    .eq("content_hash", input.contentHash)
    .maybeSingle()
    .then((result) => result.data);

  return NextResponse.json({
    id: existing?.id ?? input.id,
    status: (existing?.status ?? "pending") as DurableQueueStatus,
    txId: existing?.tx_id ?? null,
    durable: true,
  });
}

/** Returns queue counts without returning ciphertext. */
export async function GET() {
  const { supabase, user } = await requireUser();
  if (!supabase || !user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const { data, error } = await supabase
    .from("arweave_upload_queue")
    .select("status")
    .eq("user_id", user.id);
  if (error) return NextResponse.json({ error: "Could not read the encrypted queue" }, { status: 500 });
  const counts = { pending: 0, uploading: 0, uploaded: 0, failed: 0 };
  for (const row of data ?? []) {
    if (row.status in counts) counts[row.status as keyof typeof counts] += 1;
  }
  return NextResponse.json(counts);
}
