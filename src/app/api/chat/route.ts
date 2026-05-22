import {
  createOpenRouterStream,
  parseOpenRouterError,
} from "@/lib/ai/openrouter";
import { isValidModelId } from "@/lib/ai/models";
import { resolveRequestAuth } from "@/lib/ai/request-auth";
import {
  isModelUnavailableError,
  resolveModelChain,
} from "@/lib/ai/route-models";
import type { ChatCompletionMessage, ChatRequestBody } from "@/lib/ai/types";

export const runtime = "nodejs";

function isValidMessage(
  msg: unknown
): msg is ChatCompletionMessage {
  if (!msg || typeof msg !== "object") return false;
  const m = msg as ChatCompletionMessage;
  return (
    (m.role === "user" || m.role === "assistant" || m.role === "system") &&
    typeof m.content === "string" &&
    m.content.length > 0
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

  if (!model || !isValidModelId(model, auth.mode)) {
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

  if (!Array.isArray(messages) || messages.length === 0) {
    return Response.json({ error: "Messages are required" }, { status: 400 });
  }

  if (!messages.every(isValidMessage)) {
    return Response.json({ error: "Invalid message format" }, { status: 400 });
  }

  const modelChain = resolveModelChain(model, auth.mode);
  let lastError = "All models unavailable";

  try {
    for (const tryModel of modelChain) {
      const upstream = await createOpenRouterStream(
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
      if (!isModelUnavailableError(upstream.status, lastError)) {
        return Response.json({ error: lastError }, { status: upstream.status });
      }
    }

    return Response.json({ error: lastError }, { status: 502 });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to reach OpenRouter";
    return Response.json({ error: message }, { status: 500 });
  }
}
