/**
 * Whether the Ollama on *this* machine is reachable, and what it has pulled.
 *
 * The check runs on the server because the browser cannot make it: a page served
 * from `https://` may not call `http://127.0.0.1:11434` (mixed content), and
 * Ollama only answers cross-origin requests when `OLLAMA_ORIGINS` is set. From
 * Node it is an ordinary localhost fetch, so the answer is the same one the chat
 * route itself will get.
 *
 * It reports, it does not configure: no key, no model list written anywhere, and
 * nothing about the response is logged. A failed probe is an expected state (the
 * user simply has not installed Ollama), so it answers 200 with `ok: false`
 * rather than an error the client has to special-case.
 */

import { NextResponse } from "next/server";

export const runtime = "nodejs";

/** Same address the chat route uses, so a "connected" answer means the same thing. */
const OLLAMA_TAGS_URL = "http://127.0.0.1:11434/api/tags";

/** Short enough that an unreachable port does not hold the settings screen. */
const PROBE_TIMEOUT_MS = 2500;

export async function GET() {
  try {
    const response = await fetch(OLLAMA_TAGS_URL, {
      cache: "no-store",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!response.ok) return NextResponse.json({ ok: false, models: [] });

    const data = (await response.json()) as { models?: Array<{ name?: unknown }> };
    const models = (Array.isArray(data.models) ? data.models : [])
      .map((model) => (typeof model?.name === "string" ? model.name : ""))
      .filter(Boolean);

    return NextResponse.json({ ok: true, models });
  } catch {
    // Connection refused, timeout, or a daemon that is not Ollama.
    return NextResponse.json({ ok: false, models: [] });
  }
}