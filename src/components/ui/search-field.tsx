import * as React from "react"
import { Search, X, LoaderCircle } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type SearchFieldProps = React.ComponentProps<typeof Input> & { loading?: boolean; resultCount?: number; onClear?: () => void }
function SearchField({ className, loading, resultCount, onClear, value, ...props }: SearchFieldProps) {
  const hasValue = value !== undefined && String(value).length > 0
  return <div className={cn("relative flex items-center", className)}>
    {loading ? <LoaderCircle aria-hidden="true" className="absolute left-3 size-4 animate-spin text-muted-foreground motion-reduce:animate-none" /> : <Search aria-hidden="true" className="absolute left-3 size-4 text-muted-foreground" />}
    <Input {...props} value={value} className="h-10 pl-9 pr-9" type="search" aria-busy={loading || undefined} />
    {hasValue && onClear && <Button type="button" variant="ghost" size="icon-sm" className="absolute right-1" aria-label="Clear search" onClick={onClear}><X /></Button>}
    {resultCount !== undefined && <span className="sr-only" aria-live="polite">{resultCount} search results</span>}
  </div>
}
export { SearchField }