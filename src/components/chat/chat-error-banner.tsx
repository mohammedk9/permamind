"use client";

import { AlertCircle, X } from "lucide-react";

import { Button } from "@/components/ui/button";

interface ChatErrorBannerProps {
  message: string;
  onDismiss: () => void;
}

export function ChatErrorBanner({ message, onDismiss }: ChatErrorBannerProps) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2 border-b border-destructive/30 bg-destructive/10 px-4 py-2.5 text-sm text-destructive"
    >
      <AlertCircle className="mt-0.5 size-4 shrink-0" />
      <p className="min-w-0 flex-1">{message}</p>
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={onDismiss}
        aria-label="Dismiss error"
        className="shrink-0 text-destructive hover:bg-destructive/20"
      >
        <X className="size-3.5" />
      </Button>
    </div>
  );
}
