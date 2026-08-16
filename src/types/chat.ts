export type MessageRole = "user" | "assistant";

export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  createdAt: Date;
  isStreaming?: boolean;
}

export interface MemoryFact {
  value: string;
  category: "project" | "preference" | "technology" | "person" | "goal" | "constraint" | "other";
}

export interface MemoryDecision {
  decision: string;
  reason?: string;
  alternatives?: string[];
  status: "active" | "superseded" | "uncertain";
}

export interface MemoryProject {
  name: string;
  goal?: string;
  tasks?: string[];
}

export interface ConversationMetadata {
  summary: string;
  topics: string[];
  tags: string[];
  entities: string[];
  messageFingerprint: string;
  generatedAt: Date;
  facts?: MemoryFact[];
  decisions?: MemoryDecision[];
  project?: MemoryProject;
}

export interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  createdAt: Date;
  updatedAt: Date;
  metadata?: ConversationMetadata;
  /** User-controlled permanent storage flags. Optional for backwards compatibility. */
  permanentMemory?: boolean;
  starred?: boolean;
  projectId?: string;
  /** Explicit user choice to share this conversation summary with Supabase. */
  syncToCloud?: boolean;
}

export interface Project {
  id: string;
  name: string;
  description?: string;
  summary: string;
  goals: string[];
  tasks: string[];
  decisions: string[];
  openQuestions: string[];
  createdAt: Date;
  updatedAt: Date;
}
