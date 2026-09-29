"use client";

import { Bot, Check, Copy, Loader2, RotateCcw } from "lucide-react";
import { useState } from "react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useLocale } from "@/hooks/use-locale";
import { formatMessageTime } from "@/lib/format/date";
import { cn } from "@/lib/utils";
import type { Message } from "@/types/chat";

interface ChatMessageProps {
  message: Message;
  isLoading?: boolean;
  onResend?: (message: Message) => void;
}

async function copyMessageText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the legacy copy path for browsers without permission
    // for the asynchronous Clipboard API.
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch {
    copied = false;
  } finally {
    textarea.remove();
  }
  return copied;
}

export function ChatMessage({ message, isLoading = false, onResend }: ChatMessageProps) {
  const { locale } = useLocale();
  const ar = locale === "ar";
  const isUser = message.role === "user";
  const isThinking = message.isStreaming && !message.content;
  const [copied, setCopied] = useState(false);
  const canAct = !message.isStreaming && Boolean(message.content.trim());

  const handleCopy = async () => {
    if (!canAct) return;
    const didCopy = await copyMessageText(message.content);
    if (!didCopy) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

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
            {isUser ? (ar ? "أنت" : "You") : "PermaMind"}
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
              <span>{ar ? "جارٍ التفكير..." : "Thinking..."}</span>
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
              <p className="text-xs font-medium opacity-80">{message.sources.length ? (ar ? "المصادر" : "Sources") : (ar ? "لا نتائج من الويب" : "No web results")}</p>
              {message.sources.map((source) => (
                <a key={source.url} href={source.url} target="_blank" rel="noreferrer" className="block truncate text-xs underline-offset-2 hover:underline">{source.title || source.url}</a>
              ))}
            </div>
          )}
        </div>
        {canAct && (
          <div className={cn("flex items-center gap-1 px-1", isUser ? "justify-end" : "justify-start")}>
            <button
              type="button"
              onClick={() => void handleCopy()}
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={copied ? (ar ? "تم نسخ الرسالة" : "Message copied") : (ar ? "نسخ الرسالة" : "Copy message")}
            >
              {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
              <span>{copied ? (ar ? "تم النسخ" : "Copied") : (ar ? "نسخ" : "Copy")}</span>
            </button>
            {isUser && onResend && (
              <button
                type="button"
                onClick={() => onResend(message)}
                disabled={isLoading}
                className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                aria-label={ar ? "إعادة إرسال الرسالة" : "Resend message"}
              >
                <RotateCcw className="size-3" />
                <span>{ar ? "إعادة إرسال" : "Resend"}</span>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
