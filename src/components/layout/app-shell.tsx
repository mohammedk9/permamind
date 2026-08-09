"use client";

import { Archive, Brain, LogOut, Menu, MessageSquare, Settings } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { useLocale } from "@/hooks/use-locale";

export type ProductArea = "chat" | "memory" | "backup" | "settings";

const navigation = [
  { id: "chat" as const, label: "Chat", icon: MessageSquare },
  { id: "memory" as const, label: "Memory", icon: Brain },
  { id: "backup" as const, label: "Backup", icon: Archive },
  { id: "settings" as const, label: "Settings", icon: Settings },
];

function Navigation({ activeArea, onNavigate, compact = false }: { activeArea: ProductArea; onNavigate: (area: ProductArea) => void; compact?: boolean }) {
  const { locale } = useLocale();
  const labels = locale === "ar" ? { chat: "المحادثة", memory: "الذاكرة", backup: "النسخ الاحتياطي", settings: "الإعدادات" } : { chat: "Chat", memory: "Memory", backup: "Backup", settings: "Settings" };
  return <nav aria-label="Primary navigation" className="space-y-1">
    {navigation.map(({ id, icon: Icon }) => <Button key={id} variant={activeArea === id ? "secondary" : "ghost"} className={cn("w-full justify-start gap-3", compact && "justify-center px-2")} onClick={() => onNavigate(id)} aria-current={activeArea === id ? "page" : undefined}>
      <Icon className="size-4" /><span className={cn(compact && "sr-only")}>{labels[id]}</span>
    </Button>)}
  </nav>;
}

export function AppShell({ activeArea, onNavigate, children, utility, sidebar }: { activeArea: ProductArea; onNavigate: (area: ProductArea) => void; children: ReactNode; utility?: ReactNode; sidebar?: ReactNode }) {
  const { locale, toggleLocale, isRTL } = useLocale();
  const [isSigningOut, setIsSigningOut] = useState(false);

  async function handleSignOut() {
    setIsSigningOut(true);
    const { error } = await getSupabaseBrowserClient().auth.signOut();
    if (error) {
      setIsSigningOut(false);
      return;
    }
    window.location.assign("/auth/sign-in");
  }

  const logoutButton = <Button
    type="button"
    variant="ghost"
    className="w-full justify-start gap-3 text-muted-foreground hover:text-foreground"
    onClick={handleSignOut}
    disabled={isSigningOut}
  >
    <LogOut className="size-4" />
    <span>{isSigningOut ? (locale === "ar" ? "جارٍ تسجيل الخروج..." : "Logging out...") : (locale === "ar" ? "تسجيل الخروج" : "Log out")}</span>
  </Button>;

  return <div dir={isRTL ? "rtl" : "ltr"} className="flex h-dvh overflow-hidden bg-background">
    <aside className="hidden w-52 shrink-0 flex-col border-r bg-sidebar p-3 md:flex lg:w-56">
      <div className="mb-6 flex items-center gap-2 px-2 font-semibold"><span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">P</span>PermaMind</div>
      <Navigation activeArea={activeArea} onNavigate={onNavigate} />
      {sidebar}
      <div className="mt-auto space-y-2"><Button type="button" variant="ghost" className="w-full justify-start text-xs text-muted-foreground" onClick={toggleLocale}>{locale === "ar" ? "English" : "العربية"}</Button>{utility}{logoutButton}</div>
    </aside>
    <Sheet>
      <SheetTrigger render={<Button variant="ghost" size="icon" className="fixed left-2 top-2 z-30 md:hidden" aria-label="Open navigation"><Menu className="size-5" /></Button>} />
      <SheetContent side="left" className="w-[min(18rem,calc(100vw-2rem))] p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"><SheetTitle className="mb-5">PermaMind</SheetTitle><Navigation activeArea={activeArea} onNavigate={onNavigate} /><div className="mt-6 space-y-2"><Button type="button" variant="ghost" className="w-full justify-start text-xs text-muted-foreground" onClick={toggleLocale}>{locale === "ar" ? "English" : "العربية"}</Button>{utility}{logoutButton}</div></SheetContent>
    </Sheet>
    <main id="main-content" className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">{children}</main>
  </div>;
}