import { beforeEach, describe, expect, it } from "vitest";
import {
  buildPendingDecisions,
  buildQuickCommandReply,
  buildSnapshotChanges,
  buildWeeklySummary,
} from "@/lib/chat/quick-commands";
import { addMemoryRecord } from "@/lib/memory/ledger";
import type { Conversation, Project } from "@/types/chat";
import type { MemoryRecord } from "@/types/memory";

function record(
  overrides: Partial<MemoryRecord> & { id: string; text: string },
): MemoryRecord {
  return {
    kind: "decision",
    conversationId: "c1",
    conversationTitle: "محادثة",
    confidence: "medium",
    pinned: false,
    status: "active",
    source: "extracted",
    updatedAt: "2026-09-24T12:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  window.localStorage.clear();
});

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

  it("lists decisions the local extractor wrote, with no AI summary at all", () => {
    // A user out of free messages has no `metadata.decisions`, but the local
    // extractor still writes to the ledger. This command used to answer "none".
    const reply = buildPendingDecisions(null, [], [
      record({ id: "local-1", text: "استخدام PostgreSQL بدلاً من MySQL" }),
    ]);

    expect(reply).toContain("استخدام PostgreSQL بدلاً من MySQL");
  });

  it("skips superseded and forgotten local decisions", () => {
    const reply = buildPendingDecisions(null, [], [
      record({ id: "active", text: "القرار القديم" }),
      record({ id: "gone", text: "قرار منسيّ", status: "forgotten" }),
      record({ id: "old", text: "قرار مستبدَل", status: "superseded" }),
      record({ id: "fact", text: "حقيقة وليست قراراً", kind: "fact" }),
    ]);

    expect(reply).toContain("القرار القديم");
    expect(reply).not.toContain("قرار منسيّ");
    expect(reply).not.toContain("قرار مستبدَل");
    expect(reply).not.toContain("حقيقة وليست قراراً");
  });

  it("reads the ledger when the command is invoked from the chat", () => {
    addMemoryRecord(record({ id: "local-1", text: "القرار المحلي من الدفتر" }));

    const reply = buildQuickCommandReply("decisions", {
      project: null,
      conversations: [],
      snapshot: null,
    });

    expect(reply).toContain("القرار المحلي من الدفتر");
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
