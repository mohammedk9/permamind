import { describe, expect, it } from "vitest";
import { buildWeeklyPlan, exportProjectMarkdown, mergeProjectFromConversations, projectConversationContext } from "../context";
import type { Conversation, Project } from "@/types/chat";

const date = new Date("2026-01-01T00:00:00Z");
const project: Project = { id: "p", name: "Atlas", summary: "", goals: [], tasks: [], decisions: [], openQuestions: [], createdAt: date, updatedAt: date };
const conversation: Conversation = {
  id: "c", title: "Planning", projectId: "p", createdAt: date, updatedAt: date,
  messages: [{ id: "secret", role: "user", content: "private message body that must stay out", createdAt: date }],
  metadata: {
    summary: "Atlas needs a rollback plan.", topics: [], tags: [], entities: [], messageFingerprint: "1", generatedAt: date,
    facts: [{ category: "goal", value: "Ship safely" }, { category: "constraint", value: "Which region?" }],
    decisions: [{ decision: "Use blue-green", status: "active" }],
    project: { name: "Atlas", goal: "Ship safely", tasks: ["Write tests", "Write tests"] },
  },
};

describe("project context", () => {
  it("merges extracted metadata without message text", () => {
    const merged = mergeProjectFromConversations(project, [conversation]);
    const serialized = JSON.stringify(merged);
    expect(merged.summary).toContain("rollback");
    expect(merged.tasks).toEqual(["Write tests"]);
    expect(merged.decisions).toEqual(["Use blue-green"]);
    expect(serialized).not.toContain("private message body");
  });

  it("injects only the project summary into a project conversation", () => {
    const merged = mergeProjectFromConversations(project, [conversation]);
    const context = projectConversationContext(merged);
    expect(context).toContain("Atlas needs a rollback plan.");
    expect(context).not.toContain("Write tests");
    expect(context).not.toContain("Use blue-green");
  });

  it("exports markdown sections and a local weekly plan", () => {
    const merged = mergeProjectFromConversations(project, [conversation]);
    const markdown = exportProjectMarkdown(merged, [conversation]);
    expect(markdown).toContain("## Summary");
    expect(markdown).toContain("## Conversations");
    expect(markdown).toContain("Planning");
    expect(markdown).not.toContain("private message body");
    expect(buildWeeklyPlan(merged.tasks)).toContain("### Monday");
    expect(buildWeeklyPlan([])).toContain("No open tasks");
  });
});
