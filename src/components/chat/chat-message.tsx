"use client";

import { Bot, Loader2 } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { formatMessageTime } from "@/lib/format/date";
import { cn } from "@/lib/utils";
import type { Message } from "@/types/chat";

interface ChatMessageProps {
  message: Message;
}

export function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === "user";
  const isThinking = message.isStreaming && !message.content;

  return (
    <div
      className={cn(
        "flex gap-3 px-3 py-2 sm:px-4",
        isUser ? "justify-end" : "justify-start"
      )}
    >
      {!isUser && (
        <Avatar className="mt-1 size-7 shrink-0">
          <AvatarFallback className="bg-secondary text-secondary-foreground">
            <Bot className="size-3.5" />
          </AvatarFallback>
        </Avatar>
      )}
      <div className={cn("min-w-0 space-y-1", isUser ? "max-w-[min(100%,36rem)]" : "max-w-[min(100%,42rem)] flex-1")}>
        <div className={cn("flex items-center gap-2 px-1", isUser && "justify-end")}>
          <p className="text-[11px] font-medium text-muted-foreground">
            {isUser ? "You" : "PermaMind"}
          </p>
          {!isThinking && (
            <span className="text-[11px] text-muted-foreground/70">
              {formatMessageTime(message.createdAt)}
            </span>
          )}
        </div>
        <div
          className={cn(
            "rounded-2xl px-3.5 py-2.5 text-sm leading-7 sm:text-[15px]",
            isUser
              ? "rounded-ee-md bg-primary text-primary-foreground"
              : "rounded-es-md border border-border/70 bg-card text-card-foreground"
          )}
        >
          {isThinking ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              <span>Thinking...</span>
            </div>
          ) : (
            <p className="whitespace-pre-wrap">
              {message.content}
              {message.isStreaming && (
                <span className="ms-0.5 inline-block h-4 w-0.5 animate-pulse bg-current align-middle" />
              )}
            </p>
          )}
          {message.sources && (
            <div className="mt-3 space-y-1 border-t border-current/10 pt-2">
              <p className="text-xs font-medium opacity-80">{message.sources.length ? "Sources" : "No web results"}</p>
              {message.sources.map((source) => (
                <a key={source.url} href={source.url} target="_blank" rel="noreferrer" className="block truncate text-xs underline-offset-2 hover:underline">{source.title || source.url}</a>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
