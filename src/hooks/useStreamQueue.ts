import { useCallback, useEffect, useRef, useState } from "react";
import type { StreamChunk, StreamSourceFactory, StreamStatusValue, ToolCallState } from "../types";

export interface QueuedStreamState {
  id: string;
  text: string;
  toolCalls: ToolCallState[];
  status: StreamStatusValue;
  error: Error | null;
}

export interface UseStreamQueueOptions {
  /**
   * Maximum number of streams allowed to run concurrently. Additional
   * enqueued streams wait in a pending state until a slot frees up. Default
   * is unbounded (Infinity) — set this when running many parallel tool
   * calls against a rate-limited backend.
   */
  concurrency?: number;
  onChunk?: (id: string, chunk: StreamChunk) => void;
  onDone?: (id: string, finalText: string) => void;
  onError?: (id: string, error: Error) => void;
}

export interface UseStreamQueueResult {
  /** All tracked streams, in the order they were enqueued. */
  streams: QueuedStreamState[];
  /** Enqueue a new stream. Returns the id used to track it (auto-generated if not provided). */
  enqueue: (factory: StreamSourceFactory, id?: string) => string;
  /** Abort a specific stream by id. */
  abort: (id: string) => void;
  /** Abort every stream currently running or pending. */
  abortAll: () => void;
  /** True if any tracked stream is still streaming or pending. */
  isAnyActive: boolean;
}

const SHARED_FLUSH_INTERVAL_MS = 33;

interface InternalEntry {
  id: string;
  factory: StreamSourceFactory;
  controller: AbortController | null;
  status: StreamStatusValue | "pending";
  textBuffer: string;
  toolCallMap: Map<string, ToolCallState>;
  toolCallOrder: string[];
  error: Error | null;
  runId: number;
}

/**
 * Runs multiple StreamSources concurrently (up to an optional concurrency
 * cap) and exposes their combined state.
 *
 * WHY NOT JUST CALL useTokenStream N TIMES: you could, and for 2-3 fixed
 * streams that's often simpler. This hook exists for the dynamic case —
 * an unknown number of streams enqueued over time (e.g. a model emits 5
 * parallel tool calls, each of which itself streams output) — where you
 * need a single list-shaped view rather than N independently-named hook
 * calls, plus optional admission control (concurrency) so 50 parallel tool
 * calls don't all hit a rate-limited backend at once.
 *
 * SHARED FLUSH TICK: each entry buffers its incoming text in a plain object
 * (not React state) exactly like useTokenStream does, but instead of each
 * stream running its own setInterval, all entries are flushed together on
 * one shared interval. This matters because React 18's automatic batching
 * only coalesces setState calls within the same callback — two independent
 * per-stream timers firing a few milliseconds apart from each other still
 * cause two separate render passes. A single shared tick guarantees that
 * if 10 streams all produced new chunks since the last tick, they produce
 * exactly one re-render, not up to 10.
 *
 * ADMISSION CONTROL: when concurrency is set, entries beyond the limit sit
 * in "pending" status and their factory isn't invoked until a running slot
 * frees up (on that stream's done/error/abort). This is a real scheduler
 * decision, not just a rendering one — it bounds how many in-flight
 * requests hit whatever backend the factories call into.
 */
