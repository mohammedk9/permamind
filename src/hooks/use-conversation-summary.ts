"use client";

import { useCallback, useRef, useState } from "react";

import { fetchConversationSummary } from "@/lib/chat/summarize-client";
import {
  getMessageFingerprint,
  needsSummary,
} from "@/lib/ai/summarize";
import { getSummaryModel } from "@/lib/ai/summary-model";
import type { ApiKeyMode } from "@/lib/settings/api-key-storage";
import type { TokenUsage } from "@/types/analytics";
import type { Conversation, Message, Project } from "@/types/chat";
import { syncExtractedMemory } from "@/lib/memory/ledger";
import { mergeProjectFromConversations } from "@/lib/projects/context";

const DEBOUNCE_MS = 2000;

/**
 * `/api/summarize` rejects anything above 100 messages. The summary request is
 * the one that feeds the memory ledger, so an over-long history did not merely
 * fail to summarise: it stopped new facts and decisions from ever being
 * extracted. `formatConversationForSummary` already trims to its own much
 * smaller window, but the request is validated before that runs.
 */
const API_MESSAGE_LIMIT = 100;

/** Keeps the newest messages, which is what the summary describes. */
function trimToApiLimit<T extends { content: string }>(messages: T[]): T[] {
  if (messages.length <= API_MESSAGE_LIMIT) return messages;
  return messages.slice(-API_MESSAGE_LIMIT);
}

function toApiMessages(messages: Message[]) {
  return trimToApiLimit(
    messages
      .filter((m) => !m.isStreaming && m.content.trim())
      .map((m) => ({ role: m.role, content: m.content })),
  );
}

export function useConversationSummary(
  getConversation: (id: string) => Conversation | undefined,
  updateConversation: (
    id: string,
    updater: (c: Conversation) => Conversation
  ) => void,
  getRequestHeaders: () => Record<string, string>,
  mode: ApiKeyMode,
  onSummaryComplete?: (params: {
    conversationId: string;
    conversationTitle: string;
    usage: TokenUsage;
    model: string;
  }) => void,
  projects: Project[] = [],
  conversations: Conversation[] = [],
  updateProject?: (projectId: string, updater: (project: Project) => Project) => void,
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
      const parsed = await fetchConversationSummary(
        apiMessages,
        getRequestHeaders()
      );

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
          facts: parsed.facts,
          decisions: parsed.decisions,
          project: parsed.project,
        },
      }));
      syncExtractedMemory({ ...conversation, title: conversation.title, metadata: { summary: parsed.summary, topics: parsed.topics, tags: parsed.tags, entities: parsed.entities, messageFingerprint: fingerprint, generatedAt: new Date(), facts: parsed.facts, decisions: parsed.decisions, project: parsed.project } });
      const projectId = conversation.projectId;
      const project = projectId ? projects.find((item) => item.id === projectId) : undefined;
      if (project && updateProject) {
        const summarized = conversations.map((item) => item.id === conversationId ? { ...item, metadata: { summary: parsed.summary, topics: parsed.topics, tags: parsed.tags, entities: parsed.entities, messageFingerprint: fingerprint, generatedAt: new Date(), facts: parsed.facts, decisions: parsed.decisions, project: parsed.project } } : item);
        updateProject(project.id, () => mergeProjectFromConversations(project, summarized));
      }

      if (parsed.usage && onSummaryComplete) {
        onSummaryComplete({
          conversationId,
          conversationTitle: conversation.title,
          usage: parsed.usage,
          model: getSummaryModel(mode),
        });
      }
    },
    [conversations, getConversation, getRequestHeaders, mode, onSummaryComplete, projects, updateConversation, updateProject]
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
