import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { AiProvider, ApiKeyMode } from "@/lib/settings/api-key-storage";

export { HEADER_AI_PROVIDER, HEADER_API_MODE, HEADER_OPENROUTER_KEY } from "@/lib/ai/request-headers";
import { HEADER_AI_PROVIDER, HEADER_API_MODE, HEADER_OPENROUTER_KEY } from "@/lib/ai/request-headers";

export interface ResolvedRequestAuth {
  apiKey: string;
  mode: ApiKeyMode;
  isUserKey: boolean;
  provider: AiProvider;
  baseUrl?: string;
  modelName?: string;
}

/**
 * Resolves API key for a single request. Never persisted or logged.
 * Priority: user header (BYOK) → server env (free fallback).
 */
export function resolveRequestAuth(request: Request): ResolvedRequestAuth {
  const modeHeader = request.headers.get(HEADER_API_MODE)?.toLowerCase();
  const mode: ApiKeyMode = modeHeader === "byok" ? "byok" : "free";

  const userKey = request.headers.get(HEADER_OPENROUTER_KEY)?.trim();
  const providerHeader = request.headers.get(HEADER_AI_PROVIDER)?.toLowerCase();
  const providers: AiProvider[] = ["openrouter", "openai", "anthropic", "google", "deepseek", "qwen", "kimi", "meta", "grok", "nanogpt", "eden", "orcarouter", "unorouter", "llm7", "huggingface", "custom"];
  const provider = providers.includes(providerHeader as AiProvider) ? providerHeader as AiProvider : "openrouter";
  const baseUrl = request.headers.get("x-ai-base-url")?.trim();
  const modelName = request.headers.get("x-ai-model")?.trim();

  if (userKey && userKey.length > 512) throw new Error("API key is too long");
  if (modelName && modelName.length > 200) throw new Error("A valid model name is required");
  if (provider === "custom") {
    if (!baseUrl || !isSafeCustomUrl(baseUrl)) throw new Error("Custom AI URL must be a public HTTPS URL");
    if (!modelName) throw new Error("A valid custom model is required");
  }

  if (mode === "byok") {
    if (!userKey) {
      throw new Error(
        "BYOK mode requires an API key. Add your OpenRouter key in Settings."
      );
    }
    return { apiKey: userKey, mode: "byok", isUserKey: true, provider, baseUrl, modelName };
  }

  if (userKey) {
    return { apiKey: userKey, mode: "byok", isUserKey: true, provider, baseUrl, modelName };
  }

  const hasFreeProvider = Boolean(
    process.env.OPENROUTER_API_KEY?.trim() ||
    process.env.GROQ_API_KEY?.trim() ||
    process.env.GOOGLE_AI_API_KEY?.trim() ||
    process.env.GOOGLE_API_KEY?.trim()
  );
  if (hasFreeProvider) {
    return { apiKey: "server-managed", mode: "free", isUserKey: false, provider: "openrouter" };
  }

  throw new Error(
    "Free mode needs a configured server AI key or switch to BYOK in Settings with your own key."
  );
}

/** Reject SSRF targets. Custom providers must be public HTTPS endpoints. */
export function isSafeCustomUrl(value: string): boolean {
  return customUrlError(value) === null;
}

const MAX_CUSTOM_REDIRECTS = 5;

/** Returns a privacy-safe rejection reason, or null when the URL shape is acceptable. */
export function customUrlError(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return "Custom AI URL must be a public HTTPS URL";
    if (isBlockedHost(url.hostname)) return "Custom AI URL must resolve to a public address";
    return null;
  } catch {
    return "Custom AI URL must be a public HTTPS URL";
  }
}

function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host || host === "localhost" || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".localhost")) return true;
  return isIP(host) !== 0 && isBlockedAddress(host);
}

function isBlockedAddress(address: string): boolean {
  const value = address.toLowerCase().replace(/^\[|\]$/g, "");
  const mapped = value.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isBlockedAddress(mapped[1]);
  if (value.includes(":")) {
    const collapsed = expandIpv6(value);
    if (!collapsed) return true;
    const first = Number.parseInt(collapsed.split(":")[0], 16);
    return (
      collapsed === "0000:0000:0000:0000:0000:0000:0000:0001" ||
      (first & 0xfe00) === 0xfc00 ||
      (first & 0xffc0) === 0xfe80 ||
      collapsed.startsWith("2001:0000:")
    );
  }
  const parts = value.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0)) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
}

function expandIpv6(value: string): string | null {
  const halves = value.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  if ([...left, ...right].some((part) => !/^[0-9a-f]{1,4}$/.test(part))) return null;
  const missing = 8 - left.length - right.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return null;
  return [...left, ...Array<string>(missing).fill("0"), ...right].map((part) => part.padStart(4, "0")).join(":");
}

export type DnsLookup = (hostname: string) => Promise<ReadonlyArray<{ address: string }>>;

async function defaultLookup(hostname: string): Promise<ReadonlyArray<{ address: string }>> {
  return lookup(hostname, { all: true, verbatim: true });
}

/** Resolves every address and rejects hosts with any private, local, or unusable result. */
export async function assertPublicHttpsUrl(value: string, resolve: DnsLookup = defaultLookup): Promise<URL> {
  const shape = customUrlError(value);
  if (shape) throw new Error(shape);
  const url = new URL(value);
  const host = url.hostname.replace(/^\[|\]$/g, "");
  let records: ReadonlyArray<{ address: string }>;
  try {
    records = isIP(host) ? [{ address: host }] : await resolve(host);
  } catch {
    throw new Error("Custom AI URL could not be resolved to a public address");
  }
  if (records.length === 0 || records.some((record) => isBlockedAddress(record.address))) {
    throw new Error("Custom AI URL must resolve to a public address");
  }
  return url;
}

function redirectTarget(current: URL, location: string | null): URL | null {
  if (!location) return null;
  try {
    return new URL(location, current);
  } catch {
    return null;
  }
}

/**
 * Sends one request without automatic redirects. Every redirect target is
 * resolved and checked before the user's key or conversation follows it.
 */
export async function fetchPublicHttps(initial: URL, init: RequestInit, resolve?: DnsLookup): Promise<Response> {
  let current = await assertPublicHttpsUrl(initial.href, resolve);
  for (let redirect = 0; redirect <= MAX_CUSTOM_REDIRECTS; redirect += 1) {
    const response = await fetch(current, { ...init, redirect: "manual" });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    if (redirect === MAX_CUSTOM_REDIRECTS) throw new Error("Custom AI URL redirected too many times");
    const target = redirectTarget(current, response.headers.get("location"));
    if (!target) throw new Error("Custom AI URL returned an invalid redirect");
    current = await assertPublicHttpsUrl(target.href, resolve);
  }
  throw new Error("Custom AI URL redirected too many times");
}
