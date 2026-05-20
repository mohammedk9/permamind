import {
  createOpenRouterStream,
  parseOpenRouterError,
} from "@/lib/ai/openrouter";
import { isValidModelId } from "@/lib/ai/models";
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

  if (!model || !isValidModelId(model)) {
    return Response.json({ error: "Invalid model" }, { status: 400 });
  }

  if (!Array.isArray(messages) || messages.length === 0) {
    return Response.json({ error: "Messages are required" }, { status: 400 });
  }

  if (!messages.every(isValidMessage)) {
    return Response.json({ error: "Invalid message format" }, { status: 400 });
  }

  try {
    const upstream = await createOpenRouterStream(model, messages);

    if (!upstream.ok) {
      const error = await parseOpenRouterError(upstream);
      return Response.json({ error }, { status: upstream.status });
    }

    if (!upstream.body) {
      return Response.json(
        { error: "No response stream from OpenRouter" },
        { status: 502 }
      );
    }

    return new Response(upstream.body, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to reach OpenRouter";
    const status = message.includes("not configured") ? 503 : 500;
    return Response.json({ error: message }, { status });
  }
}
