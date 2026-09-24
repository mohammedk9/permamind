import type { Conversation, ConversationMetadata, Project } from "@/types/chat";

const MAX_ITEMS = 12;
const MAX_ITEM_CHARS = 160;
const MAX_SUMMARY_CHARS = 700;

function clean(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, MAX_ITEM_CHARS);
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const item = clean(value);
    const key = item.toLocaleLowerCase();
    if (!item || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
    if (result.length >= MAX_ITEMS) break;
  }
  return result;
}

function extractedItems(metadata: ConversationMetadata | undefined, kind: "goal" | "task" | "question"): string[] {
  if (!metadata) return [];
  if (kind === "task") return metadata.project?.tasks ?? [];
  const categories = kind === "goal" ? new Set(["goal"]) : new Set(["constraint", "other"]);
  const facts = (metadata.facts ?? [])
    .filter((fact) => categories.has(fact.category) && (kind === "goal" || /[?؟]/.test(fact.value)))
    .map((fact) => fact.value);
  return kind === "goal" ? [metadata.project?.goal ?? "", ...facts] : facts;
}

/** Rebuilds a project from extracted metadata only. Message text is never copied. */
export function mergeProjectFromConversations(project: Project, conversations: Conversation[]): Project {
  const linked = conversations.filter((conversation) => conversation.projectId === project.id);
  const metadata = linked.map((conversation) => conversation.metadata);
  const summaries = metadata
    .map((item) => item?.summary?.trim() ?? "")
    .filter(Boolean)
    .slice(-3);
  const summary = summaries.join(" ").slice(0, MAX_SUMMARY_CHARS);

  return {
    ...project,
    summary,
    goals: unique(metadata.flatMap((item) => extractedItems(item, "goal"))),
    tasks: unique([...project.tasks, ...metadata.flatMap((item) => extractedItems(item, "task"))]),
    decisions: unique(metadata.flatMap((item) => (item?.decisions ?? []).filter((decision) => decision.status !== "superseded").map((decision) => decision.decision))),
    openQuestions: unique(metadata.flatMap((item) => extractedItems(item, "question"))),
    updatedAt: new Date(),
  };
}

/** Only the compact project summary is eligible for a project conversation. */
export function projectConversationContext(project: Project): string {
  const summary = project.summary.trim();
  if (!summary) return "";
  return `You are working inside the project "${project.name}". Use only this project summary. Do not assume tasks, decisions, or content from other project conversations unless they appear here.\n\nProject summary:\n${summary}`;
}

function section(title: string, items: string[]): string {
  return `## ${title}\n${items.length ? items.map((item) => `- ${item}`).join("\n") : "- None recorded"}`;
}

export function exportProjectMarkdown(project: Project, conversations: Conversation[]): string {
  const titles = conversations
    .filter((conversation) => conversation.projectId === project.id)
    .map((conversation) => conversation.title.trim())
    .filter(Boolean);
  return [
    `# ${project.name}`,
    "",
    project.description?.trim() || "No description recorded.",
    "",
    "## Summary",
    project.summary.trim() || "No summary recorded.",
    "",
    section("Goals", project.goals),
    "",
    section("Tasks", project.tasks),
    "",
    section("Decisions", project.decisions),
    "",
    section("Open questions", project.openQuestions),
    "",
    section("Conversations", titles),
    "",
  ].join("\n");
}

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

export function buildWeeklyPlan(tasks: string[]): string {
  const openTasks = unique(tasks);
  if (!openTasks.length) return "No open tasks to plan this week.";
  return WEEKDAYS.map((day, index) => {
    const assigned = openTasks.filter((_, taskIndex) => taskIndex % WEEKDAYS.length === index);
    return `### ${day}\n${assigned.length ? assigned.map((task) => `- ${task}`).join("\n") : "- No task assigned"}`;
  }).join("\n\n");
}
