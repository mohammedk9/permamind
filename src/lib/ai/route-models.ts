import {
  FREE_MODEL_FALLBACK_CHAIN,
  type FreeModelId,
  isFreeModelId,
  isModelUnavailableError,
} from "@/lib/ai/free-models";
import type { ApiKeyMode } from "@/lib/settings/api-key-storage";

export function resolveModelChain(
  requestedModel: string,
  mode: ApiKeyMode
): string[] {
  if (mode === "byok") {
    return [requestedModel];
  }

  const chain = [...FREE_MODEL_FALLBACK_CHAIN];

  if (isFreeModelId(requestedModel)) {
    const idx = chain.indexOf(requestedModel as FreeModelId);
    if (idx > 0) {
      return [...chain.slice(idx), ...chain.slice(0, idx)];
    }
  }

  return chain;
}

export { isModelUnavailableError };
