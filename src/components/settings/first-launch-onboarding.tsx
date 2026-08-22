"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { completeFirstRun } from "@/lib/settings/first-run";
import { useLocale } from "@/hooks/use-locale";

export function FirstLaunchOnboarding({ open, onComplete }: { open: boolean; onComplete: () => void }) {
  const [step, setStep] = useState(0);
  const ar = useLocale().locale === "ar";
  if (!open) return null;
  const finish = () => { completeFirstRun(); onComplete(); };
  const screens = [
    { title: ar ? "مرحباً بك في PermaMind" : "Welcome to PermaMind", body: ar ? "تحدث بشكل طبيعي.\nيحافظ PermaMind على تنظيم محادثاتك ويساعدك على مواصلة العمل من حيث توقفت." : "Chat naturally.\nPermaMind keeps your conversations organized and helps you continue where you left off." },
    { title: ar ? "ذكاؤك الاصطناعي يتذكر" : "Your AI remembers", body: ar ? "على عكس محادثات الذكاء الاصطناعي التقليدية،\nيمكن لـ PermaMind البحث في المحادثات السابقة،\nمواصلة المشاريع القديمة،\nواستعادة السياق السابق." : "Unlike traditional AI chats,\nPermaMind can search previous conversations,\ncontinue old projects,\nand reconnect past context." },
    { title: ar ? "ذاكرة مشفرة وقابلة للنقل" : "Encrypted, portable memory", body: ar ? "تبقى محادثاتك محلية بشكل افتراضي ويمكن تصديرها أو استعادتها.\n\nالنسخ الاحتياطية الاختيارية تُشفَّر محلياً قبل الرفع. بعد رفع النسخة الاحتياطية إلى Arweave تصبح دائمة ولا يمكن حذفها أو التراجع عنها." : "Your conversations stay local by default and can be exported or restored.\n\nOptional backups are encrypted locally before upload. After a backup is uploaded to Arweave, it is permanent and cannot be deleted or undone." },
    { title: ar ? "اربط ذكاءك الاصطناعي" : "Connect your AI", body: ar ? "اربط مفتاح مزود الذكاء الاصطناعي من الإعدادات عندما تكون جاهزاً." : "Connect an AI provider API key in Settings when you are ready." },
  ] as const;
  return <div className="fixed inset-0 z-[60] flex items-center justify-center bg-background/95 p-4" role="dialog" aria-modal="true" aria-labelledby="first-launch-title">
    <div className="w-full max-w-lg rounded-2xl border bg-card p-6 shadow-2xl sm:p-8">
      <div className="mb-8 flex justify-center gap-2" aria-label={ar ? `الخطوة ${step + 1} من 4` : `Step ${step + 1} of 4`}>{screens.map((_, index) => <span key={index} className={`h-1.5 w-10 rounded-full ${index === step ? "bg-primary" : "bg-muted"}`} />)}</div>
      <h1 id="first-launch-title" className="text-center text-2xl font-semibold">{screens[step].title}</h1>
      <p className="mt-5 min-h-32 whitespace-pre-line text-center text-base leading-7 text-muted-foreground">{screens[step].body}</p>
      <div className="mt-8 flex items-center justify-between gap-2"><Button variant="ghost" onClick={() => step === 0 ? undefined : setStep(step - 1)} disabled={step === 0}>{ar ? "رجوع" : "Back"}</Button><div className="flex gap-2"><Button variant="ghost" onClick={finish}>{ar ? "تخطي" : "Skip"}</Button>{step < 3 ? <Button onClick={() => setStep(step + 1)}>{ar ? "التالي" : "Next"}</Button> : <Button onClick={finish}>{ar ? "ابدأ الاستخدام" : "Get Started"}</Button>}</div></div>
    </div>
  </div>;
}
