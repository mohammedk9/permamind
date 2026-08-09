import { NextResponse } from "next/server";
import type { SnapshotMeta } from "@/lib/arweave/snapshot-types";
import { buildTags, createTransaction, uploadTransaction } from "@/lib/arweave/arweave-client";
import { MAX_UPLOAD_SIZE_BYTES } from "@/lib/arweave/upload-protection";
import { checkStorage, checkUploadRate, recordUpload } from "@/lib/arweave/upload-protection";
import { requireUser } from "@/lib/supabase/server";

/** Uploads an encrypted snapshot using the application-owned Arweave wallet. */
export async function POST(request: Request) {
  try {
    const { user } = await requireUser();
    if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
    const contentLength = Number(request.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > MAX_UPLOAD_SIZE_BYTES) {
      return NextResponse.json({ error: "Upload exceeds the maximum size" }, { status: 413 });
    }

    const userId = user.id;
    const isPro = false;
    const rate = checkUploadRate(userId, isPro);
    if (!rate.ok) return NextResponse.json({ code: "RATE_LIMITED", retryAfter: rate.retryAfter }, { status: 429 });

    const body = (await request.json()) as {
      encryptedPayload?: string;
      metadata?: SnapshotMeta;
    };

    const payload = body.encryptedPayload ? new TextEncoder().encode(body.encryptedPayload) : null;
    if (payload && payload.byteLength > MAX_UPLOAD_SIZE_BYTES) {
      return NextResponse.json({ error: "Upload exceeds the maximum size" }, { status: 413 });
    }
    if (!payload || !body.metadata) {
      return NextResponse.json({ error: "Invalid snapshot envelope" }, { status: 400 });
    }

    const quota = checkStorage(userId, payload.byteLength);
    if (!quota.ok) return NextResponse.json({ code: "STORAGE_LIMIT_REACHED", remainingMb: quota.remainingMb }, { status: 413 });

    const walletJson = process.env.ARWEAVE_APP_WALLET_JWK;
    if (!walletJson) {
      return NextResponse.json({ error: "Snapshot storage is not configured" }, { status: 503 });
    }

    let wallet: Parameters<typeof createTransaction>[2];
    try {
      wallet = JSON.parse(walletJson) as Parameters<typeof createTransaction>[2];
    } catch {
      return NextResponse.json({ error: "ARWEAVE_APP_WALLET_JWK is not valid JSON" }, { status: 503 });
    }
    const transaction = await createTransaction(payload, buildTags(body.metadata), wallet);
    const txId = await uploadTransaction(transaction.transaction);
    recordUpload(userId, payload.byteLength);

    return NextResponse.json({ txId, uploadedBytes: payload.byteLength, arweavePrice: null });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Snapshot upload failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}