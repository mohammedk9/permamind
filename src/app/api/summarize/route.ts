import {
  buildSummaryPrompt,
  formatConversationForSummary,
  parseSummaryResponse,
} from "@/lib/ai/summarize";
import {
  createOpenRouterCompletion,
  parseOpenRouterError,
} from "@/lib/ai/openrouter";
import { SUMMARY_MODEL } from "@/lib/ai/summary-model";
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

  try {
    const upstream = await createOpenRouterCompletion(
      SUMMARY_MODEL,
      buildSummaryPrompt(formatted)
    );

    if (!upstream.ok) {
      const error = await parseOpenRouterError(upstream);
      return Response.json({ error }, { status: upstream.status });
    }

    const data = (await upstream.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    const content = data.choices?.[0]?.message?.content ?? "";
    const parsed = parseSummaryResponse(content);

    if (!parsed) {
      return Response.json(
        { error: "Failed to parse summary response" },
        { status: 502 }
      );
    }

    return Response.json(parsed);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to generate summary";
    const status = message.includes("not configured") ? 503 : 500;
    return Response.json({ error: message }, { status });
  }
}
