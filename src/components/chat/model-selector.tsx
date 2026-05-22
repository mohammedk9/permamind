"use client";

import { FREE_MODELS } from "@/lib/ai/free-models";
import { PREMIUM_MODELS } from "@/lib/ai/models";
import type { ApiKeyMode } from "@/lib/settings/api-key-storage";
import { cn } from "@/lib/utils";

interface ModelSelectorProps {
  value: string;
  onChange: (model: string) => void;
  mode: ApiKeyMode;
  disabled?: boolean;
  className?: string;
}

export function ModelSelector({
  value,
  onChange,
  mode,
  disabled,
  className,
}: ModelSelectorProps) {
  const models = mode === "free" ? FREE_MODELS : [...PREMIUM_MODELS, ...FREE_MODELS];

  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        "h-8 max-w-[140px] rounded-lg border border-input bg-background px-2.5 text-xs font-medium",
        "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      aria-label="Select AI model"
    >
      {models.map((model) => (
        <option key={model.id} value={model.id}>
          {model.label}
        </option>
      ))}
    </select>
  );
}
