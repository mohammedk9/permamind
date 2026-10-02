"use client";

import { Archive, Brain, LogOut, Menu, MessageSquare, Settings } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { useLocale } from "@/hooks/use-locale";
import { Logo } from "@/components/ui/logo";

export type ProductArea = "chat" | "memory" | "backup" | "settings" | "project";

const navigation = [
  { id: "chat" as const, label: "Chat", icon: MessageSquare },
  { id: "memory" as const, label: "Memory", icon: Brain },
  { id: "backup" as const, label: "Backup", icon: Archive },
  { id: "settings" as const, label: "Settings", icon: Settings },
];

function Navigation({ activeArea, onNavigate, compact = false }: { activeArea: ProductArea; onNavigate: (area: ProductArea) => void; compact?: boolean }) {
  const { locale } = useLocale();
  const labels = locale === "ar" ? { chat: "المحادثة", memory: "الذاكرة", backup: "النسخ الاحتياطي", settings: "الإعدادات" } : { chat: "Chat", memory: "Memory", backup: "Backup", settings: "Settings" };
  return <nav aria-label="Primary navigation" className="shrink-0 space-y-1">
    {navigation.map(({ id, icon: Icon }) => <Button key={id} variant={activeArea === id ? "secondary" : "ghost"} className={cn("w-full justify-start gap-3 rounded-lg px-3 py-2 text-sm font-medium shadow-sm transition-colors", compact && "justify-center px-2", activeArea === id && "bg-sidebar-accent text-sidebar-accent-foreground")} onClick={() => onNavigate(id)} aria-current={activeArea === id ? "page" : undefined}>
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

  return <div dir={isRTL ? "rtl" : "ltr"} className="flex h-dvh touch-manipulation overflow-hidden bg-background">
    <aside className="hidden h-full min-h-0 w-52 shrink-0 flex-col overflow-hidden border-e bg-sidebar p-3 md:flex lg:w-56">
      <div className="mb-6 flex shrink-0 items-center gap-2 px-2 font-semibold"><Logo size="xs" withWordmark /></div>
      <div className="scroll-container flex min-h-0 flex-1 flex-col overflow-y-auto">
        <Navigation activeArea={activeArea} onNavigate={onNavigate} />
        {sidebar}
      </div>
      <div className="mt-auto shrink-0 space-y-1.5 border-t border-sidebar-border pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <Button type="button" variant="ghost" className="w-full justify-start gap-3 rounded-lg px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring/50" onClick={toggleLocale}>{locale === "ar" ? "English" : "العربية"}</Button>
        {utility}
        <div>{logoutButton}</div>
      </div>
    </aside>
    <Sheet>
      {/* `start-2`, not `left-2`: the shell flips to RTL for Arabic, and a
          physical left offset would park the button on the wrong edge.
          `pt-[env(safe-area-inset-top)]` keeps it below the notch in
          standalone mode. */}
      <SheetTrigger render={<Button variant="ghost" size="icon" className="fixed start-2 top-2 z-30 pt-[env(safe-area-inset-top)] md:hidden" aria-label="Open navigation"><Menu className="size-5" /></Button>} />
      <SheetContent side={isRTL ? "right" : "left"} className="flex h-full min-h-0 w-[min(18rem,calc(100vw-2rem))] flex-col overflow-hidden p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"><div className="mb-5 shrink-0"><Logo size="xs" withWordmark /></div><div className="min-h-0 flex-1 overflow-y-auto"><Navigation activeArea={activeArea} onNavigate={onNavigate} /></div><div className="mt-auto shrink-0 space-y-1.5 border-t border-border pt-3"><Button type="button" variant="ghost" className="w-full justify-start gap-3 rounded-lg px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring/50" onClick={toggleLocale}>{locale === "ar" ? "English" : "العربية"}</Button>{utility}<div>{logoutButton}</div></div></SheetContent>
    </Sheet>
    <main id="main-content" className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">{children}</main>
  </div>;
}