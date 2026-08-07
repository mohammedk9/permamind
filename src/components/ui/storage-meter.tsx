import { cn } from "@/lib/utils"
import { StatusPill, type Status } from "@/components/ui/status-pill"

function StorageMeter({ used, total, percentage, status = "neutral", label = "Storage used", className }: { used?: string; total?: string; percentage: number; status?: Status; label?: string; className?: string }) {
  const value = Math.min(100, Math.max(0, percentage))
  return <div className={cn("space-y-2", className)}><div className="flex items-center justify-between gap-3"><span className="text-label">{label}</span><StatusPill status={status} label={`${Math.round(value)}%`} /></div><div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value} className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary transition-[width] motion-reduce:transition-none" style={{ width: `${value}%` }} /></div>{(used || total) && <p className="text-caption">{used}{used && total && " of "}{total}</p>}</div>
}
export { StorageMeter }