import * as React from "react"
import { CircleCheck, CircleAlert, CircleX, LockKeyhole, Minus, LoaderCircle } from "lucide-react"
import { cn } from "@/lib/utils"

const statusStyles = {
  neutral: "bg-status-neutral/10 text-status-neutral",
  active: "bg-status-active/10 text-status-active",
  success: "bg-status-success/10 text-status-success",
  attention: "bg-status-attention/15 text-status-attention",
  error: "bg-status-error/10 text-status-error",
  protected: "bg-status-protected/10 text-status-protected",
} as const
const statusIcons = { neutral: Minus, active: LoaderCircle, success: CircleCheck, attention: CircleAlert, error: CircleX, protected: LockKeyhole }
type Status = keyof typeof statusStyles

function StatusPill({ status = "neutral", label, detail, className }: { status?: Status; label: React.ReactNode; detail?: React.ReactNode; className?: string }) {
  const Icon = statusIcons[status]
  return <span className={cn("inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium", statusStyles[status], className)}>
    <Icon aria-hidden="true" className={cn("size-3.5 shrink-0", status === "active" && "motion-safe:animate-spin")} />
    <span className="truncate">{label}</span>{detail && <span className="truncate opacity-75">{detail}</span>}
    <span className="sr-only">Status: {status}</span>
  </span>
}
export { StatusPill, type Status }