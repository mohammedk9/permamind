import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase/server";
import { getStorageQuote } from "@/lib/arweave/storage-pricing";
import { isPaymentNetwork, isPaymentToken } from "@/lib/payments/config";
import { verifyPayment } from "@/lib/payments/verify";

const ARWEAVE_ADDRESS = /^[A-Za-z0-9_-]{43}$/;
const TX_ID = /^[A-Za-z0-9_-]{43}$/;
const PAYMENT_ADDRESS = process.env.NEXT_PUBLIC_STORAGE_PAYMENT_ADDRESS;

export async function POST(request: Request) {
  const { supabase, user } = await requireUser();
  if (!supabase || !user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const body = await request.json() as { bytes?: number; walletAddress?: string; txId?: string; network?: string; token?: string; tokenAmount?: string };
  if (isPaymentNetwork(body.network) && isPaymentToken(body.token)) {
    if (!body.walletAddress || !body.txId || !body.tokenAmount || !/^\d+$/.test(body.tokenAmount)) return NextResponse.json({ error: "Wallet, transaction hash and token amount are required" }, { status: 400 });
    if (!Number.isInteger(body.bytes) || body.bytes! < 1 || body.bytes! > 1024 ** 4) return NextResponse.json({ error: "Invalid byte amount" }, { status: 400 });
    const duplicate = await supabase.from("storage_purchases").select("id").eq("tx_id", body.txId).maybeSingle();
    if (duplicate.data) return NextResponse.json({ error: "This transaction has already been registered" }, { status: 409 });
    const bytes = body.bytes as number;
    const expected = BigInt(body.tokenAmount);
    try {
      await verifyPayment(body.network, body.token, body.txId, expected, body.walletAddress);
    } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Payment verification failed" }, { status: 400 }); }
    const { data, error } = await supabase.from("storage_purchases").insert({ user_id: user.id, bytes, wallet_address: body.walletAddress, tx_id: body.txId, status: "arweave_pending", network: body.network, token: body.token, quoted_amount: body.tokenAmount }).select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ purchase: data, message: "Payment confirmed. Arweave storage processing may take time." }, { status: 201 });
  }
  if (!Number.isInteger(body.bytes) || body.bytes! < 1 || body.bytes! > 1024 ** 4 || !body.walletAddress || !ARWEAVE_ADDRESS.test(body.walletAddress) || !body.txId || !TX_ID.test(body.txId)) {
    return NextResponse.json({ error: "A valid byte amount, Arweave wallet address and transaction ID are required" }, { status: 400 });
  }
  const bytes = body.bytes as number;
  if (!PAYMENT_ADDRESS || !ARWEAVE_ADDRESS.test(PAYMENT_ADDRESS)) return NextResponse.json({ error: "Storage payments are not configured" }, { status: 503 });

  const existing = await supabase.from("storage_purchases").select("id,status").eq("tx_id", body.txId).maybeSingle();
  if (existing.data) return NextResponse.json({ error: "This transaction has already been registered" }, { status: 409 });

  const transactionResponse = await fetch(`https://arweave.net/tx/${body.txId}`, { cache: "no-store" });
  if (!transactionResponse.ok) return NextResponse.json({ error: "Transaction was not found on Arweave" }, { status: 400 });
  const transaction = await transactionResponse.json() as { target?: string; quantity?: string; tags?: Array<{ name?: string; value?: string }> };
  const tags = new Map((transaction.tags ?? []).map((tag) => [tag.name, tag.value]));
  const quote = await getStorageQuote(bytes);
  const minimumWinston = String(Math.ceil(quote.ar * 1e12));
  const paidWinston = transaction.quantity && /^\d+$/.test(transaction.quantity) ? transaction.quantity.replace(/^0+(?=\d)/, "") : "0";
  const paidEnough = paidWinston.length > minimumWinston.length || (paidWinston.length === minimumWinston.length && paidWinston >= minimumWinston);
  if (transaction.target !== PAYMENT_ADDRESS || !paidEnough || tags.get("App-Name") !== "PermaMind" || tags.get("Action") !== "Storage-Purchase") {
    return NextResponse.json({ error: "Transaction does not match this storage purchase" }, { status: 400 });
  }
  const { data, error } = await supabase.from("storage_purchases").insert({ user_id: user.id, bytes, wallet_address: body.walletAddress, tx_id: body.txId, status: "pending" }).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ purchase: data }, { status: 201 });
}

export async function GET() {
  const { supabase, user } = await requireUser();
  if (!supabase || !user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const { data, error } = await supabase.from("storage_purchases").select("bytes,status,tx_id").eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  let confirmedBytes = 0;
  for (const purchase of data ?? []) {
    if (purchase.status === "confirmed") { confirmedBytes += Number(purchase.bytes); continue; }
    const statusResponse = await fetch(`https://arweave.net/tx/${purchase.tx_id}/status`, { cache: "no-store" });
    if (!statusResponse.ok) continue;
    const status = await statusResponse.json() as { block_height?: number };
    if (typeof status.block_height === "number" && status.block_height >= 0) {
      // Do not mutate the purchase through the user's Supabase client. RLS
      // intentionally denies UPDATE so clients cannot forge confirmation.
      confirmedBytes += Number(purchase.bytes);
    }
  }
  return NextResponse.json({ confirmedBytes });
}