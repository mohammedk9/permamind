import type { Conversation, ConversationMetadata, Message, Project } from "@/types/chat";

import { announceStorageFull, persistOrAnnounce } from "./storage-health";

const STORAGE_KEY = "permamind:chat:v1";

/**
 * Outcome of a localStorage write.
 *
 * The old implementation swallowed every exception and returned void, so callers
 * could not tell a successful save from a discarded one. A full quota made the
 * user lose every new message with no warning, while the UI still showed the
 * reply as saved.
 */
export type SaveResult =
  | { ok: true }
  | { ok: false; reason: "quota" | "unavailable"; bytes: number };

interface StoredMessage {
  id: string;
  role: Message["role"];
  content: string;
  createdAt: string;
  sources?: Message["sources"];
}

interface StoredMetadata {
  summary: string;
  topics: string[];
  tags: string[];
  entities: string[];
  messageFingerprint: string;
  generatedAt: string;
  facts?: ConversationMetadata["facts"];
  decisions?: ConversationMetadata["decisions"];
  project?: ConversationMetadata["project"];
}

interface StoredConversation {
  id: string;
  title: string;
  messages: StoredMessage[];
  createdAt: string;
  updatedAt: string;
  metadata?: StoredMetadata;
  permanentMemory?: boolean;
  starred?: boolean;
  projectId?: string;
  syncToCloud?: boolean;
  linkedConversationIds?: string[];
}

interface StoredProject extends Omit<Project, "createdAt" | "updatedAt"> { createdAt: string; updatedAt: string; }

interface StoredChatData {
  version: 1;
  conversations: StoredConversation[];
  activeId: string | null;
  projects?: StoredProject[];
}

export interface LoadedChatData {
  conversations: Conversation[];
  activeId: string | null;
  projects: Project[];
}

function serializeMetadata(
  metadata: ConversationMetadata
): StoredMetadata {
  return {
    summary: metadata.summary,
    topics: metadata.topics,
    tags: metadata.tags,
    entities: metadata.entities,
    messageFingerprint: metadata.messageFingerprint,
    generatedAt: metadata.generatedAt.toISOString(),
    facts: metadata.facts,
    decisions: metadata.decisions,
    project: metadata.project,
  };
}

function deserializeMetadata(stored: StoredMetadata): ConversationMetadata {
  return {
    summary: stored.summary,
    topics: stored.topics ?? [],
    tags: stored.tags ?? [],
    entities: stored.entities ?? [],
    messageFingerprint: stored.messageFingerprint,
    generatedAt: new Date(stored.generatedAt),
    facts: stored.facts ?? [],
    decisions: stored.decisions ?? [],
    project: stored.project,
  };
}

function serializeMessage(message: Message): StoredMessage {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    createdAt: message.createdAt.toISOString(),
    sources: message.sources,
  };
}

function serializeConversation(conversation: Conversation): StoredConversation {
  return {
    id: conversation.id,
    title: conversation.title,
    messages: conversation.messages
      .filter((m) => !m.isStreaming && m.content.length > 0)
      .map(serializeMessage),
    createdAt: conversation.createdAt.toISOString(),
    updatedAt: conversation.updatedAt.toISOString(),
    metadata: conversation.metadata
      ? serializeMetadata(conversation.metadata)
      : undefined,
    permanentMemory: conversation.permanentMemory,
    starred: conversation.starred,
    projectId: conversation.projectId,
    syncToCloud: conversation.syncToCloud,
    linkedConversationIds: conversation.linkedConversationIds?.length
      ? conversation.linkedConversationIds
      : undefined,
  };
}

function deserializeMessage(stored: StoredMessage): Message {
  return {
    id: stored.id,
    role: stored.role,
    content: stored.content,
    createdAt: new Date(stored.createdAt),
    sources: stored.sources,
  };
}

function deserializeConversation(stored: StoredConversation): Conversation {
  const createdAt = new Date(stored.createdAt);
  return {
    id: stored.id,
    title: stored.title,
    messages: stored.messages.map(deserializeMessage),
    createdAt,
    updatedAt: new Date(stored.updatedAt),
    metadata: stored.metadata
      ? deserializeMetadata(stored.metadata)
      : undefined,
    permanentMemory: stored.permanentMemory,
    starred: stored.starred,
    projectId: stored.projectId,
    syncToCloud: stored.syncToCloud,
    linkedConversationIds: stored.linkedConversationIds?.filter(
      (id): id is string => typeof id === "string" && id.length > 0 && id !== stored.id,
    ),
  };
}

export function loadChatData(): LoadedChatData {
  if (typeof window === "undefined") {
    return { conversations: [], activeId: null, projects: [] };
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { conversations: [], activeId: null, projects: [] };

    const data = JSON.parse(raw) as StoredChatData;
    if (data.version !== 1 || !Array.isArray(data.conversations)) {
      return { conversations: [], activeId: null, projects: [] };
    }

    const conversations = data.conversations.map(deserializeConversation);
    const activeId =
      data.activeId && conversations.some((c) => c.id === data.activeId)
        ? data.activeId
        : conversations[0]?.id ?? null;

    const projects = (data.projects ?? []).map((project) => ({ ...project, createdAt: new Date(project.createdAt), updatedAt: new Date(project.updatedAt) }));
    return { conversations, activeId, projects };
  } catch {
    return { conversations: [], activeId: null, projects: [] };
  }
}

/**
 * Persists conversations, projects, and the active selection.
 *
 * Returns whether the write actually landed. On a full quota the payload is
 * discarded by the browser and `STORAGE_FULL_EVENT` is dispatched so the shell
 * can warn the user and offer an export before anything is lost.
 */
export function saveChatData(
  conversations: Conversation[],
  activeId: string | null,
  projects: Project[] = []
): SaveResult {
  if (typeof window === "undefined") return { ok: false, reason: "unavailable", bytes: 0 };

  const data: StoredChatData = {
    version: 1,
    conversations: conversations.map(serializeConversation),
    activeId,
    projects: projects.map((project) => ({ ...project, createdAt: project.createdAt.toISOString(), updatedAt: project.updatedAt.toISOString() })),
  };

  const serialized = JSON.stringify(data);
  if (persistOrAnnounce(STORAGE_KEY, serialized)) return { ok: true };

  // persistOrAnnounce already dispatched the event; report the same outcome so
  // callers and listeners can never disagree about what happened.
  return { ok: false, reason: "quota", bytes: serialized.length * 2 };
}

/**
 * Re-export so a caller that only needs to warn on a failed write does not have
 * to import from two modules.
 */
export { announceStorageFull };

