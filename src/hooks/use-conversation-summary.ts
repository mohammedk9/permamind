"use client";

import { useCallback, useRef, useState } from "react";

import { fetchConversationSummary } from "@/lib/chat/summarize-client";
import {
  getMessageFingerprint,
  needsSummary,
} from "@/lib/ai/summarize";
import type { Conversation, Message } from "@/types/chat";

const DEBOUNCE_MS = 2000;

function toApiMessages(messages: Message[]) {
  return messages
    .filter((m) => !m.isStreaming && m.content.trim())
    .map((m) => ({ role: m.role, content: m.content }));
}

export function useConversationSummary(
  getConversation: (id: string) => Conversation | undefined,
  updateConversation: (
    id: string,
    updater: (c: Conversation) => Conversation
  ) => void
) {
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map()
  );
  const inflightRef = useRef<Set<string>>(new Set());
  const [summarizingIds, setSummarizingIds] = useState<Set<string>>(new Set());

  const generateSummary = useCallback(
    async (conversationId: string) => {
      const conversation = getConversation(conversationId);
      if (!conversation || !needsSummary(conversation.messages, conversation.metadata)) {
        return;
      }

      if (inflightRef.current.has(conversationId)) return;

      inflightRef.current.add(conversationId);
      setSummarizingIds((prev) => new Set(prev).add(conversationId));

      const apiMessages = toApiMessages(conversation.messages);
      const parsed = await fetchConversationSummary(apiMessages);

      inflightRef.current.delete(conversationId);
      setSummarizingIds((prev) => {
        const next = new Set(prev);
        next.delete(conversationId);
        return next;
      });

      if (!parsed) return;

      const fingerprint = getMessageFingerprint(conversation.messages);

      updateConversation(conversationId, (c) => ({
        ...c,
        metadata: {
          summary: parsed.summary,
          topics: parsed.topics,
          tags: parsed.tags,
          entities: parsed.entities,
          messageFingerprint: fingerprint,
          generatedAt: new Date(),
        },
      }));
    },
    [getConversation, updateConversation]
  );

  const queueSummary = useCallback(
    (conversationId: string) => {
      const existing = timersRef.current.get(conversationId);
      if (existing) clearTimeout(existing);

      const timeout = setTimeout(() => {
        timersRef.current.delete(conversationId);
        void generateSummary(conversationId);
      }, DEBOUNCE_MS);

      timersRef.current.set(conversationId, timeout);
    },
    [generateSummary]
  );

  const isSummarizing = useCallback(
    (conversationId: string) => summarizingIds.has(conversationId),
    [summarizingIds]
  );

  return { queueSummary, isSummarizing };
}
