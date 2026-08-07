import type { Conversation } from "@/types/chat";

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

export function loadMemoryGraph(): MemoryGraph | null {
  if (typeof window === "undefined") return null;
  try {
    const parsed = JSON.parse(localStorage.getItem(MEMORY_GRAPH_STORAGE_KEY) ?? "null") as MemoryGraph | null;
    return parsed?.version === 1 && Array.isArray(parsed.nodes) && Array.isArray(parsed.edges) ? parsed : null;
  } catch { return null; }
}

export function saveMemoryGraph(graph: MemoryGraph): void {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(MEMORY_GRAPH_STORAGE_KEY, JSON.stringify(graph)); } catch { /* unavailable storage */ }
}

export function updateMemoryGraph(conversations: Conversation[]): MemoryGraph {
  const graph = buildMemoryGraph(conversations);
  saveMemoryGraph(graph);
  return graph;
}