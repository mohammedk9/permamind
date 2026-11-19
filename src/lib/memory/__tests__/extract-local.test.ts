import { beforeEach, describe, expect, it } from "vitest";

import {
  addMemoryRecord,
  loadMemoryLedger,
  syncAllMemory,
  syncLocalMemory,
} from "@/lib/memory/ledger";
import { extractLocalMemory, extractLocalMemoryFromConversation } from "../extract-local";
import type { Conversation, Message } from "@/types/chat";
import type { MemoryRecord } from "@/types/memory";

const NOW = new Date("2026-01-02T10:00:00.000Z");

function message(id: string, content: string, role: Message["role"] = "user"): Message {
  return { id, role, content, createdAt: NOW };
}

function conversation(messages: Message[], id = "c1"): Conversation {
  return { id, title: "Launch plan", messages, createdAt: NOW, updatedAt: NOW };
}

function conversationWithDecision(): Conversation {
  return conversation([
    message("m1", "قررنا استخدام PostgreSQL بدلاً من MySQL في المشروع"),
    message("m2", "أفضل Prisma علىanything آخر"),
  ]);
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("extractLocalMemory", () => {
  it("reads an Arabic decision without any AI call", () => {
    const drafts = extractLocalMemory("قررنا استخدام PostgreSQL للمشروع");

    expect(drafts).toHaveLength(1);
    expect(drafts[0].kind).toBe("decision");
    expect(drafts[0].text).toContain("PostgreSQL");
  });

  it("reads a decision written with harakat", () => {
    // The pattern list is normalised, so "قَرَّرْنا" matches as "قررنا".
    const drafts = extractLocalMemory("قَرَّرْنا تَأْجِيلَ الإِطْلاقِ أسبوعاً إضافياً");

    expect(drafts.map((draft) => draft.kind)).toContain("decision");
  });

  it("reads an Arabic preference", () => {
    const drafts = extractLocalMemory("أنا أفضّلُ TypeScript على JavaScript للمشروع");

    const preference = drafts.find((draft) => draft.kind === "preference");
    expect(preference).toBeDefined();
    expect(preference?.text).toContain("TypeScript");
  });

  it("reads an English decision", () => {
    const drafts = extractLocalMemory("We decided to migrate the database on Friday.");

    expect(drafts).toHaveLength(1);
    expect(drafts[0].kind).toBe("decision");
    expect(drafts[0].text).toBe("migrate the database on Friday");
  });

  it("reads an English preference with an apostrophe", () => {
    const drafts = extractLocalMemory("I prefer tabs over spaces in this project.");

    expect(drafts[0].kind).toBe("preference");
    expect(drafts[0].text).toContain("tabs over spaces");
  });

  it("reads the other ways people state a decision", () => {
    expect(extractLocalMemory("We agreed to ship the beta on Monday.")[0].text).toBe(
      "ship the beta on Monday",
    );
    expect(extractLocalMemory("We settled on Postgres for the primary store.")[0].text).toBe(
      "Postgres for the primary store",
    );
    expect(extractLocalMemory("We picked the smaller design for now.")[0].kind).toBe("decision");
    expect(extractLocalMemory("We've switched to a monorepo this quarter.")[0].kind).toBe("decision");
  });

  it("reads the further decision phrasings the local floor was extended to cover", () => {
    // These are the forms added so the quota-free pass keeps learning when the
    // model allowance is spent. Each must resolve to a decision, not a question.
    expect(extractLocalMemory("We chose the managed queue for now.")[0].kind).toBe("decision");
    expect(extractLocalMemory("We've opted for a monorepo this quarter.")[0].kind).toBe("decision");
    expect(extractLocalMemory("The decision is to delay the launch by a week.")[0].kind).toBe(
      "decision",
    );
    expect(extractLocalMemory("We'll go with Postgres for the primary store.")[0].kind).toBe(
      "decision",
    );
    expect(extractLocalMemory("اعتمدنا PostgreSQL بدلاً من MySQL في المشروع")[0].kind).toBe(
      "decision",
    );
    expect(extractLocalMemory("تحولنا الى architecture microservices هذا العام")[0].kind).toBe(
      "decision",
    );
  });

  it("still never turns the extended phrasings into a question", () => {
    // A question opener must win over any decision-like verb later in the sentence.
    expect(extractLocalMemory("هل اخترنا الـ architecture الصحيحة للمشروع؟")).toEqual([]);
  });

  it("keeps the negation in a decision against something", () => {
    const drafts = extractLocalMemory("We decided against a public launch this year.");

    expect(drafts).toHaveLength(1);
    expect(drafts[0].text).toBe("not a public launch this year");
  });

  it("keeps the negation in a future decision", () => {
    expect(extractLocalMemory("We will not migrate the database this quarter.")[0].text).toBe(
      "not migrate the database this quarter",
    );
    expect(extractLocalMemory("Let's not add another service for this.")[0].text).toBe(
      "not add another service for this",
    );
  });

  it("reads a negated preference as a negation, not as a preference for it", () => {
    const drafts = extractLocalMemory("I don't like morning meetings at all.");

    expect(drafts[0].kind).toBe("preference");
    expect(drafts[0].text).toBe("not morning meetings at all");
  });

  it("never turns a question into a decision", () => {
    expect(extractLocalMemory("هل قررنا استخدام Redis للتخزين المؤقت؟")).toEqual([]);
    expect(extractLocalMemory("ماذا قررنا بخصوص خطة الإطلاق؟")).toEqual([]);
  });

  it("ignores a fragment that is too short to mean anything", () => {
    expect(extractLocalMemory("قررنا")).toEqual([]);
    expect(extractLocalMemory("")).toEqual([]);
  });

  it("ignores an ordinary sentence with no decision or preference", () => {
    expect(extractLocalMemory("الطقس جميل اليوم وسأتمشى بعد العمل")).toEqual([]);
  });

  it("keeps one draft when the same statement is repeated", () => {
    const drafts = extractLocalMemory("قررنا استخدام GraphQL. قررنا استخدام GraphQL.");

    expect(drafts.filter((draft) => draft.text.includes("GraphQL"))).toHaveLength(1);
  });
});

describe("extractLocalMemoryFromConversation", () => {
  it("reads only the user's own words", () => {
    const drafts = extractLocalMemoryFromConversation(
      conversation([
        message("m1", "أخبرني ماذا قررنا"),
        message("m2", "We decided to migrate the database on Friday.", "assistant"),
      ]),
    );

    expect(drafts).toEqual([]);
  });

  it("stops at the per-conversation cap", () => {
    const drafts = extractLocalMemoryFromConversation(
      conversation(
        Array.from({ length: 12 }, (_, index) =>
          message(`m${index}`, `قررنا استخدام التقنية رقم ${index} في المشروع`),
        ),
      ),
    );

    expect(drafts.length).toBe(8);
  });
});

describe("the memory ledger and local extraction", () => {
  it("writes extracted decisions and preferences without any AI", () => {
    syncLocalMemory([conversationWithDecision()]);

    const local = loadMemoryLedger().filter((record) => record.id.startsWith("local-"));

    expect(local.length).toBeGreaterThan(0);
    expect(local.every((record) => record.source === "extracted")).toBe(true);
    expect(local.some((record) => record.kind === "decision")).toBe(true);
    expect(local.every((record) => record.status === "active")).toBe(true);
  });

  it("is idempotent: re-running the same conversation adds nothing", () => {
    const conversation = conversationWithDecision();
    syncLocalMemory([conversation]);
    const afterFirst = loadMemoryLedger().length;

    syncLocalMemory([conversation]);

    expect(loadMemoryLedger().length).toBe(afterFirst);
  });

  it("never overwrites a record the user pinned", () => {
    const text = "قررت استخدام Redis للتخزين المؤقت في المشروع";
    const id = `local-decision:c1:${text.toLowerCase()}`;

    addMemoryRecord({
      id,
      kind: "decision",
      text,
      conversationId: "c1",
      conversationTitle: "Launch plan",
      confidence: "medium",
      pinned: true,
      status: "active",
      source: "user",
      updatedAt: NOW.toISOString(),
    });

    syncLocalMemory([conversation([message("m1", text)])]);

    const stored = loadMemoryLedger().find((record) => record.id === id);
    expect(stored?.pinned).toBe(true);
    expect(stored?.source).toBe("user");
  });

  it("keeps the model's extraction working alongside the local pass", () => {
    const withSummary: Conversation = {
      ...conversation([message("m1", "قررنا استخدام Kafka للطابور في المشروع")]),
      metadata: {
        summary: "We compared Kafka and RabbitMQ.",
        topics: ["kafka"],
        tags: [],
        entities: ["Kafka"],
        messageFingerprint: "fp",
        generatedAt: NOW,
        decisions: [{ decision: "Use Kafka for the queue", reason: "ordering", status: "active" }],
      },
    };

    syncAllMemory([withSummary]);

    const records = loadMemoryLedger();
    // The model's decision and the local one are separate records; both survive.
    expect(records.some((record) => record.text.includes("Use Kafka"))).toBe(true);
    expect(records.some((record) => record.id.startsWith("local-"))).toBe(true);
  });

  it("marks an extracted record as editable rather than as a hard fact", () => {
    syncLocalMemory([conversationWithDecision()]);
    const record: MemoryRecord | undefined = loadMemoryLedger().find((item) =>
      item.id.startsWith("local-"),
    );

    expect(record?.source).toBe("extracted");
    expect(record?.pinned).toBe(false);
    expect(record?.confidence).not.toBe("high");
  });
});