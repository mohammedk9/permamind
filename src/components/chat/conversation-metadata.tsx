"use client";

import type { ConversationMetadata } from "@/types/chat";

interface ConversationMetadataProps {
  metadata: ConversationMetadata;
}

export function ConversationMetadataBar({
  metadata,
}: ConversationMetadataProps) {
  const chips = [
    ...metadata.topics.slice(0, 2).map((t) => ({ label: t, type: "topic" })),
    ...metadata.tags.slice(0, 3).map((t) => ({ label: t, type: "tag" })),
    ...metadata.entities.slice(0, 2).map((t) => ({ label: t, type: "entity" })),
  ];

  if (chips.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-border px-4 py-1.5">
      {chips.map((chip) => (
        <span
          key={`${chip.type}-${chip.label}`}
          className="rounded-md bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
        >
          {chip.label}
        </span>
      ))}
    </div>
  );
}
