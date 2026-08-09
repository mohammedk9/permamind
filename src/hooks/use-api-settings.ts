"use client";

import { useCallback, useEffect, useState } from "react";

import { buildApiHeaders } from "@/lib/ai/client-headers";
import { getDefaultModelId } from "@/lib/ai/models";
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
    setConnectionStatus(
      stored.mode === "byok"
        ? stored.validatedAt
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

  const validateKey = useCallback(async (): Promise<boolean> => {
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
  }, [apiKey, baseUrl, modelName, persist, provider]);

  const clearKey = useCallback(() => {
    setApiKeyState("");
    setValidatedAt(undefined);
    setModeState("free");
    setConnectionStatus("connected");
    persist({ mode: "free", apiKey: "", validatedAt: undefined });
  }, [persist]);

  const setProvider = useCallback((next: AiProvider) => {
    setProviderState(next);
    setValidatedAt(undefined);
    setConnectionStatus(apiKey ? "unknown" : "not_set");
    persist({ provider: next, validatedAt: undefined });
  }, [apiKey, persist]);
  const setBaseUrl = useCallback((value: string) => { setBaseUrlState(value); persist({ baseUrl: value, validatedAt: undefined }); }, [persist]);
  const setModelName = useCallback((value: string) => { setModelNameState(value); persist({ modelName: value }); }, [persist]);

  const dismissOnboarding = useCallback(() => {
    markOnboardingSeen();
    setShowOnboarding(false);
  }, []);

  const getRequestHeaders = useCallback(() => {
    if (mode === "byok" && apiKey.trim() && validatedAt) {
      return buildApiHeaders("byok", apiKey, provider, baseUrl, modelName);
    }
    return buildApiHeaders("free");
  }, [apiKey, baseUrl, mode, modelName, provider, validatedAt]);

  const canSendRequests =
    mode === "free" ||
    (mode === "byok" &&
      apiKey.trim().length > 0 &&
      connectionStatus === "connected");

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
