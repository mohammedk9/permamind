"use client";

import { useCallback, useRef, useState } from "react";

import { DEFAULT_MODEL_ID, type ModelId } from "@/lib/ai/models";
import { streamChatCompletion } from "@/lib/chat/stream-client";
import type { ChatCompletionMessage } from "@/lib/ai/types";

export function useChatCompletion() {
  const [model, setModel] = useState<ModelId>(DEFAULT_MODEL_ID);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const sendMessage = useCallback(
    async (
      messages: ChatCompletionMessage[],
      onChunk: (text: string) => void
    ): Promise<boolean> => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setIsLoading(true);
      setError(null);

      return new Promise((resolve) => {
        streamChatCompletion({
          model,
          messages,
          signal: controller.signal,
          onChunk,
          onDone: () => {
            setIsLoading(false);
            abortRef.current = null;
            resolve(true);
          },
          onError: (message) => {
            setIsLoading(false);
            setError(message);
            abortRef.current = null;
            resolve(false);
          },
        });
      });
    },
    [model]
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
