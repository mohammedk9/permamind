import {
  buildSummaryPrompt,
  formatConversationForSummary,
  parseSummaryResponse,
} from "@/lib/ai/summarize";
import {
  createFreeProviderCompletion,
  createOpenRouterCompletion,
  getFreeRoute,
  parseOpenRouterError,
} from "@/lib/ai/openrouter";
import { resolveRequestAuth } from "@/lib/ai/request-auth";
import {
  isModelUnavailableError,
  resolveModelChain,
} from "@/lib/ai/route-models";
import { getSummaryModel } from "@/lib/ai/summary-model";
import type { ChatCompletionMessage } from "@/lib/ai/types";
import type { Message } from "@/types/chat";
import { sanitizeUpstreamError } from "@/lib/ai/openrouter";
import { checkRateLimit, rateLimitIdentifier, RATE_LIMIT_DAY_MS } from "@/lib/ai/rate-limit";

export const runtime = "nodejs";
const MAX_MESSAGES = 100;
const MAX_CONTENT_LENGTH = 20_000;
const FALLBACK_DELAY_MS = 450;
const FREE_DAILY_SUMMARY_LIMIT = 10;
const BYOK_SUMMARY_REQUESTS_PER_MINUTE = 20;

function isValidMessage(
  msg: unknown
): msg is ChatCompletionMessage {
  if (!msg || typeof msg !== "object") return false;
  const m = msg as ChatCompletionMessage;
  return (
    (m.role === "user" || m.role === "assistant") &&
    typeof m.content === "string" &&
    m.content.trim().length > 0 && m.content.length <= MAX_CONTENT_LENGTH
  );
}

export async function POST(request: Request) {
  let body: { messages?: ChatCompletionMessage[] };

  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  let auth;
  try {
    auth = resolveRequestAuth(request);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unauthorized";
    return Response.json({ error: message }, { status: 401 });
  }

  const { messages } = body;

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const identifier = rateLimitIdentifier(ip, `${auth.mode}:${auth.apiKey}`);
  let limiter;
  if (auth.mode === "free") {
    limiter = checkRateLimit(identifier, FREE_DAILY_SUMMARY_LIMIT, RATE_LIMIT_DAY_MS);
    if (!limiter.allowed) {
      return Response.json(
        { error: "You have used your free summary allowance for today. Add your own API key in Settings, or come back tomorrow." },
        { status: 429, headers: { "Retry-After": String(limiter.retryAfterSeconds) } }
      );
    }
  } else {
    limiter = checkRateLimit(`${identifier}:min`, BYOK_SUMMARY_REQUESTS_PER_MINUTE);
    if (!limiter.allowed) {
      return Response.json(
        { error: "Too many summary requests. Please slow down." },
        { status: 429, headers: { "Retry-After": String(limiter.retryAfterSeconds) } }
      );
    }
  }

  if (!Array.isArray(messages) || messages.length < 2 || messages.length > MAX_MESSAGES) {
    return Response.json(
      { error: "At least 2 messages required" },
      { status: 400 }
    );
  }

  if (!messages.every(isValidMessage)) {
    return Response.json({ error: "Invalid message format" }, { status: 400 });
  }

  const asMessages: Message[] = messages.map((m, i) => ({
    id: String(i),
    role: m.role as "user" | "assistant",
    content: m.content,
    createdAt: new Date(),
  }));

  const formatted = formatConversationForSummary(asMessages);
  if (!formatted) {
    return Response.json({ error: "No content to summarize" }, { status: 400 });
  }

  const summaryModel = getSummaryModel(auth.mode);
  const modelChain = resolveModelChain(summaryModel, auth.mode);
  const prompt = buildSummaryPrompt(formatted);
  let lastError = "Summary model unavailable";

  try {
    for (const tryModel of modelChain) {
      const upstream = auth.mode === "free"
        ? await createFreeProviderCompletion(getFreeRoute(tryModel), prompt)
        : await createOpenRouterCompletion(tryModel, prompt, auth.apiKey);

      if (!upstream.ok) {
        lastError = await parseOpenRouterError(upstream);

        if (isModelUnavailableError(upstream.status, lastError)) {
          if (upstream.status === 429 || upstream.status >= 500) {
            await new Promise((resolve) => setTimeout(resolve, FALLBACK_DELAY_MS));
          }
          continue;
        }
        return Response.json({ error: sanitizeUpstreamError(lastError) }, { status: upstream.status });
      }

      const data = (await upstream.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          total_tokens?: number;
        };
      };

      const content = data.choices?.[0]?.message?.content ?? "";
      const parsed = parseSummaryResponse(content);

      if (!parsed) {
        return Response.json(
          { error: "Failed to parse summary response" },
          { status: 502 }
        );
      }

      return Response.json({
        ...parsed,
        usage: data.usage ?? null,
        model: tryModel,
      });
    }

    return Response.json({ error: sanitizeUpstreamError(lastError) }, { status: 502 });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to generate summary";
    return Response.json({ error: sanitizeUpstreamError(message) }, { status: 500 });
  }
}
