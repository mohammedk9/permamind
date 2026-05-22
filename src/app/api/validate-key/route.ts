import { validateOpenRouterKey } from "@/lib/ai/openrouter";
import { HEADER_OPENROUTER_KEY } from "@/lib/ai/request-auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const apiKey = request.headers.get(HEADER_OPENROUTER_KEY)?.trim();

  if (!apiKey) {
    return Response.json(
      { valid: false, error: "API key is required" },
      { status: 400 }
    );
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
