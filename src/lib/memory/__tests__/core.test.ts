import { beforeEach, describe, expect, it } from "vitest";

import {
  buildMemoryCorpus,
  conversationBm25Scores,
  getMemoryCorpus,
  resetMemoryCorpus,
  searchMemoryCore,
} from "../core";
import type { Conversation, Message } from "@/types/chat";
import type { MemoryRecord } from "@/types/memory";

const DAY = new Date("2026-01-01T00:00:00.000Z");

function message(id: string, content: string, role: Message["role"] = "user"): Message {
  return { id, role, content, createdAt: DAY };
}

function conversation(
  id: string,
  title: string,
  options: { messages?: Message[]; summary?: string; updatedAt?: Date } = {},
): Conversation {
  return {
    id,
    title,
    messages: options.messages ?? [],
    createdAt: DAY,
    updatedAt: options.updatedAt ?? new Date("2026-01-02T00:00:00.000Z"),
    ...(options.summary
      ? {
          metadata: {
            summary: options.summary,
            topics: [],
            tags: [],
            entities: [],
            messageFingerprint: `${id}-print`,
            generatedAt: DAY,
          },
        }
      : {}),
  };
}

function record(overrides: Partial<MemoryRecord> & { id: string; text: string }): MemoryRecord {
  return {
    kind: "decision",
    conversationId: "c1",
    conversationTitle: "Launch plan",
    confidence: "medium",
    pinned: false,
    status: "active",
    source: "user",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  resetMemoryCorpus();
});

describe("memory corpus", () => {
  it("scores a conversation whose matching text is a message, not a summary", () => {
    // The regression this whole module exists for: scores used to be stored under
    // `message:<id>` and read under the conversation id, so every lookup missed
    // and BM25 contributed nothing to any ranking.
    const corpus = buildMemoryCorpus(
      [conversation("c1", "Untitled", { messages: [message("m1", "the orbit insertion burn slipped")] })],
      [],
    );

    expect(conversationBm25Scores(corpus, "orbit insertion").get("c1") ?? 0).toBeGreaterThan(0);
  });

  it("scores a conversation whose summary matches", () => {
    const corpus = buildMemoryCorpus(
      [conversation("c1", "Launch", { summary: "we compared two launch plans" })],
      [],
    );

    expect(conversationBm25Scores(corpus, "launch plans").get("c1") ?? 0).toBeGreaterThan(0);
  });

  it("scores a conversation whose ledger record matches", () => {
    const corpus = buildMemoryCorpus([conversation("c1", "Launch")], [
      record({ id: "d1", text: "launch on tuesday after the beta" }),
    ]);

    expect(conversationBm25Scores(corpus, "tuesday beta").get("c1") ?? 0).toBeGreaterThan(0);
  });

  it("indexes two-letter technical terms, which is how English is actually asked", () => {
    // "ml", "ai", "js" and "db" are the words people search for; a blanket
    // two-character cut removed exactly those and kept nothing useful.
    const corpus = buildMemoryCorpus(
      [conversation("c1", "Pipeline", { messages: [message("m1", "we picked ml over js for the pipeline")] })],
      [],
    );

    const scores = conversationBm25Scores(corpus, "ml or js");

    expect(scores.get("c1") ?? 0).toBeGreaterThan(0);
  });

  it("leaves a conversation at zero when nothing in it matches", () => {
    const corpus = buildMemoryCorpus(
      [
        conversation("c1", "Launch", { messages: [message("m1", "orbit insertion")] }),
        conversation("c2", "Groceries", { messages: [message("m2", "milk and bread")] }),
      ],
      [],
    );

    expect(conversationBm25Scores(corpus, "orbit insertion").get("c2") ?? 0).toBe(0);
  });

  it("ranks a rare term above a term that appears everywhere", () => {
    // Flat overlap scores these the same; BM25 must not.
    const corpus = buildMemoryCorpus(
      [
        conversation("common", "Standup", {
          messages: Array.from({ length: 12 }, (_, index) => message(`m${index}`, `daily standup notes ${index}`)),
        }),
        conversation("rare", "Probe", { messages: [message("p1", "the spectrometer calibration")] }),
      ],
      [],
    );

    const scores = conversationBm25Scores(corpus, "spectrometer");

    expect(scores.get("rare") ?? 0).toBeGreaterThan(scores.get("common") ?? 0);
  });

  it("caches the index for unchanged inputs", () => {
    const conversations = [conversation("c1", "Launch", { messages: [message("m1", "launch")] })];
    const records: MemoryRecord[] = [];

    expect(getMemoryCorpus(conversations, records)).toBe(getMemoryCorpus(conversations, records));
  });

  it("rebuilds when the conversations change", () => {
    const first = getMemoryCorpus(
      [conversation("c1", "Launch", { messages: [message("m1", "launch plan")] })],
      [],
    );
    const second = getMemoryCorpus(
      [
        conversation("c1", "Launch", { messages: [message("m1", "launch plan")] }),
        conversation("c2", "Other", { messages: [message("m2", "other topic")] }),
      ],
      [],
    );

    expect(second).not.toBe(first);
    expect(second.index.size).toBeGreaterThan(first.index.size);
  });
});

