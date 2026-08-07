import * as React from "react"
import { Inbox } from "lucide-react"
import { cn } from "@/lib/utils"

function EmptyState({ icon: Icon = Inbox, title, description, action, className }: { icon?: React.ElementType; title: React.ReactNode; description: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return <div className={cn("flex min-h-48 flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-muted/20 p-8 text-center", className)}>
    <div className="mb-4 rounded-xl bg-muted p-3 text-muted-foreground"><Icon aria-hidden="true" className="size-6" /></div>
    <h2 className="text-section-title">{title}</h2><p className="text-body mt-2 max-w-md text-muted-foreground">{description}</p>
    {action && <div className="mt-5">{action}</div>}
  </div>
}
export { EmptyState }