export function useStreamQueue(options: UseStreamQueueOptions = {}): UseStreamQueueResult {
  const { concurrency = Infinity, onChunk, onDone, onError } = options;

  const [streams, setStreams] = useState<QueuedStreamState[]>([]);
  const entriesRef = useRef<Map<string, InternalEntry>>(new Map());
  const orderRef = useRef<string[]>([]);
  const flushTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const idCounterRef = useRef(0);

  const onChunkRef = useRef(onChunk);
  const onDoneRef = useRef(onDone);
  const onErrorRef = useRef(onError);
  onChunkRef.current = onChunk;
  onDoneRef.current = onDone;
  onErrorRef.current = onError;

  const flush = useCallback(() => {
    setStreams(
      orderRef.current.map((id) => {
        const e = entriesRef.current.get(id)!;
        return {
          id: e.id,
          text: e.textBuffer,
          toolCalls: e.toolCallOrder.map((tcId) => e.toolCallMap.get(tcId)!),
          status: e.status === "pending" ? "idle" : e.status,
          error: e.error,
        };
      })
    );
  }, []);

  const ensureFlushTimer = useCallback(() => {
    if (flushTimerRef.current !== null) return;
    flushTimerRef.current = setInterval(flush, SHARED_FLUSH_INTERVAL_MS);
  }, [flush]);

  const stopFlushTimerIfIdle = useCallback(() => {
    const anyRunning = Array.from(entriesRef.current.values()).some((e) => e.status === "streaming");
    if (!anyRunning && flushTimerRef.current !== null) {
      clearInterval(flushTimerRef.current);
      flushTimerRef.current = null;
    }
  }, []);

  const runningCount = useCallback(
    () => Array.from(entriesRef.current.values()).filter((e) => e.status === "streaming").length,
    []
  );

  const promoteNextPending = useCallback(() => {
    if (runningCount() >= concurrency) return;
    const nextPendingId = orderRef.current.find((id) => entriesRef.current.get(id)?.status === "pending");
    if (nextPendingId) startEntry(nextPendingId);
  }, [concurrency, runningCount]);

  function startEntry(id: string) {
    const entry = entriesRef.current.get(id);
    if (!entry) return;

    const controller = new AbortController();
    entry.controller = controller;
    entry.status = "streaming";
    entry.runId += 1;
    const thisRunId = entry.runId;
    ensureFlushTimer();
    flush();

    (async () => {
      try {
        const source = await entry.factory(controller.signal);
        for await (const chunk of source) {
          if (controller.signal.aborted || entry.runId !== thisRunId) return;
          onChunkRef.current?.(id, chunk);
          applyChunkToEntry(entry, chunk);
          if (chunk.type === "error") throw chunk.error;
        }
        if (controller.signal.aborted || entry.runId !== thisRunId) return;
        entry.status = "done";
        flush();
        onDoneRef.current?.(id, entry.textBuffer);
      } catch (err) {
        if (controller.signal.aborted || entry.runId !== thisRunId) return;
        const normalizedError = err instanceof Error ? err : new Error(String(err));
        entry.status = "error";
        entry.error = normalizedError;
        flush();
        onErrorRef.current?.(id, normalizedError);
      } finally {
        stopFlushTimerIfIdle();
        promoteNextPending();
      }
    })();
  }

  function applyChunkToEntry(entry: InternalEntry, chunk: StreamChunk) {
    switch (chunk.type) {
      case "text":
        entry.textBuffer += chunk.delta;
        break;
      case "tool-call-start":
        entry.toolCallMap.set(chunk.toolCallId, {
          toolCallId: chunk.toolCallId,
          toolName: chunk.toolName,
          status: "pending",
        });
        entry.toolCallOrder.push(chunk.toolCallId);
        break;
      case "tool-call-ready": {
        const existing = entry.toolCallMap.get(chunk.toolCallId);
        entry.toolCallMap.set(chunk.toolCallId, {
          toolCallId: chunk.toolCallId,
          toolName: chunk.toolName,
          status: "executing",
          args: chunk.args,
          result: existing?.result,
        });
        break;
      }
      case "tool-result": {
        const existing = entry.toolCallMap.get(chunk.toolCallId);
        if (existing) {
          entry.toolCallMap.set(chunk.toolCallId, {
            ...existing,
            status: chunk.isError ? "error" : "success",
            result: chunk.result,
          });
        }
        break;
      }
      default:
        break;
    }
  }

  const enqueue = useCallback(
    (factory: StreamSourceFactory, id?: string): string => {
      idCounterRef.current += 1;
      const entryId = id ?? `stream_${Date.now()}_${idCounterRef.current}`;

      const entry: InternalEntry = {
        id: entryId,
        factory,
        controller: null,
        status: "pending",
        textBuffer: "",
        toolCallMap: new Map(),
        toolCallOrder: [],
        error: null,
        runId: 0,
      };
      entriesRef.current.set(entryId, entry);
      orderRef.current.push(entryId);

      if (runningCount() < concurrency) {
        startEntry(entryId);
      } else {
        flush();
      }

      return entryId;
    },
    [concurrency, runningCount, flush]
  );

  const abort = useCallback(
    (id: string) => {
      const entry = entriesRef.current.get(id);
      if (!entry) return;
      entry.controller?.abort();
      if (entry.status === "streaming" || entry.status === "pending") {
        entry.status = "aborted";
        flush();
      }
      stopFlushTimerIfIdle();
      promoteNextPending();
    },
    [flush, stopFlushTimerIfIdle, promoteNextPending]
  );

  const abortAll = useCallback(() => {
    for (const id of orderRef.current) {
      const entry = entriesRef.current.get(id);
      if (entry && (entry.status === "streaming" || entry.status === "pending")) {
        entry.controller?.abort();
        entry.status = "aborted";
      }
    }
    flush();
    stopFlushTimerIfIdle();
  }, [flush, stopFlushTimerIfIdle]);

  useEffect(() => {
    return () => {
      for (const entry of entriesRef.current.values()) {
        entry.controller?.abort();
      }
      if (flushTimerRef.current !== null) clearInterval(flushTimerRef.current);
    };
  }, []);

  const isAnyActive = streams.some((s) => s.status === "streaming" || s.status === "idle");

  return { streams, enqueue, abort, abortAll, isAnyActive };
}
