/**
 * The three ways a chat request can be answered, and how they map onto settings.
 *
 * The app already stores the two underlying facts — `mode` ("free" | "byok") and
 * `provider` — but it stored them independently. That left states the UI could
 * not explain: `mode: "free"` with `provider: "ollama"` still routed to the local
 * model, because `getRequestHeaders()` checks the provider before the mode. This
 * module is the single place that keeps the two consistent.
 */

import type { AiProvider, ApiKeyMode } from "@/lib/settings/api-key-storage";

/** What the user picked in Settings. */
export type ChatPlan = "free" | "byok" | "local";

/**
 * The provider BYOK falls back to when the user leaves the local model.
 *
 * OpenRouter is the app's default provider, so it is the least surprising place
 * to land when the user switches away from a plan that had no key at all.
 */
export const DEFAULT_BYOK_PROVIDER: AiProvider = "openrouter";

/** The settings fields a plan is expressed in. */
export interface PlanSettings {
  mode: ApiKeyMode;
  provider: AiProvider;
}

/**
 * The settings a plan choice must produce.
 *
 * `local` needs no key, so it is stored as BYOK with the Ollama provider and the
 * local base URL applied by the settings hook. `free` keeps the current provider
 * unless it is the local one, which would otherwise keep routing locally.
 */
export function resolvePlan(plan: ChatPlan, current: PlanSettings): PlanSettings {
  if (plan === "local") return { mode: "byok", provider: "ollama" };
  if (current.provider === "ollama") return { mode: plan, provider: DEFAULT_BYOK_PROVIDER };
  return { mode: plan, provider: current.provider };
}

/** Which plan the stored settings describe. */
export function currentPlan(settings: PlanSettings): ChatPlan {
  if (settings.provider === "ollama") return "local";
  return settings.mode === "byok" ? "byok" : "free";
}

/**
 * Host names that mean "the app is running on the user's own machine".
 *
 * The local plan calls `http://127.0.0.1:11434` **from the server**. That is the
 * user's Ollama only when the server is the user's machine — `npm run dev` on a
 * laptop. On a hosted deployment the same probe would ask the *server's* own
 * localhost, so offering "use the local model" there would offer something that
 * cannot work.
 *
 * The page's own hostname is the cheapest honest signal: if the user opened
 * `http://localhost:3000`, the server answering the probe is the machine they are
  * sitting at.
 */
export function isLocalHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";
}

/**
 * Whether the local plan can be offered at all.
 *
 * `null` hostname (a non-browser context, or a test) counts as not local: the
 * safe default is to offer only what certainly works.
 */
export function canOfferLocalPlan(hostname: string | null | undefined): boolean {
  return typeof hostname === "string" && isLocalHost(hostname);
}
