import * as React from "react"
import { cn } from "@/lib/utils"

/* Deliberately not `HTMLAttributes<HTMLElement>`: that intersects `title` with
   the DOM `title?: string`, which rejects the JSX title the chat header passes
   to truncate long conversation names. `Omit` restores a real `ReactNode`. */
type PageHeaderProps = Omit<React.HTMLAttributes<HTMLElement>, "title"> & {
  title: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
  eyebrow?: React.ReactNode
}

function PageHeader({ title, description, actions, eyebrow, className, ...props }: PageHeaderProps) {
  return <header className={cn("flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-end sm:justify-between", className)} {...props}>
    <div className="min-w-0 space-y-1">
      {eyebrow && <p className="text-caption font-medium uppercase tracking-wider">{eyebrow}</p>}
      {/* `break-words` guards long conversation titles, which are user input and
          can be a single unbroken token. */}
      <h1 className="min-w-0 break-words text-page-title">{title}</h1>
      {description && <p className="text-body max-w-2xl text-muted-foreground">{description}</p>}
    </div>
    {/* Wraps below `sm` instead of `shrink-0`: three action buttons at their
        natural width overflowed a 360px screen and were clipped, because a
        non-shrinking flex row cannot compress. */}
    {actions && <div className="flex flex-wrap items-center gap-2 sm:shrink-0 sm:justify-end">{actions}</div>}
  </header>
}

export { PageHeader }