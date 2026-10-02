"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Eye, EyeOff } from "lucide-react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { useLocale } from "@/hooks/use-locale";
import { LogoMark } from "@/components/ui/logo";

type Mode = "sign-in" | "sign-up" | "forgot" | "reset";

export function AuthForm({ mode }: { mode: Mode }) {
  const { locale, toggleLocale, isRTL } = useLocale();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // A valid session must not cost the user another email and password. The
  // access token is short lived, so this reads the stored session (which the
  // client can refresh) rather than the network-backed getUser().
  useEffect(() => {
    if (mode === "forgot" || mode === "reset") return;
    let active = true;
    getSupabaseBrowserClient()
      .auth.getSession()
      .then(({ data }) => {
        if (active && data.session?.user) router.replace("/chat");
      })
      .catch(() => {
        // No stored session: stay on the form.
      });
    return () => {
      active = false;
    };
  }, [mode, router]);

  async function submit(event: FormEvent) {
    event.preventDefault(); setLoading(true); setError(""); setMessage("");
    // The form carries `noValidate` so the confirm-password hint can own the
    // messaging, which means the browser's own validation no longer runs.
    // These checks are therefore the only guard left before a network call.
    if (!email || (mode !== "forgot" && !password)) {
      setLoading(false);
      setError(locale === "ar" ? "يرجى ملء جميع الحقول المطلوبة." : "Please fill in all required fields.");
      return;
    }
    if (mode === "sign-up" && password.length < 6) {
      setLoading(false);
      setError(locale === "ar" ? "كلمة المرور يجب أن تكون 6 أحرف على الأقل." : "Password must be at least 6 characters.");
      return;
    }
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
  /* Logical `ps`/`pe` rather than `pl`/`pr`: the eye button sits at the inline
     start, which is the right edge in Arabic. `text-base` matters on iOS —
     anything under 16px makes the whole page zoom when the field is focused. */
  const inputClass = "mt-1 w-full rounded-lg border bg-background ps-10 pe-3 py-2.5 text-base outline-none focus:ring-2 focus:ring-ring";
  const plainInputClass = "mt-1 w-full rounded-lg border bg-background px-3 py-2.5 text-base outline-none focus:ring-2 focus:ring-ring";
  const eyeButtonClass = "absolute start-2 top-1/2 mt-0.5 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground";

  /* Sign-up only. Drives the live match hint and keeps the submit button
     disabled until the two fields actually agree, so a typo cannot reach the
     network round-trip at all. */
  const isSignUp = mode === "sign-up";
  const confirmTouched = isSignUp && confirmPassword.length > 0;
  const passwordsMismatch = confirmTouched && confirmPassword !== password;
  const passwordsMatch = isSignUp && confirmTouched && confirmPassword === password;
  const canSubmit = !isSignUp || passwordsMatch;
  return <main dir={isRTL ? "rtl" : "ltr"} className="flex h-dvh scroll-container flex-col items-center justify-center overflow-y-auto overscroll-contain bg-background p-4 touch-manipulation sm:p-6">
  {/* `my-auto` lets the card centre itself while still allowing scroll. The
      previous `items-center` + `min-h-dvh` combination centred a card taller
      than the viewport above the top edge, so once the on-screen keyboard
      opened there was no way to reach the submit button. */}
  <div className="my-auto w-full max-w-md rounded-2xl border bg-card p-5 shadow-sm sm:p-8">
    <button type="button" onClick={toggleLocale} className="mb-4 text-sm text-muted-foreground underline">{ar ? "English" : "العربية"}</button>
    {/* The mark is a block-level <img>, so `text-center` does not centre it and
        `mx-auto` on a full-width <div> has nothing to distribute. Flex centring
        is the only form that reliably centres it in both reading directions. */}
    <div className="mb-8 text-center"><div className="mb-4 flex justify-center"><LogoMark size="lg" /></div><h1 className="text-2xl font-semibold">{title}</h1><p className="mt-2 text-sm text-muted-foreground">{ar ? "PermaMind يتذكر ما يهمك." : "PermaMind remembers what matters."}</p></div>
    <form onSubmit={submit} className="space-y-4" noValidate>
      {mode !== "reset" && <label htmlFor="auth-email" className="block text-sm font-medium">{ar ? "البريد الإلكتروني" : "Email"}<input id="auth-email" name="email" required type="email" inputMode="email" autoComplete="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={email} onChange={e => setEmail(e.target.value)} className={plainInputClass} /></label>}
      {mode !== "forgot" && <>
        <label htmlFor="auth-password" className="block text-sm font-medium">{mode === "reset" ? (ar ? "كلمة المرور الجديدة" : "New password") : (ar ? "كلمة المرور" : "Password")}
          <span className="relative mt-1 block">
            <input id="auth-password" name="password" required minLength={6} type={showPassword ? "text" : "password"} autoComplete={mode === "sign-up" || mode === "reset" ? "new-password" : "current-password"} value={password} onChange={e => setPassword(e.target.value)} className={inputClass} />
            <button type="button" onClick={() => setShowPassword(v => !v)} className={eyeButtonClass} aria-label={showPassword ? (ar ? "إخفاء كلمة المرور" : "Hide password") : (ar ? "إظهار كلمة المرور" : "Show password")} aria-pressed={showPassword}>{showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</button>
          </span>
        </label>
        {isSignUp && <div>
          <label htmlFor="auth-confirm-password" className="block text-sm font-medium">{ar ? "تأكيد كلمة المرور" : "Confirm password"}
            <span className="relative mt-1 block">
              {/* `new-password` on both fields is what lets iOS and Android offer
                  "Suggest Strong Password" and drive their own password manager;
                  `current-password` here would make both offer saved logins. */}
              <input id="auth-confirm-password" name="confirmPassword" required minLength={6} type={showConfirmPassword ? "text" : "password"} autoComplete="new-password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} aria-invalid={passwordsMismatch || undefined} aria-describedby="auth-confirm-hint" className={`${inputClass}${passwordsMismatch ? " border-destructive focus:ring-destructive" : passwordsMatch ? " border-primary focus:ring-ring" : ""}`} />
              <button type="button" onClick={() => setShowConfirmPassword(v => !v)} className={eyeButtonClass} aria-label={showConfirmPassword ? (ar ? "إخفاء تأكيد كلمة المرور" : "Hide confirm password") : (ar ? "إظهار تأكيد كلمة المرور" : "Show confirm password")} aria-pressed={showConfirmPassword}>{showConfirmPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</button>
            </span>
          </label>
          {/* Live feedback rather than a message that only appears after a failed
              submit: on a phone the error was often pushed below the fold by
              the on-screen keyboard. `role="status"` announces it to a screen
              reader without stealing focus. */}
          <p id="auth-confirm-hint" role="status" aria-live="polite" className={`mt-1.5 flex items-center gap-1.5 text-sm ${passwordsMismatch ? "text-destructive" : passwordsMatch ? "text-primary" : "text-muted-foreground"}`}>
            {passwordsMismatch && <><AlertCircle aria-hidden="true" className="size-4 shrink-0" />{ar ? "كلمتا المرور غير متطابقتين." : "Passwords do not match."}</>}
            {passwordsMatch && <><CheckCircle2 aria-hidden="true" className="size-4 shrink-0" />{ar ? "كلمتا المرور متطابقتان." : "Passwords match."}</>}
            {!confirmTouched && <>{ar ? "أعد كتابة كلمة المرور للتأكيد." : "Re-enter your password to confirm."}</>}
          </p>
        </div>}
      </>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}{message && <p role="status" className="text-sm text-primary">{message}</p>}
      <button type="submit" disabled={loading || !canSubmit} className="w-full rounded-lg bg-primary px-4 py-2.5 font-medium text-primary-foreground transition-opacity disabled:opacity-50 touch-manipulation">{loading ? (ar ? "يرجى الانتظار..." : "Please wait...") : mode === "sign-in" ? (ar ? "تسجيل الدخول" : "Sign in") : mode === "sign-up" ? (ar ? "إنشاء حساب" : "Create account") : mode === "forgot" ? (ar ? "إرسال رابط الاستعادة" : "Send reset link") : (ar ? "تحديث كلمة المرور" : "Update password")}</button>
    </form>
    <div className="mt-6 space-y-2 text-center text-sm text-muted-foreground">{mode === "sign-in" && <><Link className="block text-foreground underline" href="/auth/forgot-password">{ar ? "نسيت كلمة المرور؟" : "Forgot password?"}</Link><span>{ar ? "ليس لديك حساب؟ " : "Don't have an account? "}<Link className="text-foreground underline" href="/auth/sign-up">{ar ? "إنشاء حساب" : "Sign up"}</Link></span></>}{mode === "sign-up" && <span>{ar ? "لديك حساب بالفعل؟ " : "Already have an account? "}<Link className="text-foreground underline" href="/auth/sign-in">{ar ? "تسجيل الدخول" : "Sign in"}</Link></span>}{mode === "forgot" && <Link className="text-foreground underline" href="/auth/sign-in">{ar ? "العودة لتسجيل الدخول" : "Back to sign in"}</Link>}</div>
  </div></main>;
}