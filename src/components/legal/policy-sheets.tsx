"use client";

import { FileText, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

function PolicySheet({ title, children, icon: Icon, triggerClassName }: { title: string; children: React.ReactNode; icon: typeof ShieldCheck; triggerClassName?: string }) {
  return (
    <Sheet>
      <SheetTrigger render={<Button variant="ghost" size="sm" className={cn("w-full justify-start gap-2 text-xs", triggerClassName)} />}>
        <Icon className="size-4" />
        {title}
      </SheetTrigger>
      <SheetContent className="w-full sm:max-w-md">
        <SheetHeader><SheetTitle>{title}</SheetTitle></SheetHeader>
        <div className="space-y-5 overflow-y-auto px-4 pb-6 text-sm leading-6 text-muted-foreground">
          {children}
        </div>
      </SheetContent>
    </Sheet>
  );
}

export function PrivacyPolicySheet({ triggerClassName }: { triggerClassName?: string }) {
  return (
    <PolicySheet title="Privacy policy" icon={ShieldCheck} triggerClassName={triggerClassName}>
      <p><strong className="text-foreground">Current status:</strong> PermaMind currently works without user accounts and does not require collecting personal information.</p>
      <section><h3 className="font-semibold text-foreground">No selling or marketing</h3><p className="mt-1">We do not sell, rent, or use your conversations or personal information to market products to you.</p></section>
      <section><h3 className="font-semibold text-foreground">Encrypted, portable, user-controlled memory</h3><p className="mt-1">Conversations and settings are stored locally in your browser by default. You can export and restore your memory, and use a different AI provider. Your encryption passphrase stays in your browser and is not sent to the server or AI provider.</p></section>
      <section><h3 className="font-semibold text-foreground">Permanent storage</h3><p className="mt-1">If you explicitly enable a backup, data is encrypted locally before upload. Arweave uploads are permanent and cannot be deleted after confirmation.</p></section>
      <p className="text-xs">If accounts or analytics are added later, this policy will be updated before those changes take effect.</p>
    </PolicySheet>
  );
}

export function TermsOfUseSheet({ triggerClassName }: { triggerClassName?: string }) {
  return (
    <PolicySheet title="Terms of use" icon={FileText} triggerClassName={triggerClassName}>
      <section><h3 className="font-semibold text-foreground">Acceptable use</h3><p className="mt-1">Use PermaMind lawfully and responsibly. Do not use it to harm others, violate rights, distribute illegal content, or attempt to disrupt the service.</p></section>
      <section><h3 className="font-semibold text-foreground">AI responses</h3><p className="mt-1">AI responses can be inaccurate. Review important information and do not rely on PermaMind as a substitute for professional legal, medical, financial, or religious advice.</p></section>
      <section><h3 className="font-semibold text-foreground">Your content</h3><p className="mt-1">You are responsible for the content you enter and for keeping your API keys and encryption passphrases secure.</p></section>
      <section><h3 className="font-semibold text-foreground">Arweave warning</h3><p className="mt-1">Permanent storage is optional. Once uploaded to Arweave, content cannot be deleted or undone. Confirm that you understand this before enabling a permanent backup.</p></section>
    </PolicySheet>
  );
}

export function ChatPolicies({ triggerClassName }: { triggerClassName?: string }) {
  return <div className="space-y-1"><PrivacyPolicySheet triggerClassName={triggerClassName} /><TermsOfUseSheet triggerClassName={triggerClassName} /></div>;
}