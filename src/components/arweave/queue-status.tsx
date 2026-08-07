"use client";

import { Cloud, CloudOff, RefreshCw, Upload } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { getQueueStatus } from "@/lib/arweave/upload-queue";
import type { QueueStatusSummary } from "@/lib/arweave/snapshot-types";
import { cn } from "@/lib/utils";

interface QueueStatusProps {
  onRetryFailed?: () => void;
  className?: string;
}

/**
 * Displays the current status of the Arweave upload queue.
 * Shows pending/uploading/failed counts and provides a retry button for failed items.
 */
export function QueueStatus({ onRetryFailed, className }: QueueStatusProps) {
  const [status, setStatus] = useState<QueueStatusSummary>({
    total: 0,
    pending: 0,
    uploading: 0,
    done: 0,
    failed: 0,
    lastUploadedAt: null,
  });

  useEffect(() => {
    // Initial load
    setStatus(getQueueStatus());

    // Poll for updates every 2 seconds
    const interval = setInterval(() => {
      setStatus(getQueueStatus());
    }, 2000);

    return () => clearInterval(interval);
  }, []);

  const hasActivity = status.total > 0;
  const hasFailed = status.failed > 0;
  const isUploading = status.uploading > 0;

  // Don't render if there's no activity
  if (!hasActivity) {
    return null;
  }

  const formatLastUpload = (timestamp: string | null): string => {
    if (!timestamp) return "Never";
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    return date.toLocaleDateString();
  };

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={`Backup queue: ${status.pending} pending, ${status.uploading} uploading, ${status.failed} failed`}
      className={cn(
        "flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs",
        className
      )}
    >
      {/* Status Icon */}
      {isUploading ? (
          <Cloud aria-hidden="true" className="size-4 animate-pulse motion-reduce:animate-none text-primary" />
      ) : hasFailed ? (
          <CloudOff aria-hidden="true" className="size-4 text-destructive" />
      ) : (
          <Cloud aria-hidden="true" className="size-4 text-muted-foreground" />
      )}

      {/* Counts */}
      <div className="flex items-center gap-3">
        {status.pending > 0 && (
          <Tooltip>
            <TooltipTrigger>
              <span className="flex items-center gap-1 text-muted-foreground">
                <Upload className="size-3" />
                {status.pending}
              </span>
            </TooltipTrigger>
            <TooltipContent>
              <p>{status.pending} snapshot{status.pending !== 1 ? "s" : ""} pending</p>
            </TooltipContent>
          </Tooltip>
        )}

        {status.uploading > 0 && (
          <Tooltip>
            <TooltipTrigger>
              <span className="flex items-center gap-1 text-primary">
                <RefreshCw className="size-3 animate-spin" />
                {status.uploading}
              </span>
            </TooltipTrigger>
            <TooltipContent>
              <p>{status.uploading} snapshot{status.uploading !== 1 ? "s" : ""} uploading</p>
            </TooltipContent>
          </Tooltip>
        )}

        {status.failed > 0 && (
          <Tooltip>
            <TooltipTrigger>
              <span className="flex items-center gap-1 text-destructive">
                <CloudOff className="size-3" />
                {status.failed}
              </span>
            </TooltipTrigger>
            <TooltipContent>
              <p>{status.failed} snapshot{status.failed !== 1 ? "s" : ""} failed</p>
            </TooltipContent>
          </Tooltip>
        )}
      </div>

      {/* Last Upload Time */}
      {status.lastUploadedAt && (
        <Tooltip>
          <TooltipTrigger>
            <span className="text-muted-foreground">
              Last: {formatLastUpload(status.lastUploadedAt)}
            </span>
          </TooltipTrigger>
          <TooltipContent>
            <p>Last successful upload: {new Date(status.lastUploadedAt).toLocaleString()}</p>
          </TooltipContent>
        </Tooltip>
      )}

      {/* Retry Button */}
      {hasFailed && onRetryFailed && (
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onRetryFailed}
          className="ml-auto"
          aria-label="Retry failed backups"
        >
          <RefreshCw className="size-3" />
        </Button>
      )}
    </div>
  );
}