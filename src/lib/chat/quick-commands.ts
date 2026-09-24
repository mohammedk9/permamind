import type { Conversation, Message, Project } from "@/types/chat";
import type { SnapshotMeta } from "@/lib/arweave/snapshot-types";

export type QuickCommand = "weekly" | "decisions" | "changes";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_ITEMS = 12;

export const QUICK_COMMANDS: Array<{ id: QuickCommand; label: string }> = [
  { id: "weekly", label: "لخّص الأسبوع" },
  { id: "decisions", label: "ما القرارات المعلقة" },
  { id: "changes", label: "ماذا تغيّر منذ آخر نسخة" },
];

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const item = value.replace(/\s+/g, " ").trim();
    const key = item.toLocaleLowerCase();
    if (!item || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
    if (result.length >= MAX_ITEMS) break;
  }
  return result;
}

function list(items: string[], empty: string): string {
  return items.length ? items.map((item) => `- ${item}`).join("\n") : empty;
}

function recentConversations(conversations: Conversation[], now: Date): Conversation[] {
  const start = now.getTime() - WEEK_MS;
  return conversations
    .filter((conversation) => {
      const updated = new Date(conversation.updatedAt).getTime();
      return Number.isFinite(updated) && updated >= start && updated <= now.getTime();
    })
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, MAX_ITEMS);
}

function pendingDecisions(project: Project | null, conversations: Conversation[]): string[] {
  const projectDecisions = project?.decisions ?? [];
  const conversationDecisions = conversations.flatMap((conversation) =>
    (conversation.metadata?.decisions ?? [])
      .filter((decision) => decision.status !== "superseded")
      .map((decision) => decision.decision),
  );
  return unique([...projectDecisions, ...conversationDecisions]);
}

function openQuestions(project: Project | null, conversations: Conversation[]): string[] {
  const projectQuestions = project?.openQuestions ?? [];
  const conversationQuestions = conversations.flatMap((conversation) =>
    (conversation.metadata?.facts ?? [])
      .filter((fact) => (fact.category === "constraint" || fact.category === "other") && /[?؟]/.test(fact.value))
      .map((fact) => fact.value),
  );
  return unique([...projectQuestions, ...conversationQuestions]);
}

export function buildWeeklySummary(project: Project | null, conversations: Conversation[], now = new Date()): string {
  const tasks = unique(project?.tasks ?? []);
  const questions = openQuestions(project, conversations);
  const recent = recentConversations(conversations, now);
  if (!tasks.length && !questions.length && !recent.length) {
    return "لا توجد بيانات كافية لتلخيص هذا الأسبوع.";
  }
  return [
    "ملخص الأسبوع",
    "",
    "## المهام",
    list(tasks, "لا توجد مهام مسجّلة."),
    "",
    "## الأسئلة المفتوحة",
    list(questions, "لا توجد أسئلة مفتوحة."),
    "",
    "## محادثات آخر 7 أيام",
    list(recent.map((conversation) => conversation.title), "لا توجد محادثات خلال آخر 7 أيام."),
  ].join("\n");
}

export function buildPendingDecisions(project: Project | null, conversations: Conversation[]): string {
  const decisions = pendingDecisions(project, conversations);
  const questions = openQuestions(project, conversations);
  if (!decisions.length && !questions.length) {
    return "لا توجد قرارات أو أسئلة معلّقة.";
  }
  return [
    "القرارات المعلّقة",
    "",
    "## القرارات",
    list(decisions, "لا توجد قرارات معلّقة."),
    "",
    "## الأسئلة المفتوحة",
    list(questions, "لا توجد أسئلة مفتوحة."),
  ].join("\n");
}

export function buildSnapshotChanges(conversations: Conversation[], snapshot: Pick<SnapshotMeta, "conversationIds" | "createdAt"> | null): string {
  if (!snapshot) return "لا توجد نسخة محفوظة للمقارنة بعد.";
  const previous = new Set(snapshot.conversationIds);
  const current = new Map(conversations.map((conversation) => [conversation.id, conversation]));
  const added = conversations.filter((conversation) => !previous.has(conversation.id)).map((conversation) => conversation.title);
  const removed = snapshot.conversationIds.filter((id) => !current.has(id));
  const snapshotTime = new Date(snapshot.createdAt).getTime();
  const updated = conversations
    .filter((conversation) => previous.has(conversation.id) && Number.isFinite(snapshotTime) && new Date(conversation.updatedAt).getTime() > snapshotTime)
    .map((conversation) => conversation.title);
  if (!added.length && !removed.length && !updated.length) {
    return "لم يتغيّر شيء منذ آخر نسخة.";
  }
  return [
    "التغييرات منذ آخر نسخة",
    "",
    "## محادثات جديدة",
    list(added, "لا توجد محادثات جديدة."),
    "",
    "## محادثات حُذفت",
    list(removed, "لا توجد محادثات محذوفة."),
    "",
    "## محادثات حُدّثت",
    list(updated, "لا توجد محادثات محدّثة."),
  ].join("\n");
}

export function buildQuickCommandReply(
  command: QuickCommand,
  input: { project: Project | null; conversations: Conversation[]; snapshot: Pick<SnapshotMeta, "conversationIds" | "createdAt"> | null; now?: Date },
): string {
  if (command === "weekly") return buildWeeklySummary(input.project, input.conversations, input.now);
  if (command === "decisions") return buildPendingDecisions(input.project, input.conversations);
  return buildSnapshotChanges(input.conversations, input.snapshot);
}

export function localCommandMessages(prompt: string, reply: string, now = new Date()): [Message, Message] {
  return [
    { id: crypto.randomUUID(), role: "user", content: prompt, createdAt: now },
    { id: crypto.randomUUID(), role: "assistant", content: reply, createdAt: now },
  ];
}
