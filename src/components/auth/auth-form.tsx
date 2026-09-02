"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { useLocale } from "@/hooks/use-locale";
import { LogoMark } from "@/components/ui/logo";

type Mode = "sign-in" | "sign-up" | "forgot" | "reset";

export function AuthForm({ mode }: { mode: Mode }) {
  const { locale, toggleLocale, isRTL } = useLocale();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault(); setLoading(true); setError(""); setMessage("");
    if (mode === "sign-up" && password !== confirmPassword) {
      setLoading(false);
      setError(locale === "ar" ? "كلمتا المرور غير متطابقتين." : "Passwords do not match.");
      return;
    }
    const supabase = getSupabaseBrowserClient();
    let result;
    if (mode === "sign-in") result = await supabase.auth.signInWithPassword({ email, password });
    else if (mode === "sign-up") result = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: `${window.location.origin}/auth/callback` } });
    else if (mode === "forgot") result = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/auth/callback?next=/auth/reset-password` });
    else result = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (result.error) return setError(result.error.message);
if (mode === "sign-in" || mode === "reset") window.location.assign("/chat");
    else setMessage(mode === "sign-up" ? (locale === "ar" ? "تحقق من بريدك الإلكتروني لتأكيد حسابك." : "Check your email to confirm your account.") : (locale === "ar" ? "تحقق من بريدك الإلكتروني للحصول على رابط إعادة تعيين كلمة المرور." : "Check your email for a password reset link."));
  }

  const ar = locale === "ar";
  const title = ar ? (mode === "sign-in" ? "مرحباً بعودتك" : mode === "sign-up" ? "أنشئ حسابك" : mode === "forgot" ? "إعادة تعيين كلمة المرور" : "اختر كلمة مرور جديدة") : (mode === "sign-in" ? "Welcome back" : mode === "sign-up" ? "Create your account" : mode === "forgot" ? "Reset your password" : "Choose a new password");
  const inputClass = "mt-1 w-full rounded-lg border bg-background pl-10 pr-3 py-2.5 outline-none focus:ring-2 focus:ring-ring";
  const eyeButtonClass = "absolute left-2 top-1/2 mt-0.5 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground";
  return <main dir={isRTL ? "rtl" : "ltr"} className="flex min-h-dvh items-center justify-center bg-background p-6"><div className="w-full max-w-md rounded-2xl border bg-card p-8 shadow-sm">
    <button type="button" onClick={toggleLocale} className="mb-4 text-sm text-muted-foreground underline">{ar ? "English" : "العربية"}</button>
    <div className="mb-8 text-center"><div className="mx-auto mb-4"><LogoMark size="lg" /></div><h1 className="text-2xl font-semibold">{title}</h1><p className="mt-2 text-sm text-muted-foreground">{ar ? "PermaMind يتذكر ما يهمك." : "PermaMind remembers what matters."}</p></div>
    <form onSubmit={submit} className="space-y-4">
      {mode !== "reset" && <label className="block text-sm font-medium">{ar ? "البريد الإلكتروني" : "Email"}<input required type="email" value={email} onChange={e => setEmail(e.target.value)} className="mt-1 w-full rounded-lg border bg-background px-3 py-2.5 outline-none focus:ring-2 focus:ring-ring" /></label>}
      {mode !== "forgot" && <>
        <label className="block text-sm font-medium">{mode === "reset" ? (ar ? "كلمة المرور الجديدة" : "New password") : (ar ? "كلمة المرور" : "Password")}
          <span className="relative mt-1 block">
            <input required minLength={6} type={showPassword ? "text" : "password"} value={password} onChange={e => setPassword(e.target.value)} className={inputClass} />
            <button type="button" onClick={() => setShowPassword(v => !v)} className={eyeButtonClass} aria-label={showPassword ? (ar ? "إخفاء كلمة المرور" : "Hide password") : (ar ? "إظهار كلمة المرور" : "Show password")}>{showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</button>
          </span>
        </label>
        {mode === "sign-up" && <label className="block text-sm font-medium">{ar ? "تأكيد كلمة المرور" : "Confirm password"}
          <span className="relative mt-1 block">
            <input required minLength={6} type={showConfirmPassword ? "text" : "password"} value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} className={`${inputClass}${confirmPassword && confirmPassword !== password ? " border-destructive focus:ring-destructive" : ""}`} />
            <button type="button" onClick={() => setShowConfirmPassword(v => !v)} className={eyeButtonClass} aria-label={showConfirmPassword ? (ar ? "إخفاء تأكيد كلمة المرور" : "Hide confirm password") : (ar ? "إظهار تأكيد كلمة المرور" : "Show confirm password")}>{showConfirmPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</button>
          </span>
          {confirmPassword && confirmPassword !== password && <span className="mt-1 block text-sm text-destructive">{ar ? "كلمتا المرور غير متطابقتين." : "Passwords do not match."}</span>}
        </label>}
      </>}
      {error && <p className="text-sm text-destructive">{error}</p>}{message && <p className="text-sm text-green-600">{message}</p>}
      <button disabled={loading} className="w-full rounded-lg bg-primary px-4 py-2.5 font-medium text-primary-foreground disabled:opacity-60">{loading ? (ar ? "يرجى الانتظار..." : "Please wait...") : mode === "sign-in" ? (ar ? "تسجيل الدخول" : "Sign in") : mode === "sign-up" ? (ar ? "إنشاء حساب" : "Create account") : mode === "forgot" ? (ar ? "إرسال رابط الاستعادة" : "Send reset link") : (ar ? "تحديث كلمة المرور" : "Update password")}</button>
    </form>
    <div className="mt-6 space-y-2 text-center text-sm text-muted-foreground">{mode === "sign-in" && <><Link className="block text-foreground underline" href="/auth/forgot-password">{ar ? "نسيت كلمة المرور؟" : "Forgot password?"}</Link><span>{ar ? "ليس لديك حساب؟ " : "Don't have an account? "}<Link className="text-foreground underline" href="/auth/sign-up">{ar ? "إنشاء حساب" : "Sign up"}</Link></span></>}{mode === "sign-up" && <span>{ar ? "لديك حساب بالفعل؟ " : "Already have an account? "}<Link className="text-foreground underline" href="/auth/sign-in">{ar ? "تسجيل الدخول" : "Sign in"}</Link></span>}{mode === "forgot" && <Link className="text-foreground underline" href="/auth/sign-in">{ar ? "العودة لتسجيل الدخول" : "Back to sign in"}</Link>}</div>
  </div></main>;
}