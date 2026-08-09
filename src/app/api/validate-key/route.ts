import { validateOpenRouterKey } from "@/lib/ai/openrouter";
import { HEADER_OPENROUTER_KEY } from "@/lib/ai/request-auth";
import { HEADER_AI_PROVIDER } from "@/lib/ai/request-auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const apiKey = request.headers.get(HEADER_OPENROUTER_KEY)?.trim();

  if (!apiKey) {
    return Response.json(
      { valid: false, error: "API key is required" },
      { status: 400 }
    );
  }

  const provider = request.headers.get(HEADER_AI_PROVIDER) ?? "openrouter";
  if (provider === "custom") {
    const baseUrl = request.headers.get("x-ai-base-url")?.trim();
    if (!baseUrl || !baseUrl.startsWith("https://")) return Response.json({ valid: false, error: "Custom URL must use HTTPS" }, { status: 400 });
    return Response.json({ valid: true });
  }
  if (provider !== "openrouter") {
    return Response.json({ valid: true, provider, note: "Key saved; direct provider validation will occur on the first request." });
  }
  const result = await validateOpenRouterKey(apiKey);

  if (!result.valid) {
    return Response.json(
      { valid: false, error: result.error ?? "Invalid API key" },
      { status: 401 }
    );
  }

  return Response.json({ valid: true });
}
