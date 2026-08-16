import type { Conversation, ConversationMetadata, Message, Project } from "@/types/chat";

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
    permanentMemory: stored.permanentMemory,
    starred: stored.starred,
    projectId: stored.projectId,
    syncToCloud: stored.syncToCloud,
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

export function saveChatData(
  conversations: Conversation[],
  activeId: string | null,
  projects: Project[] = []
): void {
  if (typeof window === "undefined") return;

  const data: StoredChatData = {
    version: 1,
    conversations: conversations.map(serializeConversation),
    activeId,
    projects: projects.map((project) => ({ ...project, createdAt: project.createdAt.toISOString(), updatedAt: project.updatedAt.toISOString() })),
  };

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Quota exceeded or private browsing — fail silently for MVP
  }
}
