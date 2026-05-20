import type { Conversation, ConversationMetadata, Message } from "@/types/chat";

const STORAGE_KEY = "permamind:chat:v1";

interface StoredMessage {
  id: string;
  role: Message["role"];
  content: string;
  createdAt: string;
}

interface StoredMetadata {
  summary: string;
  topics: string[];
  tags: string[];
  entities: string[];
  messageFingerprint: string;
  generatedAt: string;
}

interface StoredConversation {
  id: string;
  title: string;
  messages: StoredMessage[];
  createdAt: string;
  updatedAt: string;
  metadata?: StoredMetadata;
}

interface StoredChatData {
  version: 1;
  conversations: StoredConversation[];
  activeId: string | null;
}

export interface LoadedChatData {
  conversations: Conversation[];
  activeId: string | null;
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
  };
}

function serializeMessage(message: Message): StoredMessage {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    createdAt: message.createdAt.toISOString(),
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
  };
}

function deserializeMessage(stored: StoredMessage): Message {
  return {
    id: stored.id,
    role: stored.role,
    content: stored.content,
    createdAt: new Date(stored.createdAt),
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
  };
}

export function loadChatData(): LoadedChatData {
  if (typeof window === "undefined") {
    return { conversations: [], activeId: null };
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { conversations: [], activeId: null };

    const data = JSON.parse(raw) as StoredChatData;
    if (data.version !== 1 || !Array.isArray(data.conversations)) {
      return { conversations: [], activeId: null };
    }

    const conversations = data.conversations.map(deserializeConversation);
    const activeId =
      data.activeId && conversations.some((c) => c.id === data.activeId)
        ? data.activeId
        : conversations[0]?.id ?? null;

    return { conversations, activeId };
  } catch {
    return { conversations: [], activeId: null };
  }
}

export function saveChatData(
  conversations: Conversation[],
  activeId: string | null
): void {
  if (typeof window === "undefined") return;

  const data: StoredChatData = {
    version: 1,
    conversations: conversations.map(serializeConversation),
    activeId,
  };

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Quota exceeded or private browsing — fail silently for MVP
  }
}
