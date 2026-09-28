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
  retryable: boolean;
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
  const [canRetry, setCanRetry] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    setModel((current) =>
      isValidModelId(current) ? current : defaultModelId
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
      const requestId = ++requestIdRef.current;

      setIsLoading(true);
      setError(null);
      setCanRetry(false);

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
            if (requestId !== requestIdRef.current) {
              resolve({ success: false, usage: null, retryable: false });
              return;
            }
            setIsLoading(false);
            abortRef.current = null;
            setCanRetry(false);
            resolve({ success: true, usage, retryable: false });
          },
          onError: (message, retryable) => {
            if (requestId !== requestIdRef.current) {
              resolve({ success: false, usage: null, retryable: false });
              return;
            }
            setIsLoading(false);
            if (!controller.signal.aborted) setError(message);
            setCanRetry(retryable && !controller.signal.aborted);
            abortRef.current = null;
            resolve({ success: false, usage: null, retryable });
          },
        });
      });
    },
    [getRequestHeaders, model]
  );

  const clearError = useCallback(() => {
    setError(null);
    setCanRetry(false);
  }, []);

  return {
    model,
    setModel,
    isLoading,
    error,
    canRetry,
    clearError,
    sendMessage,
  };
}
