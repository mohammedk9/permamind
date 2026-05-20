"use client";

import { Bot, User } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import type { Message } from "@/types/chat";

interface ChatMessageProps {
  message: Message;
}

export function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === "user";

  return (
    <div
      className={cn(
        "flex gap-3 px-4 py-5",
        isUser ? "bg-transparent" : "bg-muted/30"
      )}
    >
      <Avatar className="size-8 shrink-0">
        <AvatarFallback
          className={cn(
            isUser
              ? "bg-primary text-primary-foreground"
              : "bg-secondary text-secondary-foreground"
          )}
        >
          {isUser ? <User className="size-4" /> : <Bot className="size-4" />}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-xs font-medium text-muted-foreground">
          {isUser ? "You" : "PermaMind"}
        </p>
        <p className="text-sm leading-relaxed whitespace-pre-wrap">
          {message.content}
        </p>
      </div>
    </div>
  );
}
