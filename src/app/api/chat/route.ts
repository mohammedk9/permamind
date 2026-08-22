import {
  createProviderStream,
  createCustomStream,
  createFreeProviderStream,
  getFreeRoute,
  parseOpenRouterError,
  sanitizeUpstreamError,
} from "@/lib/ai/openrouter";
import { isValidModelId } from "@/lib/ai/models";
import { resolveRequestAuth } from "@/lib/ai/request-auth";
import {
  isModelUnavailableError,
  resolveModelChain,
} from "@/lib/ai/route-models";
import type { ChatCompletionMessage, ChatRequestBody } from "@/lib/ai/types";
import { checkRateLimit, rateLimitIdentifier, RATE_LIMIT_DAY_MS } from "@/lib/ai/rate-limit";

export const runtime = "nodejs";
const MAX_MESSAGES = 100;
const MAX_CONTENT_LENGTH = 20_000;
const FALLBACK_DELAY_MS = 450;
const FREE_DAILY_REQUEST_LIMIT = 10;
const BYOK_CHAT_REQUESTS_PER_MINUTE = 30;

function shouldDelayBeforeFallback(status: number): boolean {
  return status === 429 || status >= 500;
}

function isValidMessage(
  msg: unknown
): msg is ChatCompletionMessage {
  if (!msg || typeof msg !== "object") return false;
  const m = msg as ChatCompletionMessage;
  return (
    (m.role === "user" || m.role === "assistant" || m.role === "system") &&
    typeof m.content === "string" &&
    m.content.length > 0 && m.content.length <= MAX_CONTENT_LENGTH
  );
}

export async function POST(request: Request) {
  let body: ChatRequestBody;

  try {
    body = (await request.json()) as ChatRequestBody;
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { model, messages } = body;

    let auth;
  try {
    auth = resolveRequestAuth(request);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unauthorized";
    return Response.json({ error: message }, { status: 401 });
  }

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const identifier = rateLimitIdentifier(ip, `${auth.mode}:${auth.apiKey}`);
  let limiter;
  if (auth.mode === "free") {
    limiter = checkRateLimit(identifier, FREE_DAILY_REQUEST_LIMIT, RATE_LIMIT_DAY_MS);
    if (!limiter.allowed) {
      return Response.json(
        { error: "You have used your 10 free messages for today. Add your own API key in Settings for unlimited chat, or come back tomorrow." },
        { status: 429, headers: { "Retry-After": String(limiter.retryAfterSeconds) } }
      );
    }
    // Burst guard on top of the daily allowance so the day's budget cannot be
    // spent in a few seconds of scripted hammering.
    const burst = checkRateLimit(`${identifier}:burst`, 5);
    if (!burst.allowed) {
      return Response.json(
        { error: "Too many requests. Please slow down." },
        { status: 429, headers: { "Retry-After": String(burst.retryAfterSeconds) } }
      );
    }
  } else {
    limiter = checkRateLimit(`${identifier}:min`, BYOK_CHAT_REQUESTS_PER_MINUTE);
    if (!limiter.allowed) {
      return Response.json(
        { error: "Too many requests. Please slow down." },
        { status: 429, headers: { "Retry-After": String(limiter.retryAfterSeconds) } }
      );
    }
  }

  const customByokModel = auth.mode === "byok" && auth.provider !== "custom" ? auth.modelName?.trim() : undefined;

  if (!customByokModel && (!model || !isValidModelId(model))) {
    return Response.json(
      {
        error:
          auth.mode === "free"
            ? "Invalid model for free mode"
            : "Invalid model",
      },
      { status: 400 }
    );
  }

  if (!Array.isArray(messages) || messages.length === 0 || messages.length > MAX_MESSAGES) {
    return Response.json({ error: "Messages are required" }, { status: 400 });
  }

  if (!messages.every(isValidMessage)) {
    return Response.json({ error: "Invalid message format" }, { status: 400 });
  }

  const modelChain = customByokModel ? [customByokModel] : resolveModelChain(model, auth.mode);
  let lastError = "All models unavailable";

  try {
    for (const tryModel of modelChain) {
      const upstream = auth.mode === "free"
        ? await createFreeProviderStream(getFreeRoute(tryModel), messages)
        : auth.provider === "custom"
        ? await createCustomStream(auth.baseUrl ?? "", auth.modelName ?? tryModel, messages, auth.apiKey)
        : await createProviderStream(
          auth.provider,
          tryModel,
          messages,
          auth.apiKey
          );

      if (upstream.ok && upstream.body) {
        const headers: Record<string, string> = {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
        };
        if (tryModel !== model) {
          headers["X-Resolved-Model"] = tryModel;
        }
        return new Response(upstream.body, { headers });
      }

      lastError = await parseOpenRouterError(upstream);

      if (auth.mode === "byok" || (!isModelUnavailableError(upstream.status, lastError) && tryModel === modelChain.at(-1))) {
        return Response.json({ error: sanitizeUpstreamError(lastError) }, { status: upstream.status });
      }
      if (shouldDelayBeforeFallback(upstream.status)) {
        await new Promise((resolve) => setTimeout(resolve, FALLBACK_DELAY_MS));
      }
    }

    return Response.json({ error: sanitizeUpstreamError(lastError) }, { status: 502 });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to reach OpenRouter";
    return Response.json({ error: sanitizeUpstreamError(message) }, { status: 500 });
  }
}
