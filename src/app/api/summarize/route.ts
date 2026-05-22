import {
  buildSummaryPrompt,
  formatConversationForSummary,
  parseSummaryResponse,
} from "@/lib/ai/summarize";
import {
  createOpenRouterCompletion,
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

export const runtime = "nodejs";

function isValidMessage(
  msg: unknown
): msg is ChatCompletionMessage {
  if (!msg || typeof msg !== "object") return false;
  const m = msg as ChatCompletionMessage;
  return (
    (m.role === "user" || m.role === "assistant") &&
    typeof m.content === "string" &&
    m.content.trim().length > 0
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

  if (!Array.isArray(messages) || messages.length < 2) {
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
      const upstream = await createOpenRouterCompletion(
        tryModel,
        prompt,
        auth.apiKey
      );

      if (!upstream.ok) {
        lastError = await parseOpenRouterError(upstream);
        if (isModelUnavailableError(upstream.status, lastError)) {
          continue;
        }
        return Response.json({ error: lastError }, { status: upstream.status });
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

    return Response.json({ error: lastError }, { status: 502 });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to generate summary";
    return Response.json({ error: message }, { status: 500 });
  }
}
