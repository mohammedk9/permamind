import type { Conversation } from "@/types/chat";

export interface ConversationExport {
  exportedAt: string;
  source: "local-device";
  conversations: Array<{
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    messages: Array<{
      id: string;
      role: Conversation["messages"][number]["role"];
      content: string;
      createdAt: string;
    }>;
  }>;
}

export function buildConversationExport(conversations: Conversation[], exportedAt = new Date()): ConversationExport {
  return {
    exportedAt: exportedAt.toISOString(),
    source: "local-device",
    conversations: conversations.map((conversation) => ({
      id: conversation.id,
      title: conversation.title,
      createdAt: conversation.createdAt.toISOString(),
      updatedAt: conversation.updatedAt.toISOString(),
      messages: conversation.messages
        .filter((message) => !message.isStreaming && message.content.trim())
        .map((message) => ({
          id: message.id,
          role: message.role,
          content: message.content,
          createdAt: message.createdAt.toISOString(),
        })),
    })),
  };
}

export function conversationExportFileName(exportedAt = new Date()): string {
  return `permamind-conversations-${exportedAt.toISOString().replace(/[:.]/g, "-")}.json`;
}
