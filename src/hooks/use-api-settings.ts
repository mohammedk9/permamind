"use client";

import { useCallback, useEffect, useState } from "react";

import { buildApiHeaders } from "@/lib/ai/client-headers";
import { getDefaultModelId } from "@/lib/ai/models";
import { LOCAL_OLLAMA_BASE_URL } from "@/lib/settings/api-key-storage";
import {
  loadApiSettings,
  markOnboardingSeen,
  saveApiSettings,
  hasSeenOnboarding,
  type ApiKeyMode,
  type StoredApiSettings,
  type AiProvider,
} from "@/lib/settings/api-key-storage";

export type ConnectionStatus =
  | "unknown"
  | "connected"
  | "invalid"
  | "checking"
  | "not_set";

/**
 * Whether a request may be sent at all.
 *
 * Extracted so it can be tested without a React renderer: the three inputs are
 * exactly what the hook holds, and every branch here was previously a nested
 * ternary inside the hook body, which is how "local model selected but no model
 * name" came to look sendable.
 *
 * - The free allowance needs nothing.
 * - BYOK needs a key and a successful validation.
 * - A local model needs a **name**: the server rejects a keyless request without
 *   `x-ai-model`, so letting the send through only produces a 500 the user
 *   cannot act on.
 */
export function canSendWith(input: {
  provider: AiProvider;
  mode: ApiKeyMode;
  apiKey: string;
  modelName: string;
  connectionStatus: ConnectionStatus;
}): boolean {
  if (input.provider === "ollama") {
    return input.modelName.trim().length > 0 && input.connectionStatus === "connected";
  }
  if (input.mode === "free") return true;
  return (
    input.mode === "byok" &&
    input.apiKey.trim().length > 0 &&
    input.connectionStatus === "connected"
  );
}

