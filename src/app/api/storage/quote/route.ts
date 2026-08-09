import { NextResponse } from "next/server";
import { getStorageQuote } from "@/lib/arweave/storage-pricing";

export async function GET(request: Request) {
  const bytes = Number(new URL(request.url).searchParams.get("bytes"));
  if (!Number.isFinite(bytes) || bytes < 1 || bytes > 1024 ** 4) return NextResponse.json({ error: "Invalid byte amount" }, { status: 400 });
  return NextResponse.json(await getStorageQuote(bytes));
}