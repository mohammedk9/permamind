import type { Conversation } from "@/types/chat";
import { createJsonStore } from "@/lib/storage/json-store";

export type MemoryGraphNodeType = "conversation" | "entity" | "tag" | "topic";
export interface MemoryGraphNode { id: string; type: MemoryGraphNodeType; label: string; }
export interface MemoryGraph { version: 1; nodes: MemoryGraphNode[]; edges: Array<[string, string]>; }

export const MEMORY_GRAPH_STORAGE_KEY = "permamind:memory-graph:v1";

export function graphNodeId(type: MemoryGraphNodeType, label: string): string {
  return `${type}:${label.trim().toLocaleLowerCase()}`;
}

export function buildMemoryGraph(conversations: Conversation[]): MemoryGraph {
  const nodes = new Map<string, MemoryGraphNode>();
  const edges = new Set<string>();
  const add = (type: MemoryGraphNodeType, label: string) => {
    const clean = label.trim();
    if (!clean) return;
    const id = graphNodeId(type, clean);
    nodes.set(id, { id, type, label: clean });
    return id;
  };
  for (const conversation of conversations) {
    const conversationId = add("conversation", conversation.id);
    if (!conversationId || !conversation.metadata) continue;
    for (const [type, values] of [["entity", conversation.metadata.entities], ["tag", conversation.metadata.tags], ["topic", conversation.metadata.topics]] as const) {
      for (const value of values) {
        const nodeId = add(type, value);
        if (nodeId) edges.add([conversationId, nodeId].sort().join("\0"));
      }
    }
  }
  return { version: 1, nodes: [...nodes.values()], edges: [...edges].map((e) => e.split("\0") as [string, string]) };
}

export function graphNeighbors(graph: MemoryGraph, nodeId: string): Set<string> {
  const result = new Set<string>();
  for (const [a, b] of graph.edges) {
    if (a === nodeId) result.add(b);
    if (b === nodeId) result.add(a);
  }
  return result;
}

export function graphConversationNeighbors(graph: MemoryGraph, conversationId: string): Set<string> {
  const result = new Set<string>();
  for (const node of graphNeighbors(graph, graphNodeId("conversation", conversationId))) {
    for (const neighbor of graphNeighbors(graph, node)) {
      if (neighbor.startsWith("conversation:")) {
        const id = neighbor.slice("conversation:".length);
        if (id !== conversationId) result.add(id);
      }
    }
  }
  return result;
}

const graphStore = createJsonStore<MemoryGraph | null>({
  key: MEMORY_GRAPH_STORAGE_KEY,
  fallback: null,
  parse: (value) => {
    if (!value || typeof value !== "object") return null;
    const parsed = value as Partial<MemoryGraph>;
    return parsed.version === 1 && Array.isArray(parsed.nodes) && Array.isArray(parsed.edges)
      ? { version: 1, nodes: parsed.nodes, edges: parsed.edges }
      : null;
  },
});

/** Loads the graph from IndexedDB into the synchronous cache. */
export function hydrateMemoryGraph(): Promise<void> {
  return graphStore.hydrate();
}

export function loadMemoryGraph(): MemoryGraph | null {
  return graphStore.load();
}

export function saveMemoryGraph(graph: MemoryGraph): void {
  graphStore.save(graph);
}

export function updateMemoryGraph(conversations: Conversation[]): MemoryGraph {
  const graph = buildMemoryGraph(conversations);
  saveMemoryGraph(graph);
  return graph;
}