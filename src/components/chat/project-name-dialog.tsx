"use client";

import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLocale } from "@/hooks/use-locale";

/**
 * Naming or renaming a project.
 *
 * ## Why this exists instead of `window.prompt`
 *
 * A project name is the one string that ends up in a URL — `/project/<id>` is addressed by
 * identity, but every human reads the *name* in the sidebar, in the page header and in exported
 * Markdown. It is worth a real dialog for three reasons, and the first is the one that actually
 * broke:
 *
 * 1. `window.prompt` cannot be translated. The browser draws it in the *system* language, so an
 *    Arabic user got an English "Project name" above Arabic-looking buttons, with no way for the
 *    app to intervene. Every string in this dialog passes through `useLocale` like any other.
 * 2. It blocks the main thread and cannot show our own layout, focus ring or RTL handling.
 * 3. It returns a bare string, so there is nowhere to show a validation message. An empty name
 *    silently did nothing here; below it says why.
 */
export function ProjectNameDialog({
  open,
  mode,
  initialName = "",
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  /** `create` keeps the old name; `rename` shows it ready to edit. */
  mode: "create" | "rename";
  initialName?: string;
  onOpenChange: (open: boolean) => void;
  onSubmit: (name: string) => void;
}) {
  const { locale } = useLocale();
  const ar = locale === "ar";
  const [name, setName] = useState(initialName);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setName(initialName);
    setError("");
    // A tick's delay so the input exists; autofocus before paint would scroll a sidebar into view.
    const timer = window.setTimeout(() => inputRef.current?.select(), 0);
    return () => window.clearTimeout(timer);
  }, [open, initialName]);

  const submit = () => {
    const trimmed = name.trim();
    // The cap matches the sidebar: a name longer than this is truncated in the one place the
    // user reads it, so two projects could look identical in the list.
    if (!trimmed) {
      setError(ar ? "اكتب اسما للمشروع." : "Give the project a name.");
      return;
    }
    if (trimmed.length > 80) {
      setError(ar ? "الاسم طويل جدا (٨٠ حرفا كحد أقصى)." : "That name is too long (80 characters max).");
      return;
    }
    onSubmit(trimmed);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-[2px]"
      role="presentation"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onOpenChange(false); }}
    >
      <div role="dialog" aria-modal="true" aria-labelledby="project-name-title" className="surface-card surface-elevated w-full max-w-md p-6">
        <h2 id="project-name-title" className="text-section-title">
          {mode === "create"
            ? ar ? "مشروع جديد" : "New project"
            : ar ? "إعادة تسمية المشروع" : "Rename project"}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {ar
            ? "هذا الاسم هو ما سيظهر في القائمة الجانبية وفي التصدير."
            : "This is the name shown in your sidebar and in exports."}
        </p>

        <form
          className="mt-4 space-y-2"
          onSubmit={(event) => { event.preventDefault(); submit(); }}
        >
          <label htmlFor="project-name-input" className="block text-sm font-medium">
            {ar ? "اسم المشروع" : "Project name"}
          </label>
          <Input
            id="project-name-input"
            ref={inputRef}
            value={name}
            onChange={(event) => { setName(event.target.value); setError(""); }}
            maxLength={120}
            placeholder={ar ? "مثال: إطلاق الموقع" : "e.g. Website relaunch"}
            aria-label={ar ? "اسم المشروع" : "Project name"}
            aria-invalid={Boolean(error)}
          />
          {error ? (
            <p role="alert" className="text-xs text-destructive">{error}</p>
          ) : null}

          <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {ar ? "إلغاء" : "Cancel"}
            </Button>
            <Button type="submit">
              {mode === "create"
                ? ar ? "إنشاء" : "Create"
                : ar ? "حفظ" : "Save"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}