describe("searchMemoryCore", () => {
  const longConversation = conversation("c1", "Orbit probe", {
    // The matching message is tenth of twelve: outside the last-six window the
    // chat path used to index.
    messages: [
      message("m1", "the probe was assembled"),
      message("m2", "the probe was tested"),
      message("m3", "the probe was shipped"),
      message("m4", "the probe was delayed"),
      message("m5", "the probe was rescheduled"),
      message("m6", "the probe was reviewed"),
      message("m7", "the probe was approved"),
      message("m8", "the probe was funded"),
      message("m9", "the probe was named"),
      message("m10", "the orbit insertion burn slipped to Tuesday"),
      message("m11", "the team went home"),
      message("m12", "the meeting ended"),
    ],
  });

  it("finds a message from anywhere in a long conversation", () => {
    const hits = searchMemoryCore("orbit insertion burn", {
      conversations: [longConversation],
      records: [],
    });

    expect(hits).toHaveLength(1);
    expect(hits[0].entry.id).toBe("message:m10");
    expect(hits[0].snippet).toContain("orbit insertion");
  });

  it("keeps one hit per conversation unless asked otherwise", () => {
    const hits = searchMemoryCore("probe", { conversations: [longConversation], records: [] });

    expect(hits).toHaveLength(1);
  });

  it("can return several hits from one conversation", () => {
    const hits = searchMemoryCore("probe", {
      conversations: [longConversation],
      records: [],
      dedupePerConversation: false,
      limit: 50,
    });

    expect(hits.length).toBeGreaterThan(1);
  });

  it("prefers the user's own words over the assistant's restatement", () => {
    const hits = searchMemoryCore("budget review", {
      conversations: [
        conversation("c1", "Budget", {
          messages: [
            message("a1", "we should do the budget review next week", "assistant"),
            message("u1", "we should do the budget review next week"),
          ],
        }),
      ],
      records: [],
    });

    expect(hits[0].entry.id).toBe("message:u1");
  });

  it("matches Arabic regardless of harakat and hamza", () => {
    const hits = searchMemoryCore("الاطلاق", {
      conversations: [
        conversation("c1", "الإطلاق", {
          messages: [message("m1", "قَرَّرْنا تَأْجِيلَ الإِطْلاقِ إلى الثلاثاء")],
        }),
      ],
      records: [],
    });

    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].snippet).toContain("الإِطْلاقِ");
  });

  it("skips the excluded conversation's messages but not its summary", () => {
    const hits = searchMemoryCore("launch plan", {
      conversations: [
        conversation("c1", "Today", {
          summary: "we compared launch plans",
          messages: [message("m1", "the launch plan is ready")],
        }),
      ],
      records: [],
      excludeConversationId: "c1",
    });

    expect(hits.map((hit) => hit.entry.kind)).toEqual(["summary"]);
  });

  it("never returns a forgotten record", () => {
    const hits = searchMemoryCore("pricing idea", {
      conversations: [conversation("c1", "Launch")],
      records: [record({ id: "d1", text: "the old pricing idea", status: "forgotten" })],
    });

    expect(hits).toEqual([]);
  });

  it("returns nothing for a query with no usable tokens", () => {
    expect(searchMemoryCore(" ]", { conversations: [longConversation], records: [] })).toEqual([]);
    expect(searchMemoryCore("   ", { conversations: [longConversation], records: [] })).toEqual([]);
    expect(
      searchMemoryCore("probe", { conversations: [longConversation], records: [], limit: 0 }),
    ).toEqual([]);
  });
});