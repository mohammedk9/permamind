import * as React from "react"
import { cn } from "@/lib/utils"

type PageHeaderProps = React.HTMLAttributes<HTMLElement> & {
  title: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
  eyebrow?: React.ReactNode
}

function PageHeader({ title, description, actions, eyebrow, className, ...props }: PageHeaderProps) {
  return <header className={cn("flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-end sm:justify-between", className)} {...props}>
    <div className="min-w-0 space-y-1">
      {eyebrow && <p className="text-caption font-medium uppercase tracking-wider">{eyebrow}</p>}
      <h1 className="text-page-title">{title}</h1>
      {description && <p className="text-body max-w-2xl text-muted-foreground">{description}</p>}
    </div>
    {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
  </header>
}

export { PageHeader }