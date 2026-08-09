"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { useLocale } from "@/hooks/use-locale";

type Mode = "sign-in" | "sign-up" | "forgot" | "reset";

export function AuthForm({ mode }: { mode: Mode }) {
  const { locale, toggleLocale, isRTL } = useLocale();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault(); setLoading(true); setError(""); setMessage("");
    const supabase = getSupabaseBrowserClient();
    let result;
    if (mode === "sign-in") result = await supabase.auth.signInWithPassword({ email, password });
    else if (mode === "sign-up") result = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: `${window.location.origin}/auth/callback` } });
    else if (mode === "forgot") result = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/auth/callback?next=/auth/reset-password` });
    else result = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (result.error) return setError(result.error.message);
if (mode === "sign-in" || mode === "reset") window.location.assign("/chat");
    else setMessage(mode === "sign-up" ? "Check your email to confirm your account." : "Check your email for a password reset link.");
  }

  const ar = locale === "ar";
  const title = ar ? (mode === "sign-in" ? "مرحباً بعودتك" : mode === "sign-up" ? "أنشئ حسابك" : mode === "forgot" ? "إعادة تعيين كلمة المرور" : "اختر كلمة مرور جديدة") : (mode === "sign-in" ? "Welcome back" : mode === "sign-up" ? "Create your account" : mode === "forgot" ? "Reset your password" : "Choose a new password");
  return <main dir={isRTL ? "rtl" : "ltr"} className="flex min-h-dvh items-center justify-center bg-background p-6"><div className="w-full max-w-md rounded-2xl border bg-card p-8 shadow-sm">
    <button type="button" onClick={toggleLocale} className="mb-4 text-sm text-muted-foreground underline">{ar ? "English" : "العربية"}</button>
    <div className="mb-8 text-center"><div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-xl bg-primary text-xl font-bold text-primary-foreground">P</div><h1 className="text-2xl font-semibold">{title}</h1><p className="mt-2 text-sm text-muted-foreground">PermaMind remembers what matters.</p></div>
    <form onSubmit={submit} className="space-y-4">
      {mode !== "reset" && <label className="block text-sm font-medium">{ar ? "البريد الإلكتروني" : "Email"}<input required type="email" value={email} onChange={e => setEmail(e.target.value)} className="mt-1 w-full rounded-lg border bg-background px-3 py-2.5 outline-none focus:ring-2 focus:ring-ring" /></label>}
      {mode !== "forgot" && <label className="block text-sm font-medium">{mode === "reset" ? (ar ? "كلمة المرور الجديدة" : "New password") : (ar ? "كلمة المرور" : "Password")}<input required minLength={6} type="password" value={password} onChange={e => setPassword(e.target.value)} className="mt-1 w-full rounded-lg border bg-background px-3 py-2.5 outline-none focus:ring-2 focus:ring-ring" /></label>}
      {error && <p className="text-sm text-destructive">{error}</p>}{message && <p className="text-sm text-green-600">{message}</p>}
      <button disabled={loading} className="w-full rounded-lg bg-primary px-4 py-2.5 font-medium text-primary-foreground disabled:opacity-60">{loading ? (ar ? "يرجى الانتظار..." : "Please wait...") : mode === "sign-in" ? (ar ? "تسجيل الدخول" : "Sign in") : mode === "sign-up" ? (ar ? "إنشاء حساب" : "Create account") : mode === "forgot" ? (ar ? "إرسال رابط الاستعادة" : "Send reset link") : (ar ? "تحديث كلمة المرور" : "Update password")}</button>
    </form>
    <div className="mt-6 space-y-2 text-center text-sm text-muted-foreground">{mode === "sign-in" && <><Link className="block text-foreground underline" href="/auth/forgot-password">Forgot password?</Link><span>Don&apos;t have an account? <Link className="text-foreground underline" href="/auth/sign-up">Sign up</Link></span></>}{mode === "sign-up" && <span>Already have an account? <Link className="text-foreground underline" href="/auth/sign-in">Sign in</Link></span>}{mode === "forgot" && <Link className="text-foreground underline" href="/auth/sign-in">Back to sign in</Link>}</div>
  </div></main>;
}