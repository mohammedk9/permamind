import { describe, expect, it } from "vitest";
import type { Conversation } from "@/types/chat";
import { buildMemoryGraph, graphConversationNeighbors, saveMemoryGraph, loadMemoryGraph, MEMORY_GRAPH_STORAGE_KEY } from "../graph";

const conversation = (id: string, entities: string[], tags: string[], topics: string[]): Conversation => ({
  id, title: id, messages: [], createdAt: new Date(), updatedAt: new Date(),
  metadata: { summary: `${id} summary`, entities, tags, topics, messageFingerprint: id, generatedAt: new Date() },
});

describe("memory graph", () => {
  it("creates conversation, entity, tag, and topic nodes with edges", () => {
    const graph = buildMemoryGraph([conversation("a", ["Alice"], ["gardening"], ["plants"])]) ;
    expect(graph.nodes.map((n) => n.id)).toEqual(expect.arrayContaining([
      "conversation:a", "entity:alice", "tag:gardening", "topic:plants",
    ]));
    expect(graph.edges).toHaveLength(3);
  });

  it("updates graph when conversations change and persists locally", () => {
    const first = buildMemoryGraph([conversation("a", ["Alice"], [], [])]);
    const second = buildMemoryGraph([conversation("a", ["Bob"], [], [])]);
    expect(first.nodes.some((n) => n.id === "entity:alice")).toBe(true);
    expect(second.nodes.some((n) => n.id === "entity:bob")).toBe(true);
    saveMemoryGraph(second);
    expect(loadMemoryGraph()).toEqual(second);
    expect(localStorage.getItem(MEMORY_GRAPH_STORAGE_KEY)).toBeTruthy();
  });

  it("finds two-hop conversation neighbors through shared metadata", () => {
    const graph = buildMemoryGraph([
      conversation("a", ["Alice"], ["garden"], []),
      conversation("b", ["Alice"], [], ["plants"]),
    ]);
    expect(graphConversationNeighbors(graph, "a")).toEqual(new Set(["b"]));
  });

  it("keeps disconnected conversations separate", () => {
    const graph = buildMemoryGraph([conversation("a", ["Alice"], [], []), conversation("b", ["Bob"], [], [])]);
    expect(graphConversationNeighbors(graph, "a")).toEqual(new Set());
  });
});