import { validateOpenRouterKey, validateProviderKey } from "@/lib/ai/openrouter";
import { HEADER_OPENROUTER_KEY, isSafeCustomUrl } from "@/lib/ai/request-auth";
import { HEADER_AI_PROVIDER } from "@/lib/ai/request-auth";
import { requireUser } from "@/lib/supabase/server";
import { checkRateLimit, rateLimitIdentifier } from "@/lib/ai/rate-limit";
import type { AiProvider } from "@/lib/settings/api-key-storage";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
const VALIDATIONS_PER_MINUTE = 5;

export async function POST(request: Request) {
  // Require a signed-in account so this endpoint cannot be used as an
  // anonymous key-checking oracle against upstream providers.
  const { user } = await requireUser();
  if (!user) return NextResponse.json({ valid: false, error: "Sign in required" }, { status: 401 });

  // Tight per-account limit: validation is a single cheap upstream call,
  // but it must not become a scanning tool either.
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const limiter = checkRateLimit(rateLimitIdentifier(ip, user.id), VALIDATIONS_PER_MINUTE);
  if (!limiter.allowed) {
    return NextResponse.json(
      { valid: false, error: "Too many validation attempts. Please wait a moment." },
      { status: 429, headers: { "Retry-After": String(limiter.retryAfterSeconds) } }
    );
  }

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
    if (!baseUrl || !isSafeCustomUrl(baseUrl)) return Response.json({ valid: false, error: "Custom URL must be a public HTTPS endpoint" }, { status: 400 });
    return Response.json({ valid: true });
  }
  if (provider === "openrouter") {
    const result = await validateOpenRouterKey(apiKey);
    return Response.json(
      result.valid
        ? { valid: true }
        : { valid: false, error: result.error ?? "Invalid API key" },
      { status: result.valid ? 200 : 401 }
    );
  }

  const result = await validateProviderKey(provider as AiProvider, apiKey);
  if (result.valid) {
    return Response.json(result.deferred ? { valid: true, provider, note: "Key saved; direct provider validation will occur on the first request." } : { valid: true });
  }
  return Response.json(
    { valid: false, error: result.error ?? `The ${provider} API key was rejected by the provider. Check the key and try again.` },
    { status: 401 }
  );
}
