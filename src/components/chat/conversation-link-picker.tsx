"use client";

import { Link2, Search, Unlink, X } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useLocale } from "@/hooks/use-locale";
import { formatConversationTime } from "@/lib/format/date";
import type { Conversation } from "@/types/chat";

interface ConversationLinkPickerProps {
  conversation: Conversation | null;
  conversations: Conversation[];
  disabled?: boolean;
  onChange: (ids: string[]) => void;
}

function useLinkedConversations(conversation: Conversation | null, conversations: Conversation[]) {
  const selected = useMemo(() => new Set(conversation?.linkedConversationIds ?? []), [conversation?.linkedConversationIds]);
  const available = conversations.filter((item) => item.id !== conversation?.id);
  const linked = available.filter((item) => selected.has(item.id));
  return { selected, available, linked };
}

export function LinkedConversationBadges({ conversation, conversations, onChange }: Omit<ConversationLinkPickerProps, "disabled">) {
  const { locale } = useLocale();
  const ar = locale === "ar";
  const { selected, linked } = useLinkedConversations(conversation, conversations);
  if (!linked.length) return null;
  const toggle = (id: string) => onChange([...selected].filter((item) => item !== id));
  return (
    <div className="mb-2 flex flex-wrap gap-1.5 px-1">
      {linked.map((item) => (
        <span key={item.id} className="flex max-w-full items-center gap-1 rounded-full bg-primary/10 px-2 py-1 text-xs text-primary">
          <Link2 className="size-3 shrink-0" aria-hidden="true" />
          <span className="truncate">{item.title}</span>
          <button type="button" onClick={() => toggle(item.id)} aria-label={ar ? `إزالة ربط ${item.title}` : `Unlink ${item.title}`}>
            <X className="size-3" />
          </button>
        </span>
      ))}
    </div>
  );
}

export function ConversationLinkPicker({ conversation, conversations, disabled, onChange }: ConversationLinkPickerProps) {
  const { locale } = useLocale();
  const ar = locale === "ar";
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const { selected, available, linked } = useLinkedConversations(conversation, conversations);
  const visible = available.filter((item) => {
    const text = `${item.title} ${item.metadata?.summary ?? ""}`.toLocaleLowerCase();
    return text.includes(query.trim().toLocaleLowerCase());
  });

  const toggle = (id: string) => {
    const next = selected.has(id)
      ? [...selected].filter((item) => item !== id)
      : [...selected, id];
    onChange(next);
  };

  return (
    <>
      <Button type="button" variant={linked.length ? "secondary" : "ghost"} size="icon" className="mb-0.5 rounded-xl" onClick={() => setOpen(true)} disabled={disabled || available.length === 0} aria-label={ar ? "ربط بمحادثة سابقة" : "Link a previous conversation"} title={ar ? "ربط بمحادثة سابقة" : "Link a previous conversation"}>
        {linked.length ? <Unlink className="size-4" /> : <Link2 className="size-4" />}
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="flex flex-col sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{ar ? "ربط بمحادثة سابقة" : "Link a previous conversation"}</SheetTitle>
            <SheetDescription>{ar ? "اختياري. المحادثة المرتبطة تصبح أساساً لهذه المحادثة، وتبقى الذاكرة العامة تبحث في كل المحادثات." : "Optional. A linked conversation becomes the foundation of this chat, while general memory still searches every chat."}</SheetDescription>
          </SheetHeader>
          <div className="relative px-4">
            <Search className="pointer-events-none absolute start-7 top-2.5 size-4 text-muted-foreground" />
            <Input value={query} onChange={(event) => setQuery(event.target.value)} className="ps-9" placeholder={ar ? "ابحث في المحادثات" : "Search conversations"} aria-label={ar ? "ابحث في المحادثات" : "Search conversations"} />
          </div>
          <div className="min-h-0 flex-1 space-y-1 overflow-y-auto px-4 pb-4">
            {visible.length === 0 ? <p className="px-2 py-6 text-center text-sm text-muted-foreground">{ar ? "لا توجد محادثات مطابقة." : "No matching conversations."}</p> : visible.map((item) => {
              const active = selected.has(item.id);
              return (
                <button key={item.id} type="button" aria-pressed={active} className={`flex w-full items-start gap-3 rounded-lg px-3 py-2 text-start hover:bg-muted ${active ? "bg-primary/10" : ""}`} onClick={() => toggle(item.id)}>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{item.title}</span>
                    <span className="block truncate text-xs text-muted-foreground">{formatConversationTime(item.updatedAt, ar ? "ar" : "en")}</span>
                  </span>
                  <span className="shrink-0 text-xs text-primary">{active ? (ar ? "مرتبطة" : "Linked") : (ar ? "ربط" : "Link")}</span>
                </button>
              );
            })}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
