import * as React from "react"
import { AlertTriangle, ShieldAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type ConfirmDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: React.ReactNode
  consequence: React.ReactNode
  confirmLabel?: string
  cancelLabel?: string
  severity?: "default" | "destructive"
  submitting?: boolean
  children?: React.ReactNode
  onConfirm: () => void
}

function ConfirmDialog({ open, onOpenChange, title, consequence, confirmLabel = "Confirm", cancelLabel = "Cancel", severity = "default", submitting, children, onConfirm }: ConfirmDialogProps) {
  const dialogRef = React.useRef<HTMLDivElement>(null)
  const triggerRef = React.useRef<HTMLElement | null>(null)
  React.useEffect(() => {
    if (!open) return
    triggerRef.current = document.activeElement as HTMLElement
    dialogRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !submitting) onOpenChange(false)
      if (event.key !== "Tab" || !dialogRef.current) return
      const focusable = dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])')
      if (!focusable.length) { event.preventDefault(); return }
      const first = focusable[0], last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener("keydown", onKeyDown)
    return () => { document.removeEventListener("keydown", onKeyDown); if (triggerRef.current?.isConnected) triggerRef.current.focus() }
  }, [open, onOpenChange, submitting])
  if (!open) return null
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-[2px]" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onOpenChange(false) }}>
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="confirm-dialog-title" aria-describedby="confirm-dialog-description" tabIndex={-1} className="surface-card surface-elevated w-full max-w-md p-6 outline-none">
      <div className="flex gap-4"><div className={cn("flex size-10 shrink-0 items-center justify-center rounded-full", severity === "destructive" ? "bg-destructive/10 text-destructive" : "bg-status-protected/10 text-status-protected")}><span aria-hidden="true">{severity === "destructive" ? <AlertTriangle className="size-5" /> : <ShieldAlert className="size-5" />}</span></div><div className="min-w-0"><h2 id="confirm-dialog-title" className="text-section-title">{title}</h2><p id="confirm-dialog-description" className="text-body mt-2 text-muted-foreground">{consequence}</p>{children && <div className="mt-4">{children}</div>}</div></div>
      <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>{cancelLabel}</Button><Button type="button" variant={severity === "destructive" ? "destructive" : "default"} onClick={onConfirm} disabled={submitting}>{submitting ? "Working…" : confirmLabel}</Button></div>
    </div>
  </div>
}

export { ConfirmDialog }