export function useApiSettings() {
  const [hydrated, setHydrated] = useState(false);
  const [mode, setModeState] = useState<ApiKeyMode>("free");
  const [apiKey, setApiKeyState] = useState("");
  const [provider, setProviderState] = useState<AiProvider>("openrouter");
  const [baseUrl, setBaseUrlState] = useState("");
  const [modelName, setModelNameState] = useState("");
  const [validatedAt, setValidatedAt] = useState<string | undefined>();
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>("unknown");
  const [showOnboarding, setShowOnboarding] = useState(false);

  useEffect(() => {
    const stored = loadApiSettings();
    setModeState(stored.mode);
    setApiKeyState(stored.apiKey ?? "");
    setProviderState(stored.provider ?? "openrouter");
    setBaseUrlState(stored.baseUrl ?? "");
    setModelNameState(stored.modelName ?? "");
    setValidatedAt(stored.validatedAt);
    // The API key lives in sessionStorage and may be gone at the start of a
    // new browser session even though BYOK settings persist. Only report
    // "connected" when a usable key is actually present. A stored local plan is
    // "unknown" here on purpose: whether Ollama is running is a question only a
    // probe can answer, and the effect below asks it.
    setConnectionStatus(
      stored.provider === "ollama"
        ? "unknown"
        : stored.mode === "byok"
        ? stored.apiKey && stored.validatedAt
          ? "connected"
          : stored.apiKey
            ? "unknown"
            : "not_set"
        : "connected"
    );
    setShowOnboarding(!hasSeenOnboarding());
    setHydrated(true);
  }, []);

  const persist = useCallback(
    (next: Partial<StoredApiSettings>) => {
      const merged: StoredApiSettings = {
        mode: next.mode ?? mode,
        apiKey: next.apiKey !== undefined ? next.apiKey : apiKey,
        provider: next.provider ?? provider,
        baseUrl: next.baseUrl ?? baseUrl,
        modelName: next.modelName ?? modelName,
        validatedAt: next.validatedAt !== undefined ? next.validatedAt : validatedAt,
      };
      saveApiSettings(merged);
    },
    [apiKey, baseUrl, mode, modelName, provider, validatedAt]
  );

  const setMode = useCallback(
    (next: ApiKeyMode) => {
      setModeState(next);
      persist({ mode: next });
      if (next === "free") {
        setConnectionStatus("connected");
      } else {
        setConnectionStatus(apiKey && validatedAt ? "connected" : apiKey ? "unknown" : "not_set");
      }
    },
    [apiKey, persist, validatedAt]
  );

  const setApiKey = useCallback(
    (key: string) => {
      setApiKeyState(key);
      setValidatedAt(undefined);
      setConnectionStatus(key ? "unknown" : "not_set");
      persist({ apiKey: key, validatedAt: undefined });
    },
    [persist]
  );

  /**
   * Asks the server whether the Ollama on this machine is running.
   *
   * The browser cannot answer this itself (mixed content, and Ollama's CORS is
   * opt-in), so the check goes through `/api/ai/local-status`, which probes
   * localhost from Node — the same place the chat route will call.
   */
  const probeLocalModel = useCallback(async (): Promise<boolean> => {
    setConnectionStatus("checking");
    try {
      const response = await fetch("/api/ai/local-status");
      const data = (await response.json()) as { ok?: boolean; models?: string[] };
      const models = Array.isArray(data.models) ? data.models : [];
      // Running with nothing pulled is not "connected": the chat request would
      // fail on a model name that does not exist.
      const ready = data.ok === true && models.length > 0;
      setConnectionStatus(ready ? "connected" : "invalid");
      return ready;
    } catch {
      setConnectionStatus("invalid");
      return false;
    }
  }, []);

  /**
   * Re-checks the local daemon whenever the app opens with a local plan stored.
   *
   * A stored provider is not evidence that Ollama is running today: the machine
   * may have restarted, or the daemon was never installed. Asking once at boot
   * means the settings screen and the chat input agree with reality instead of
   * showing a stale "connected".
   */
  useEffect(() => {
    if (!hydrated || provider !== "ollama") return;
    void probeLocalModel();
  }, [hydrated, provider, probeLocalModel]);

  const validateKey = useCallback(async (): Promise<boolean> => {
    // The local plan has no key to validate. What it needs is a reachable daemon,
    // which is a different question with a different failure mode.
    if (provider === "ollama") return probeLocalModel();

    const key = apiKey.trim();
    if (!key) {
      setConnectionStatus("not_set");
      return false;
    }

    setConnectionStatus("checking");

    try {
      const headers = buildApiHeaders("byok", key, provider, baseUrl, modelName);
      const response = await fetch("/api/validate-key", {
        method: "POST",
        headers,
      });

      const data = (await response.json()) as {
        valid?: boolean;
        error?: string;
      };

      if (data.valid) {
        const at = new Date().toISOString();
        setValidatedAt(at);
        setConnectionStatus("connected");
        persist({ apiKey: key, validatedAt: at, mode: "byok" });
        setModeState("byok");
        return true;
      }

      setConnectionStatus("invalid");
      return false;
    } catch {
      setConnectionStatus("invalid");
      return false;
    }
  }, [apiKey, baseUrl, modelName, persist, probeLocalModel, provider]);

  const clearKey = useCallback(() => {
    setApiKeyState("");
    setValidatedAt(undefined);
    setModeState("free");
    setConnectionStatus("connected");
    persist({ mode: "free", apiKey: "", validatedAt: undefined });
  }, [persist]);

  /**
   * Switches the provider, and with it the whole plan.
   *
   * Choosing Ollama is not just a provider change: it implies the keyless local
   * mode, so the base URL is set here and the status starts as "checking" rather
   * than "connected". Claiming "connected" before the daemon answers is what made
   * a machine without Ollama look ready to chat.
   */
  const setProvider = useCallback((next: AiProvider) => {
    setProviderState(next);
    if (next === "ollama") {
      setBaseUrlState(LOCAL_OLLAMA_BASE_URL);
      setModeState("byok");
      setValidatedAt(undefined);
      setConnectionStatus("unknown");
      persist({ provider: next, mode: "byok", baseUrl: LOCAL_OLLAMA_BASE_URL, validatedAt: undefined });
      return;
    }
    setValidatedAt(undefined);
    setConnectionStatus(apiKey ? "unknown" : "not_set");
    persist({ provider: next, validatedAt: undefined });
  }, [apiKey, persist]);
  const setBaseUrl = useCallback((value: string) => { setBaseUrlState(value); persist({ baseUrl: value, validatedAt: undefined }); }, [persist]);
  const setModelName = useCallback((value: string) => {
    setModelNameState(value);
    // A local plan is only usable with a name, so the status has to stop saying
    // "connected" the moment the name is cleared — otherwise the chat looks
    // ready and the server refuses it.
    if (provider === "ollama") setConnectionStatus(value.trim() ? connectionStatus : "invalid");
    persist({ modelName: value });
  }, [connectionStatus, persist, provider]);

  const dismissOnboarding = useCallback(() => {
    markOnboardingSeen();
    setShowOnboarding(false);
  }, []);

  const getRequestHeaders = useCallback(() => {
    if (provider === "ollama") {
      return buildApiHeaders("byok", "", provider, baseUrl || LOCAL_OLLAMA_BASE_URL, modelName);
    }
    if (mode === "byok" && apiKey.trim() && validatedAt) {
      return buildApiHeaders("byok", apiKey, provider, baseUrl, modelName);
    }
    return buildApiHeaders("free");
  }, [apiKey, baseUrl, mode, modelName, provider, validatedAt]);

  const canSendRequests = canSendWith({ provider, mode, apiKey, modelName, connectionStatus });

      const defaultModelId = getDefaultModelId();

  return {
    hydrated,
    mode,
    setMode,
    apiKey,
    provider,
    setProvider,
    baseUrl, setBaseUrl, modelName, setModelName,
    setApiKey,
    validatedAt,
    connectionStatus,
    validateKey,
    clearKey,
    getRequestHeaders,
    canSendRequests,
    defaultModelId,
    showOnboarding,
    dismissOnboarding,
  };
}
