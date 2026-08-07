import type { InternetSearchResult } from "./exa";

export interface MemoryContext {
  title?: string;
  summary?: string;
  content?: string;
}

interface BuildContextOptions {
  question: string;
  memory?: MemoryContext[];
  internet?: InternetSearchResult[];
  maxLength?: number;
}

const DEFAULT_MAX_LENGTH = 12000;

export function buildContext({
  question,
  memory = [],
  internet = [],
  maxLength = DEFAULT_MAX_LENGTH,
}: BuildContextOptions): string {

  const parts: string[] = [];

  if (memory.length) {
    parts.push("========== MEMORY ==========");

    for (const item of memory) {

      if (item.title)
        parts.push(`Title: ${item.title}`);

      if (item.summary)
        parts.push(`Summary: ${item.summary}`);

      if (item.content)
        parts.push(item.content);

      parts.push("");
    }
  }

  if (internet.length) {

    parts.push("========== INTERNET ==========");

    internet.forEach((result, index) => {

      parts.push(`${index + 1}. ${result.title}`);

      parts.push(result.text);

      parts.push(result.url);

      parts.push("");
    });
  }

  parts.push("========== USER QUESTION ==========");

  parts.push(question);

  let context = parts.join("\n");

  if (context.length > maxLength) {
    context = context.slice(0, maxLength);
  }

  return context;
}