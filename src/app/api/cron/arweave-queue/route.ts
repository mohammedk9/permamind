import { NextResponse } from "next/server";
import { processDurableQueue } from "@/lib/arweave/queue-worker";

/** Independent of the browser. Authorize with CRON_SECRET. */
export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!secret || provided !== secret) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const result = await processDurableQueue();
  return NextResponse.json(result);
}
