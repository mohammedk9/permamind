import { describe, expect, it } from "vitest";
import { buildPendingDecisions, buildSnapshotChanges, buildWeeklySummary } from "@/lib/chat/quick-commands";
import type { Conversation, Project } from "@/types/chat";

const now = new Date("2026-09-24T12:00:00.000Z");
const project: Project = {
  id: "project",
  name: "أطلس",
  summary: "",
  goals: [],
  tasks: ["كتابة الاختبارات"],
  decisions: ["اعتماد الخطة المحلية"],
  openQuestions: ["أي مزود نستخدم؟"],
  createdAt: now,
  updatedAt: now,
};

function conversation(id: string, updatedAt: string, extra: Partial<Conversation> = {}): Conversation {
  return {
    id,
    title: id,
    messages: [],
    createdAt: new Date(updatedAt),
    updatedAt: new Date(updatedAt),
    ...extra,
  };
}

describe("local quick commands", () => {
  it("summarizes tasks, open questions, and chats from the last week", () => {
    const reply = buildWeeklySummary(project, [
      conversation("حديثة", "2026-09-23T12:00:00.000Z"),
      conversation("قديمة", "2026-09-01T12:00:00.000Z"),
    ], now);
    expect(reply).toContain("كتابة الاختبارات");
    expect(reply).toContain("أي مزود نستخدم؟");
    expect(reply).toContain("حديثة");
    expect(reply).not.toContain("قديمة");
  });

  it("says when there is not enough data for a weekly summary", () => {
    expect(buildWeeklySummary(null, [], now)).toBe("لا توجد بيانات كافية لتلخيص هذا الأسبوع.");
  });

  it("lists pending decisions and skips superseded ones", () => {
    const reply = buildPendingDecisions(project, [
      conversation("قرار", now.toISOString(), {
        metadata: {
          summary: "", topics: [], tags: [], entities: [], messageFingerprint: "1", generatedAt: now,
          decisions: [
            { decision: "القرار النشط", status: "active" },
            { decision: "القرار المستبدل", status: "superseded" },
          ],
        },
      }),
    ]);
    expect(reply).toContain("اعتماد الخطة المحلية");
    expect(reply).toContain("القرار النشط");
    expect(reply).not.toContain("القرار المستبدل");
    expect(reply).toContain("أي مزود نستخدم؟");
  });

  it("says when no decisions or questions are pending", () => {
    expect(buildPendingDecisions(null, [])).toBe("لا توجد قرارات أو أسئلة معلّقة.");
  });

  it("reports conversations added, removed, and updated since the snapshot", () => {
    const reply = buildSnapshotChanges([
      conversation("existing", "2026-09-24T10:00:00.000Z", { title: "محدّثة" }),
      conversation("added", "2026-09-24T11:00:00.000Z", { title: "جديدة" }),
    ], { conversationIds: ["existing", "removed"], createdAt: "2026-09-20T00:00:00.000Z" });
    expect(reply).toContain("جديدة");
    expect(reply).toContain("removed");
    expect(reply).toContain("محدّثة");
  });

  it("says when no snapshot exists", () => {
    expect(buildSnapshotChanges([], null)).toBe("لا توجد نسخة محفوظة للمقارنة بعد.");
  });
});
