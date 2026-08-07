"use client";
import { useCallback, useEffect, useState } from "react";
import { consumeFreeMessage, FREE_DAILY_MESSAGE_LIMIT, getRemainingFreeMessages } from "@/lib/settings/free-usage";

export function useFreeUsage(enabled: boolean) {
  const [remaining, setRemaining] = useState(FREE_DAILY_MESSAGE_LIMIT);
  useEffect(() => { if (enabled) setRemaining(getRemainingFreeMessages()); }, [enabled]);
  const consume = useCallback(() => {
    if (enabled) {
      consumeFreeMessage();
      setRemaining(getRemainingFreeMessages());
    }
  }, [enabled]);
  return { remaining: enabled ? remaining : null, consume };
}