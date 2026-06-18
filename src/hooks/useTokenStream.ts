import { useCallback, useEffect, useRef, useState } from "react";
import type { StreamChunk, StreamSourceFactory, StreamStatusValue, ToolCallState } from "../types";

export interface UseTokenStreamOptions {
  /** Called for every chunk as it arrives — escape hatch for consumers who want raw access. */
  onChunk?: (chunk: StreamChunk) => void;
  /** Called once when the stream finishes successfully. */
  onDone?: (finalText: string) => void;
  /** Called once if the stream errors. */
  onError?: (error: Error) => void;
  /**
   * Whether to start the stream immediately on mount. Default true.
   * Set false to control start() manually (e.g. wait for a user action).
   */
  autoStart?: boolean;
  /**
   * A stable identity that, when changed, triggers a fresh run of the stream
   * (aborting any in-flight run first). This is deliberately separate from
   * the `factory` argument: factory functions are very commonly passed as
   * inline closures (`(signal) => adapter(response, signal)`), which get a
   * new function identity on every render. If the hook re-ran on every
   * factory identity change, that would cause an infinite restart loop for
   * the overwhelmingly common inline-closure usage pattern.
   *
   * Pass something like a message id, request id, or incrementing counter
   * here when you want a new stream to start (e.g. a new user prompt).
   * Defaults to a constant, meaning the stream only runs once on mount
   * unless `restart()` is called manually.
   */
  streamKey?: string | number;
}

export interface UseTokenStreamResult {
  /** Accumulated text so far. */
  text: string;
  /** Tool calls seen so far, keyed by toolCallId internally but exposed as an array in arrival order. */
  toolCalls: ToolCallState[];
  status: StreamStatusValue;
  error: Error | null;
  /** Abort the in-flight stream. Safe to call when idle/done — it's a no-op then. */
  abort: () => void;
  /** Re-run the stream from scratch (e.g. retry after an error). Aborts any in-flight stream first. */
  restart: () => void;
  /** Manually start the stream when autoStart is false. */
  start: () => void;
}

const BATCH_INTERVAL_MS = 33; // ~30fps — fast enough to feel live, slow enough to avoid thrashing React

/**
 * Consumes a StreamSource (produced by a StreamSourceFactory) and exposes
 * accumulated text + tool-call state as React state.
 *
 * Key engineering decisions:
 *
 * 1. Backpressure-safe batching: naive implementations call setState on every
 *    chunk, which means a fast stream (or a fast network catching up after a
 *    stall) causes a React re-render per token — janky and wasteful. Instead,
 *    incoming chunks are buffered in a ref and flushed to state on a fixed
 *    interval via requestAnimationFrame-style batching, decoupling network
 *    arrival rate from render rate.
 *
 * 2. Abort correctness: every run gets its own AbortController. If the
 *    component unmounts, restart() is called, or streamKey changes (a new
 *    logical stream begins), the *previous* controller is aborted before the
 *    new one starts. This avoids the classic race where an old stream's
 *    chunks land after a newer one has already started (and would otherwise
 *    corrupt state with stale data).
 *
 * 3. Stale-closure safety: the running flag and accumulated buffers live in
 *    refs, not state, so the async consumption loop always reads current
 *    values rather than a snapshot captured at loop-start time.
 */
