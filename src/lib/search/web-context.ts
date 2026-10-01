import type { ChatCompletionMessage } from "@/lib/ai/types";
import type { SearchCitation, SearchProvider } from "@/types/memory";
import { decideSearch } from "./decision";

export const MAX_WEB_CONTEXT_CHARS = 20_000;

export function shouldSearchWeb(
  query: string,
  manuallyEnabled: boolean,
  _provider: SearchProvider = "exa"
): boolean {
  // The routing decision is provider-independent: which provider answers the
  // query never changes whether the query needs live information.
  if (manuallyEnabled) return query.trim().length > 0;
  return decideSearch(query).useInternet;
}

export function buildWebContext(query: string, results: SearchCitation[]): string {
  const question = `\n\nUser question:\n${query.trim()}`;
  const prefix = "Live web context (supporting evidence only; cite a source when using it):\n\n";
  const room = Math.max(0, MAX_WEB_CONTEXT_CHARS - question.length - prefix.length);
  const evidence = results
    .filter((item) => item.url.trim())
    .map((item, index) => {
      const source = `\nSource: ${item.url.trim()}`;
      const heading = `${index + 1}. ${item.title.trim() || item.url}`;
      const available = Math.max(0, room - heading.length - source.length - 1);
      return `${heading}\n${item.text.trim().slice(0, available)}${source}`;
    })
    .join("\n\n")
    .slice(0, room);
  const content = evidence
    ? `${prefix}${evidence}${question}`
    : `Web search ran but returned no results. Say that no live web results were found if the question depends on current information.${question}`;
  return content.slice(0, MAX_WEB_CONTEXT_CHARS);
}

export function applyWebContext(
  messages: ChatCompletionMessage[],
  query: string,
  results: SearchCitation[],
): ChatCompletionMessage[] {
  const next = [...messages];
  for (let index = next.length - 1; index >= 0; index -= 1) {
    if (next[index]?.role === "user") {
      next[index] = { ...next[index], content: buildWebContext(query, results) };
      return next;
    }
  }
  return [...next, { role: "user", content: buildWebContext(query, results) }];
}
