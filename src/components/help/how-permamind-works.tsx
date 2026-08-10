"use client";

import React from "react";
import { HelpCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useLocale } from "@/hooks/use-locale";

export function HowPermaMindWorksContent() {
  const ar = useLocale().locale === "ar";
  return (
    <div className="space-y-6 overflow-y-auto px-4 pb-6 text-sm leading-6 text-muted-foreground">
      <section><h3 className="font-semibold text-foreground">{ar ? "محادثاتك محفوظة" : "Your conversations, remembered"}</h3><p className="mt-1">{ar ? "يتذكر الذكاء الاصطناعي التقليدي المحادثة الحالية فقط. يستطيع PermaMind البحث في محادثاتك السابقة ومتابعة عملك مع مرور الوقت." : "Traditional AI remembers only the current conversation. PermaMind can search your previous conversations and continue your work across time."}</p></section>
      <section><h3 className="font-semibold text-foreground">{ar ? "الخصوصية افتراضية" : "Private by default"}</h3><p className="mt-1">{ar ? "تبقى محادثاتك على جهازك. ويتم استرجاع المعلومات اللازمة لردود الذكاء الاصطناعي فقط." : "Your conversations stay on your device. Only the information needed for AI responses is retrieved automatically."}</p></section>
      <section><h3 className="font-semibold text-foreground">{ar ? "النسخ الاحتياطي الدائم اختياري" : "Permanent backups are optional"}</h3><p className="mt-1">{ar ? "عند تفعيله، تُشفّر المحادثات محليًا قبل الرفع. وبعد تخزينها على Arweave يصبح النسخ دائمًا ولا يمكن حذفه أو التراجع عنه. لا يستطيع فك التشفير إلا عبارة المرور الخاصة بك." : "If enabled, conversations are encrypted locally before upload. Once stored on Arweave, the backup is permanent and cannot be deleted or undone. Only your encryption passphrase can decrypt it."}</p></section>
      <section><h3 className="font-semibold text-foreground">{ar ? "ذاكرة تحت تحكمك" : "Memory you control"}</h3><p className="mt-1">{ar ? "ذاكرتك مشفرة وقابلة للنقل وتحت تحكمك. يمكنك:" : "Your memory is encrypted, portable, and user-controlled. You can:"}</p><ul className="mt-2 list-disc space-y-1 pl-5"><li>{ar ? "تصدير ذاكرتك واستعادتها" : "Export and restore your memory"}</li><li>{ar ? "استخدام مزود ذكاء اصطناعي مختلف" : "Use a different AI provider"}</li><li>{ar ? "استخدام مفتاح API الخاص بك" : "Use your own AI API key"}</li><li>{ar ? "تعطيل النسخ الاحتياطي الدائم مستقبلاً" : "Disable future permanent backups at any time"}</li></ul><p className="mt-2">{ar ? "لا تصل عبارة مرور التشفير إلى الخادم أو مزود الذكاء الاصطناعي. تعطيل النسخ الاحتياطي لا يحذف الملفات المرفوعة مسبقًا على Arweave." : "Your encryption passphrase never reaches the server or AI provider. Disabling backups does not delete uploads already stored on Arweave."}</p></section>
    </div>
  );
}

export function HelpSheet({ triggerClassName }: { triggerClassName?: string }) {
  const ar = useLocale().locale === "ar";
  return <Sheet><SheetTrigger render={<Button variant="ghost" size="sm" className={triggerClassName}><HelpCircle className="size-4" />{ar ? "المساعدة" : "Help"}</Button>} /><SheetContent className="w-full sm:max-w-md"><SheetHeader><SheetTitle>{ar ? "كيف يعمل PermaMind" : "How PermaMind Works"}</SheetTitle></SheetHeader><HowPermaMindWorksContent /></SheetContent></Sheet>;
}
