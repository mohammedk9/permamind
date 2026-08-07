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
      className="flex items-start gap-3 border-b border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
    >
      <AlertCircle className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 flex-1"><p className="font-medium">We couldn’t complete that request</p><p className="mt-0.5 opacity-90">{message}</p></div>
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
