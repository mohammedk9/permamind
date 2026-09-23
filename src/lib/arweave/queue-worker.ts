import { buildTags, createTransaction, uploadTransaction } from "./arweave-client";
import type { SnapshotMeta } from "./snapshot-types";
import { MAX_UPLOAD_ATTEMPTS, MAX_UPLOAD_SIZE_BYTES, RETRY_BASE_DELAY_MS, RETRY_MAX_DELAY_MS } from "./constants";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

const STALE_UPLOAD_MS = 10 * 60 * 1000;
const BATCH_SIZE = 5;

interface QueueRow {
  id: string;
  user_id: string;
  ciphertext: string;
  metadata: SnapshotMeta;
  attempts: number;
  status: "pending" | "uploading" | "uploaded" | "failed";
  updated_at: string;
}

function retryDelayMs(attempts: number): number {
  return Math.min(RETRY_MAX_DELAY_MS, RETRY_BASE_DELAY_MS * 2 ** Math.max(0, attempts - 1));
}

function wallet() {
  const raw = process.env.ARWEAVE_APP_WALLET_JWK;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Parameters<typeof createTransaction>[2];
  } catch {
    return null;
  }
}

/** Uploads due ciphertext rows. Safe to call repeatedly; claims are conditional. */
export async function processDurableQueue(now = new Date()): Promise<{ uploaded: number; failed: number }> {
  const admin = getSupabaseAdminClient();
  const key = wallet();
  if (!admin || !key) return { uploaded: 0, failed: 0 };

  const staleBefore = new Date(now.getTime() - STALE_UPLOAD_MS).toISOString();
  await admin
    .from("arweave_upload_queue")
    .update({ status: "pending", updated_at: now.toISOString() })
    .eq("status", "uploading")
    .lt("updated_at", staleBefore);

  const { data } = await admin
    .from("arweave_upload_queue")
    .select("id, user_id, ciphertext, metadata, attempts, status, updated_at")
    .in("status", ["pending", "failed"])
    .or(`next_retry_at.is.null,next_retry_at.lte.${now.toISOString()}`)
    .order("created_at", { ascending: true })
    .limit(BATCH_SIZE);

  let uploaded = 0;
  let failed = 0;
  for (const row of (data ?? []) as QueueRow[]) {
    const claim = await admin
      .from("arweave_upload_queue")
      .update({ status: "uploading", updated_at: now.toISOString() })
      .eq("id", row.id)
      .eq("status", row.status)
      .select("id")
      .maybeSingle();
    if (!claim.data) continue;

    try {
      const bytes = new TextEncoder().encode(row.ciphertext);
      if (bytes.byteLength > MAX_UPLOAD_SIZE_BYTES) throw new Error("Encrypted payload exceeds the size cap");
      const transaction = await createTransaction(bytes, buildTags(row.metadata), key);
      const txId = await uploadTransaction(transaction.transaction);
      await admin
        .from("arweave_upload_queue")
        .update({ status: "uploaded", tx_id: txId, uploaded_at: now.toISOString(), updated_at: now.toISOString(), last_error: null })
        .eq("id", row.id)
        .eq("status", "uploading");
      uploaded += 1;
    } catch (error) {
      const attempts = row.attempts + 1;
      const terminal = attempts >= MAX_UPLOAD_ATTEMPTS;
      await admin
        .from("arweave_upload_queue")
        .update({
          status: terminal ? "failed" : "pending",
          attempts,
          next_retry_at: terminal ? null : new Date(now.getTime() + retryDelayMs(attempts)).toISOString(),
          last_error: error instanceof Error ? error.message.slice(0, 300) : "Upload failed",
          updated_at: now.toISOString(),
        })
        .eq("id", row.id)
        .eq("status", "uploading");
      failed += 1;
    }
  }
  return { uploaded, failed };
}
