import { useCallback, useEffect, useRef, useState } from "react";
import type { ToolCallReadyChunk, ToolCallState } from "../types";

/**
 * A tool implementation: given parsed args, returns a result (or throws/rejects).
 * Receives an AbortSignal so long-running tools can be cancelled if the
 * owning component unmounts or the call is superseded.
 */
export type ToolImplementation<TArgs = unknown, TResult = unknown> = (
  args: TArgs,
  signal: AbortSignal
) => Promise<TResult> | TResult;

export interface ToolRegistry {
  [toolName: string]: ToolImplementation;
}

export interface UseToolCallStateOptions {
  /** Map of tool name -> implementation. Calls for unregistered tool names land in "error" status. */
  tools: ToolRegistry;
  /** Called whenever any tracked call's status changes. Useful for sending tool-result chunks back upstream. */
  onCallSettled?: (call: ToolCallState) => void;
  /**
   * Maximum number of tool calls to retain in state. Older settled calls are
   * evicted first once this is exceeded, so a long-running chat session
   * doesn't accumulate unbounded history. Default 50.
   */
  maxHistory?: number;
}

export interface UseToolCallStateResult {
  /** All tracked calls, in arrival order. */
  calls: ToolCallState[];
  /**
   * Register a tool call as ready to execute. If the named tool exists in
   * the registry, execution starts immediately (status moves
   * pending -> executing -> success/error). If the call id already exists,
   * this is a no-op — re-delivery of the same ready-chunk (e.g. from a
   * retried network read) won't re-execute the tool.
   */
  registerCall: (chunk: ToolCallReadyChunk) => void;
  /** Look up a single call's current state by id. */
  getCall: (toolCallId: string) => ToolCallState | undefined;
  /** Clear all tracked calls — typically called when starting a new conversation. */
  reset: () => void;
}

/**
 * Manages the execution lifecycle of tool calls: given a registry of real
 * tool implementations, runs them as their arguments become ready and
 * tracks pending/executing/success/error state for UI rendering.
 *
 * This is intentionally decoupled from useTokenStream — a stream reports
 * *that* a tool call is ready, this hook decides *what to do about it*.
 * That separation matters because tool execution has different lifecycle
 * needs than text streaming: it can run concurrently with other calls, can
 * outlive the stream that requested it (e.g. a slow API call after the
 * model has already finished talking), and needs idempotency guarantees
 * that text deltas don't.
 *
 * Idempotency: registerCall is safe to call multiple times with the same
 * toolCallId (e.g. if an upstream consumer re-delivers a chunk after a
 * reconnect) — only the first registration triggers actual execution.
 */
export function useToolCallState(options: UseToolCallStateOptions): UseToolCallStateResult {
  const { tools, onCallSettled, maxHistory = 50 } = options;

  const [calls, setCalls] = useState<ToolCallState[]>([]);
  const callMapRef = useRef<Map<string, ToolCallState>>(new Map());
  const callOrderRef = useRef<string[]>([]);
  const abortControllersRef = useRef<Map<string, AbortController>>(new Map());

  const toolsRef = useRef(tools);
  const onCallSettledRef = useRef(onCallSettled);
  toolsRef.current = tools;
  onCallSettledRef.current = onCallSettled;

  const flush = useCallback(() => {
    setCalls(callOrderRef.current.map((id) => callMapRef.current.get(id)!));
  }, []);

  const updateCall = useCallback(
    (toolCallId: string, patch: Partial<ToolCallState>) => {
      const existing = callMapRef.current.get(toolCallId);
      if (!existing) return;
      const updated: ToolCallState = { ...existing, ...patch };
      callMapRef.current.set(toolCallId, updated);
      flush();
      if (updated.status === "success" || updated.status === "error") {
        onCallSettledRef.current?.(updated);
      }
    },
    [flush]
  );

  const evictOldestSettledIfOverCapacity = useCallback(() => {
    while (callOrderRef.current.length > maxHistory) {
      // Find the oldest call that's actually settled — never evict a call
      // that's still pending/executing, since that would orphan an
      // in-flight execution's eventual state update.
      const idx = callOrderRef.current.findIndex((id) => {
        const c = callMapRef.current.get(id);
        return c && (c.status === "success" || c.status === "error");
      });
      if (idx === -1) break; // nothing evictable right now
      const [evictedId] = callOrderRef.current.splice(idx, 1);
      callMapRef.current.delete(evictedId!);
      abortControllersRef.current.delete(evictedId!);
    }
  }, [maxHistory]);

  const registerCall = useCallback(
    (chunk: ToolCallReadyChunk) => {
      if (callMapRef.current.has(chunk.toolCallId)) {
        // Already registered — idempotent no-op, don't re-execute.
        return;
      }

      const initial: ToolCallState = {
        toolCallId: chunk.toolCallId,
        toolName: chunk.toolName,
        status: "pending",
        args: chunk.args,
      };
      callMapRef.current.set(chunk.toolCallId, initial);
      callOrderRef.current.push(chunk.toolCallId);
      evictOldestSettledIfOverCapacity();
      flush();

      const impl = toolsRef.current[chunk.toolName];
      if (!impl) {
        updateCall(chunk.toolCallId, {
          status: "error",
          error: new Error(`No tool implementation registered for "${chunk.toolName}"`),
        });
        return;
      }

      const controller = new AbortController();
      abortControllersRef.current.set(chunk.toolCallId, controller);
      updateCall(chunk.toolCallId, { status: "executing" });

      (async () => {
        try {
          const result = await impl(chunk.args, controller.signal);
          if (controller.signal.aborted) return;
          updateCall(chunk.toolCallId, { status: "success", result });
        } catch (err) {
          if (controller.signal.aborted) return;
          const normalizedError = err instanceof Error ? err : new Error(String(err));
          updateCall(chunk.toolCallId, { status: "error", error: normalizedError });
        }
      })();
    },
    [evictOldestSettledIfOverCapacity, flush, updateCall]
  );

  const getCall = useCallback((toolCallId: string) => callMapRef.current.get(toolCallId), []);

  const reset = useCallback(() => {
    for (const controller of abortControllersRef.current.values()) {
      controller.abort();
    }
    abortControllersRef.current.clear();
    callMapRef.current.clear();
    callOrderRef.current = [];
    setCalls([]);
  }, []);

  useEffect(() => {
    return () => {
      for (const controller of abortControllersRef.current.values()) {
        controller.abort();
      }
    };
  }, []);

  return { calls, registerCall, getCall, reset };
}
