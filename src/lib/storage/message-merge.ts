import type { Conversation, MemoryDecision, Message } from "@/types/chat";

export interface MessageMergeResult {
  conversations: Conversation[];
  addedMessages: number;
  conflictedMessages: number;
  conflictedDecisions: number;
}

const messageKey = (message: Message) => `${message.role}\n${message.content}`;

function mergeMessages(local: Message[], remote: Message[]): { messages: Message[]; added: number; conflicts: number } {
  const byId = new Map(local.map((message) => [message.id, message]));
  let added = 0;
  let conflicts = 0;
  for (const message of remote) {
    const current = byId.get(message.id);
    if (!current) {
      byId.set(message.id, message);
      added += 1;
      continue;
    }
    if (messageKey(current) !== messageKey(message)) {
      byId.set(`${message.id}:conflict`, { ...message, id: `${message.id}:conflict` });
      conflicts += 1;
    }
  }
  return {
    messages: [...byId.values()].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()),
    added,
    conflicts,
  };
}

const decisionKey = (decision: MemoryDecision) => `${decision.reason ?? ""}\n${decision.status}`;

function mergeDecisions(local: MemoryDecision[] = [], remote: MemoryDecision[] = []) {
  const merged = [...local];
  let conflicts = 0;
  for (const decision of remote) {
    const exact = merged.find((item) => item.decision === decision.decision && decisionKey(item) === decisionKey(decision));
    if (exact) continue;
    const sameTopic = merged.some((item) => item.decision === decision.decision);
    if (sameTopic) {
      merged.push({ ...decision, status: "uncertain", reason: `Conflict kept from another device. ${decision.reason ?? ""}`.trim() });
      conflicts += 1;
    } else merged.push(decision);
  }
  return { decisions: merged, conflicts };
}

/** Combines messages by stable id and keeps both versions when content differs. */
export function mergeConversationsByMessage(local: Conversation[], remote: Conversation[]): MessageMergeResult {
  const byId = new Map(local.map((conversation) => [conversation.id, conversation]));
  let addedMessages = 0;
  let conflictedMessages = 0;
  let conflictedDecisions = 0;
  for (const incoming of remote) {
    const current = byId.get(incoming.id);
    if (!current) {
      byId.set(incoming.id, incoming);
      addedMessages += incoming.messages.length;
      continue;
    }
    const messages = mergeMessages(current.messages, incoming.messages);
    const decisions = mergeDecisions(current.metadata?.decisions, incoming.metadata?.decisions);
    addedMessages += messages.added;
    conflictedMessages += messages.conflicts;
    conflictedDecisions += decisions.conflicts;
    const newer = incoming.updatedAt.getTime() > current.updatedAt.getTime() ? incoming : current;
    byId.set(incoming.id, {
      ...current,
      title: newer.title,
      messages: messages.messages,
      updatedAt: newer.updatedAt,
      metadata: current.metadata || incoming.metadata ? {
        summary: newer.metadata?.summary ?? current.metadata?.summary ?? "",
        topics: newer.metadata?.topics ?? current.metadata?.topics ?? [],
        tags: newer.metadata?.tags ?? current.metadata?.tags ?? [],
        entities: newer.metadata?.entities ?? current.metadata?.entities ?? [],
        messageFingerprint: newer.metadata?.messageFingerprint ?? current.metadata?.messageFingerprint ?? "",
        generatedAt: newer.metadata?.generatedAt ?? current.metadata?.generatedAt ?? newer.updatedAt,
        facts: newer.metadata?.facts ?? current.metadata?.facts,
        decisions: decisions.decisions,
        project: newer.metadata?.project ?? current.metadata?.project,
      } : undefined,
    });
  }
  return { conversations: [...byId.values()], addedMessages, conflictedMessages, conflictedDecisions };
}
