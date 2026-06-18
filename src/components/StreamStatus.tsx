import type { ReactNode } from "react";
import type { StreamStatusValue } from "../types";

export interface StreamStatusProps {
  status: StreamStatusValue;
  error?: Error | null;
  className?: string;
  /**
   * Headless escape hatch: if provided, StreamStatus renders whatever this
   * returns instead of its default markup, while still computing the
   * human-readable label/status for you. This lets consumers reuse the
   * status-to-label mapping without inheriting any forced styling — useful
   * if your design system already has its own badge/spinner components.
   */
  children?: (info: { status: StreamStatusValue; label: string; error: Error | null }) => ReactNode;
}

const DEFAULT_LABELS: Record<StreamStatusValue, string> = {
  idle: "Idle",
  streaming: "Thinking…",
  done: "Done",
  error: "Error",
  aborted: "Stopped",
};

/**
 * A small composable indicator for stream lifecycle state. Default markup
 * is intentionally minimal (a dot + label) so it doesn't fight a consumer's
 * design system; pass `children` as a render function for full control
 * while still reusing the status->label mapping.
 */
export function StreamStatus({ status, error = null, className, children }: StreamStatusProps) {
  const label = status === "error" && error ? error.message : DEFAULT_LABELS[status];

  if (children) {
    return <>{children({ status, label, error })}</>;
  }

  return (
    <span
      className={className}
      data-streamkit="stream-status"
      data-status={status}
      role={status === "error" ? "alert" : "status"}
    >
      <span data-streamkit="stream-status-dot" aria-hidden="true" />
      <span data-streamkit="stream-status-label">{label}</span>
    </span>
  );
}