export function useTokenStream(
  factory: StreamSourceFactory,
  options: UseTokenStreamOptions = {}
): UseTokenStreamResult {
  const { onChunk, onDone, onError, autoStart = true, streamKey } = options;

  const [text, setText] = useState("");
  const [toolCalls, setToolCalls] = useState<ToolCallState[]>([]);
  const [status, setStatus] = useState<StreamStatusValue>("idle");
  const [error, setError] = useState<Error | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const textBufferRef = useRef("");
  const toolCallMapRef = useRef<Map<string, ToolCallState>>(new Map());
  const toolCallOrderRef = useRef<string[]>([]);
  const flushTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const runIdRef = useRef(0);

  // Keep latest callbacks/factory in refs so the run loop doesn't need them in
  // deps. Critically, `factory` is NOT a dependency that triggers re-runs —
  // see the streamKey doc comment above for why.
  const onChunkRef = useRef(onChunk);
  const onDoneRef = useRef(onDone);
  const onErrorRef = useRef(onError);
  const factoryRef = useRef(factory);
  onChunkRef.current = onChunk;
  onDoneRef.current = onDone;
  onErrorRef.current = onError;
  factoryRef.current = factory;

  const flush = useCallback(() => {
    setText(textBufferRef.current);
    setToolCalls(toolCallOrderRef.current.map((id) => toolCallMapRef.current.get(id)!));
  }, []);

  const stopFlushTimer = useCallback(() => {
    if (flushTimerRef.current !== null) {
      clearInterval(flushTimerRef.current);
      flushTimerRef.current = null;
    }
  }, []);

  const applyChunk = useCallback((chunk: StreamChunk) => {
    onChunkRef.current?.(chunk);

    switch (chunk.type) {
      case "text": {
        textBufferRef.current += chunk.delta;
        break;
      }
      case "tool-call-start": {
        const state: ToolCallState = {
          toolCallId: chunk.toolCallId,
          toolName: chunk.toolName,
          status: "pending",
        };
        toolCallMapRef.current.set(chunk.toolCallId, state);
        toolCallOrderRef.current.push(chunk.toolCallId);
        break;
      }
      case "tool-call-ready": {
        const existing = toolCallMapRef.current.get(chunk.toolCallId);
        toolCallMapRef.current.set(chunk.toolCallId, {
          toolCallId: chunk.toolCallId,
          toolName: chunk.toolName,
          status: "executing",
          args: chunk.args,
          result: existing?.result,
        });
        break;
      }
      case "tool-call-delta": {
        // Argument deltas are intentionally not surfaced as partial JSON state —
        // partial JSON isn't safely parseable mid-stream. Consumers needing live
        // arg text can hook onChunk directly; the state machine only exposes
        // fully-ready calls to avoid encouraging fragile partial-JSON parsing.
        break;
      }
      case "tool-result": {
        const existing = toolCallMapRef.current.get(chunk.toolCallId);
        if (existing) {
          toolCallMapRef.current.set(chunk.toolCallId, {
            ...existing,
            status: chunk.isError ? "error" : "success",
            result: chunk.result,
          });
        }
        break;
      }
      case "done":
      case "error":
        break;
    }
  }, []);

  const run = useCallback(() => {
    // Abort whatever was previously running before starting a new run.
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    const thisRunId = ++runIdRef.current;

    textBufferRef.current = "";
    toolCallMapRef.current = new Map();
    toolCallOrderRef.current = [];
    setText("");
    setToolCalls([]);
    setError(null);
    setStatus("streaming");

    stopFlushTimer();
    flushTimerRef.current = setInterval(() => {
      if (runIdRef.current === thisRunId) flush();
    }, BATCH_INTERVAL_MS);

    (async () => {
      try {
        const source = await factoryRef.current(controller.signal);
        for await (const chunk of source) {
          if (controller.signal.aborted || runIdRef.current !== thisRunId) return;
          applyChunk(chunk);
          if (chunk.type === "error") {
            throw chunk.error;
          }
        }
        if (controller.signal.aborted || runIdRef.current !== thisRunId) return;
        flush();
        stopFlushTimer();
        setStatus("done");
        onDoneRef.current?.(textBufferRef.current);
      } catch (err) {
        if (controller.signal.aborted || runIdRef.current !== thisRunId) return;
        flush();
        stopFlushTimer();
        const normalizedError = err instanceof Error ? err : new Error(String(err));
        setError(normalizedError);
        setStatus("error");
        onErrorRef.current?.(normalizedError);
      }
    })();
  }, [applyChunk, flush, stopFlushTimer]);

  const abort = useCallback(() => {
    if (abortControllerRef.current && status === "streaming") {
      abortControllerRef.current.abort();
      stopFlushTimer();
      flush();
      setStatus("aborted");
    }
  }, [status, stopFlushTimer, flush]);

  const restart = useCallback(() => {
    run();
  }, [run]);

  const start = useCallback(() => {
    if (status === "idle") run();
  }, [status, run]);

  useEffect(() => {
    if (autoStart) run();
    return () => {
      abortControllerRef.current?.abort();
      stopFlushTimer();
    };
    // Re-run only when streamKey changes (or on mount) — NOT when `factory`
    // changes identity. See the streamKey doc comment on
    // UseTokenStreamOptions for the rationale; depending on `factory` here
    // would cause an infinite loop for the common case of inline factory
    // closures, since those get a new identity every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streamKey]);

  return { text, toolCalls, status, error, abort, restart, start };
}
