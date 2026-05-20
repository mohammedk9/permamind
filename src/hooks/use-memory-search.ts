"use client";

import { useEffect, useMemo, useState } from "react";

import {
  buildMemoryIndex,
  searchMemoryIndex,
} from "@/lib/search/memory-index";
import type { Conversation } from "@/types/chat";

const DEBOUNCE_MS = 150;

export function useMemorySearch(conversations: Conversation[]) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");

  const index = useMemo(
    () => buildMemoryIndex(conversations),
    [conversations]
  );

  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedQuery(query), DEBOUNCE_MS);
    return () => clearTimeout(timeout);
  }, [query]);

  const results = useMemo(
    () => searchMemoryIndex(index, debouncedQuery),
    [index, debouncedQuery]
  );

  const isActive = debouncedQuery.trim().length >= 2;

  const clearSearch = () => {
    setQuery("");
    setDebouncedQuery("");
  };

  return {
    query,
    setQuery,
    results,
    isActive,
    clearSearch,
    resultCount: results.length,
  };
}
