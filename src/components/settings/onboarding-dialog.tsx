"use client";

import { KeyRound, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

interface OnboardingDialogProps {
  open: boolean;
  onGetStarted: () => void;
  onOpenSettings: () => void;
}

export function OnboardingDialog({
  open,
  onGetStarted,
  onOpenSettings,
}: OnboardingDialogProps) {
  return (
    <Sheet open={open} onOpenChange={() => {}}>
      <SheetContent
        side="bottom"
        className="mx-auto max-h-[85vh] max-w-lg rounded-t-2xl"
        showCloseButton={false}
      >
        <SheetHeader className="text-center">
          <SheetTitle className="text-xl">Welcome to PermaMind</SheetTitle>
        </SheetHeader>
        <div className="space-y-4 py-4 text-center">
          <p className="text-sm text-muted-foreground">
            AI chat with persistent memory — start free, upgrade when you want.
          </p>
          <div className="grid gap-3 text-left">
            <div className="flex gap-3 rounded-lg border border-border p-3">
              <Sparkles className="mt-0.5 size-5 shrink-0 text-primary" />
              <div>
                <p className="text-sm font-medium">Start free</p>
                <p className="text-xs text-muted-foreground">
                  Use free OpenRouter models instantly — no signup required in
                  the app.
                </p>
              </div>
            </div>
            <div className="flex gap-3 rounded-lg border border-border p-3">
              <KeyRound className="mt-0.5 size-5 shrink-0 text-primary" />
              <div>
                <p className="text-sm font-medium">Bring your own key (optional)</p>
                <p className="text-xs text-muted-foreground">
                  Add your OpenRouter API key for premium models, higher limits,
                  and faster responses. Key stays in your browser only.
                </p>
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-2 pt-2">
            <Button onClick={onGetStarted}>Start chatting — free mode</Button>
            <Button variant="outline" onClick={onOpenSettings}>
              Set up my API key
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
