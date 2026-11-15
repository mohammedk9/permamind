import type { Conversation, ConversationMetadata, Message, Project } from "@/types/chat";

import { announceStorageFull } from "./storage-health";
import { createJsonStore } from "./json-store";

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
  mcpAllowed?: boolean;
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
    mcpAllowed: conversation.mcpAllowed,
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
    mcpAllowed: stored.mcpAllowed,
    linkedConversationIds: stored.linkedConversationIds?.filter(
      (id): id is string => typeof id === "string" && id.length > 0 && id !== stored.id,
    ),
  };
}

/**
 * The conversation document.
 *
 * IndexedDB is the backend in a browser; localStorage remains the fallback for
 * private modes and for non-browser test environments. Either way the API stays
 * synchronous, which is what every caller already expects.
 */
function parseStoredChatData(value: unknown): StoredChatData | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Partial<StoredChatData>;
  if (data.version !== 1 || !Array.isArray(data.conversations)) return null;
  return {
    version: 1,
    conversations: data.conversations,
    activeId: typeof data.activeId === "string" ? data.activeId : null,
    projects: Array.isArray(data.projects) ? data.projects : [],
  };
}

const emptyChatData: StoredChatData = { version: 1, conversations: [], activeId: null, projects: [] };

const chatStore = createJsonStore<StoredChatData>({
  key: STORAGE_KEY,
  fallback: emptyChatData,
  parse: parseStoredChatData,
});

/**
 * Loads the conversation document from IndexedDB into the synchronous cache.
 *
 * Awaited once at startup (see `hydrateLocalStores`). Callers that read before
 * it resolves still get the legacy localStorage copy, so the first paint is
 * never empty on a device that already has data.
 */
export function hydrateChatData(): Promise<void> {
  return chatStore.hydrate();
}

export function loadChatData(): LoadedChatData {
  const stored = chatStore.load();
  const conversations = stored.conversations.map(deserializeConversation);
  const activeId =
    stored.activeId && conversations.some((c) => c.id === stored.activeId)
      ? stored.activeId
      : conversations[0]?.id ?? null;

  const projects = (stored.projects ?? []).map((project) => ({ ...project, createdAt: new Date(project.createdAt), updatedAt: new Date(project.updatedAt) }));
  return { conversations, activeId, projects };
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
  if (chatStore.save(data)) return { ok: true };

  // A failed write already dispatched STORAGE_FULL_EVENT; report the same
  // outcome so callers and listeners can never disagree about what happened.
  return { ok: false, reason: "quota", bytes: serialized.length * 2 };
}

/**
 * Re-export so a caller that only needs to warn on a failed write does not have
 * to import from two modules.
 */
export { announceStorageFull };

