"use client";

import React from "react";
import { HelpCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

export function HowPermaMindWorksContent() {
  return (
    <div className="space-y-6 overflow-y-auto px-4 pb-6 text-sm leading-6 text-muted-foreground">
      <section><h3 className="font-semibold text-foreground">Your conversations, remembered</h3><p className="mt-1">Traditional AI remembers only the current conversation. PermaMind can search your previous conversations and continue your work across time.</p></section>
      <section><h3 className="font-semibold text-foreground">Private by default</h3><p className="mt-1">Your conversations stay on your device. Only the information needed for AI responses is retrieved automatically.</p></section>
      <section><h3 className="font-semibold text-foreground">Permanent backups are optional</h3><p className="mt-1">If enabled, conversations are encrypted locally, stored permanently on Arweave, and only your encryption passphrase can decrypt them.</p></section>
      <section><h3 className="font-semibold text-foreground">You own your data</h3><p className="mt-1">You can:</p><ul className="mt-2 list-disc space-y-1 pl-5"><li>Export your memory</li><li>Import backups</li><li>Use your own AI API key</li><li>Disable permanent backups at any time</li></ul></section>
    </div>
  );
}

export function HelpSheet({ triggerClassName }: { triggerClassName?: string }) {
  return <Sheet><SheetTrigger render={<Button variant="ghost" size="sm" className={triggerClassName}><HelpCircle className="size-4" />Help</Button>} /><SheetContent className="w-full sm:max-w-md"><SheetHeader><SheetTitle>How PermaMind Works</SheetTitle></SheetHeader><HowPermaMindWorksContent /></SheetContent></Sheet>;
}
