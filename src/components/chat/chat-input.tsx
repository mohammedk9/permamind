"use client";

import { ArrowUp, Loader2 } from "lucide-react";
import { useCallback, useRef } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface ChatInputProps {
  onSend: (content: string) => void;
  disabled?: boolean;
  isLoading?: boolean;
}

export function ChatInput({ onSend, disabled, isLoading }: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = useCallback(() => {
    const value = textareaRef.current?.value.trim();
    if (!value || disabled || isLoading) return;
    onSend(value);
    if (textareaRef.current) {
      textareaRef.current.value = "";
      textareaRef.current.style.height = "auto";
    }
  }, [onSend, disabled, isLoading]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="sticky bottom-0 z-10 border-t border-border bg-background/95 p-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur sm:p-4">
      <div className="surface-elevated mx-auto flex max-w-3xl items-end gap-2 rounded-2xl border border-input bg-card p-1.5 sm:p-2">
        <Textarea
          ref={textareaRef}
          placeholder={
            isLoading ? "Waiting for response..." : "Message PermaMind..."
          }
          className="min-h-[44px] max-h-40 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
          rows={1}
          aria-label="Message PermaMind"
          aria-describedby="composer-help"
          disabled={disabled || isLoading}
          onKeyDown={handleKeyDown}
          onInput={(e) => {
            const target = e.target as HTMLTextAreaElement;
            target.style.height = "auto";
            target.style.height = `${Math.min(target.scrollHeight, 160)}px`;
          }}
        />
        <span id="composer-help" className="sr-only">Press Enter to send. Press Shift+Enter for a new line.</span>
        <Button
          size="icon"
          className="shrink-0 rounded-xl"
          onClick={handleSubmit}
          disabled={disabled || isLoading}
          aria-label={isLoading ? "Generating response" : "Send message"}
        >
          {isLoading ? (
            <Loader2 aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />
          ) : (
            <ArrowUp aria-hidden="true" className="size-4" />
          )}
        </Button>
      </div>
    </div>
  );
}
