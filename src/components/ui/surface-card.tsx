import * as React from "react"
import { cn } from "@/lib/utils"

type SurfaceCardProps = React.HTMLAttributes<HTMLDivElement> & {
  title?: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
}

function SurfaceCard({ title, description, actions, className, children, ...props }: SurfaceCardProps) {
  return <section className={cn("surface-card p-5", className)} {...props}>
    {(title || description || actions) && <div className="mb-4 flex items-start justify-between gap-4">
      <div className="min-w-0 space-y-1">{title && <h2 className="text-section-title">{title}</h2>}{description && <p className="text-caption">{description}</p>}</div>
      {actions && <div className="shrink-0">{actions}</div>}
    </div>}
    {children}
  </section>
}

export { SurfaceCard }