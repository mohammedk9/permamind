"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { streamChatCompletion } from "@/lib/chat/stream-client";
import { isValidModelId } from "@/lib/ai/models";
import type { ChatCompletionMessage } from "@/lib/ai/types";
import type { ApiKeyMode } from "@/lib/settings/api-key-storage";
import type { TokenUsage } from "@/types/analytics";

export interface SendMessageResult {
  success: boolean;
  usage: TokenUsage | null;
}

interface UseChatCompletionOptions {
  mode: ApiKeyMode;
  defaultModelId: string;
  getRequestHeaders: () => Record<string, string>;
}

export function useChatCompletion({
  mode,
  defaultModelId,
  getRequestHeaders,
}: UseChatCompletionOptions) {
  const [model, setModel] = useState(defaultModelId);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setModel((current) =>
      isValidModelId(current, mode) ? current : defaultModelId
    );
  }, [defaultModelId, mode]);

  const sendMessage = useCallback(
    async (
      messages: ChatCompletionMessage[],
      onChunk: (text: string) => void
    ): Promise<SendMessageResult> => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setIsLoading(true);
      setError(null);

      return new Promise((resolve) => {
        let usage: TokenUsage | null = null;

        streamChatCompletion({
          model,
          messages,
          headers: getRequestHeaders(),
          signal: controller.signal,
          onChunk,
          onComplete: (u) => {
            usage = u;
            setIsLoading(false);
            abortRef.current = null;
            resolve({ success: true, usage });
          },
          onError: (message) => {
            setIsLoading(false);
            setError(message);
            abortRef.current = null;
            resolve({ success: false, usage: null });
          },
        });
      });
    },
    [getRequestHeaders, model]
  );

  const clearError = useCallback(() => setError(null), []);

  return {
    model,
    setModel,
    isLoading,
    error,
    clearError,
    sendMessage,
  };
}
