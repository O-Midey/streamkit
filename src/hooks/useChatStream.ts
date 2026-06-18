import { useCallback, useMemo, useRef, useState } from "react";
import { useTokenStream } from "./useTokenStream";
import { useToolCallState, type ToolRegistry } from "./useToolCallState";
import type {
  StreamChunk,
  StreamMessage,
  StreamSource,
  StreamSourceFactory,
  ToolCallReadyChunk,
} from "../types";

export interface UseChatStreamOptions {
  /** Tool implementations available for this chat. Forwarded to the underlying useToolCallState. */
  tools?: ToolRegistry;
  /**
   * Given the full message history (including the just-appended user
   * message), produce a StreamSourceFactory for the assistant's reply.
   * This is the integration point with whatever backend/SDK you're using —
   * typically you'd call an adapter here (see src/adapters/*).
   */
  getAssistantStream: (history: StreamMessage[]) => StreamSourceFactory;
  /** Called once per assistant message when its stream completes successfully. */
  onAssistantMessageDone?: (message: StreamMessage) => void;
  onError?: (error: Error, messageId: string) => void;
}

export interface UseChatStreamResult {
  messages: StreamMessage[];
  /** Whether the assistant's current turn is still streaming. */
  isStreaming: boolean;
  error: Error | null;
  /** Append a user message and kick off the assistant's reply stream. */
  sendMessage: (text: string) => void;
  /** Abort the assistant's in-flight reply, if any. */
  abort: () => void;
  /** Clear all messages and reset to a fresh conversation. */
  reset: () => void;
}

let idCounter = 0;
function generateId(prefix: string): string {
  idCounter += 1;
  return `${prefix}_${Date.now()}_${idCounter}`;
}

/**
 * Composes useTokenStream + useToolCallState into a chat-shaped reducer:
 * append a user message, stream the assistant's reply (text interleaved
 * with tool calls), execute any tool calls that come ready, and track the
 * whole thing as a StreamMessage[] history.
 *
 * THE REAL PROBLEM THIS SOLVES: a model's streamed response is not "text,
 * then maybe a tool call." In practice (Anthropic, OpenAI, and the Vercel
 * AI SDK all do this) text and tool-call chunks interleave within a single
 * response — the model can emit some text, start a tool call, and the
 * *next* turn's text depends on that tool's result. Most hand-rolled chat
 * UIs either ignore this (rendering tool calls as an afterthought after all
 * text) or hard-code a single-tool-call assumption. Here, a single
 * useTokenStream run captures the raw interleaved chunk sequence, and a
 * useToolCallState instance (shared across the whole chat, not per-message)
 * owns execution — letting tool calls across different historical messages
 * keep independent lifecycles even if the conversation has moved on.
 *
 * STREAM-KEY DRIVEN TURNS: each call to sendMessage increments an internal
 * turn counter, which becomes useTokenStream's streamKey. This is what
 * triggers useTokenStream to start a fresh run per turn rather than reusing
 * stale closures — see useTokenStream's own docs for why streamKey exists
 * instead of relying on factory identity.
 */
export function useChatStream(options: UseChatStreamOptions): UseChatStreamResult {
  const { tools = {}, getAssistantStream, onAssistantMessageDone, onError } = options;

  const [messages, setMessages] = useState<StreamMessage[]>([]);
  const [turn, setTurn] = useState(0);
  const [globalError, setGlobalError] = useState<Error | null>(null);

  const activeAssistantIdRef = useRef<string | null>(null);
  const historyRef = useRef<StreamMessage[]>([]);
  historyRef.current = messages;

  const getAssistantStreamRef = useRef(getAssistantStream);
  const onAssistantMessageDoneRef = useRef(onAssistantMessageDone);
  const onErrorRef = useRef(onError);
  getAssistantStreamRef.current = getAssistantStream;
  onAssistantMessageDoneRef.current = onAssistantMessageDone;
  onErrorRef.current = onError;

  const toolCallState = useToolCallState({
    tools,
    onCallSettled: (call) => {
      // Reflect settled tool results back onto the message that owns this call.
      setMessages((prev) =>
        prev.map((m) =>
          m.id === activeAssistantIdRef.current
            ? { ...m, toolCalls: m.toolCalls.map((tc) => (tc.toolCallId === call.toolCallId ? call : tc)) }
            : m
        )
      );
    },
  });
  const registerToolCall = toolCallState.registerCall;

  const factory: StreamSourceFactory = useCallback(
    (signal) => {
      // historyRef is current as of when the effect actually runs (post the
      // setMessages call in sendMessage), since React flushes state before
      // effects run for the next render.
      return getAssistantStreamRef.current(historyRef.current)(signal);
    },
    []
  );

  const handleChunk = useCallback(
    (chunk: StreamChunk) => {
      if (chunk.type === "tool-call-ready") {
        registerToolCall(chunk as ToolCallReadyChunk);
        // Seed the message's toolCalls array immediately with a pending
        // entry so the UI can render it before useToolCallState's own
        // state has propagated back via onCallSettled.
        setMessages((prev) =>
          prev.map((m) =>
            m.id === activeAssistantIdRef.current && !m.toolCalls.some((tc) => tc.toolCallId === chunk.toolCallId)
              ? {
                  ...m,
                  toolCalls: [
                    ...m.toolCalls,
                    { toolCallId: chunk.toolCallId, toolName: chunk.toolName, status: "pending" as const, args: chunk.args },
                  ],
                }
              : m
          )
        );
      }
    },
    [registerToolCall]
  );

  const handleDone = useCallback(
    (finalText: string) => {
      const id = activeAssistantIdRef.current;
      if (!id) return;
      setMessages((prev) =>
        prev.map((m) => (m.id === id ? { ...m, text: finalText, status: "done" as const } : m))
      );
      const finalMessage = historyRef.current.find((m) => m.id === id);
      if (finalMessage) {
        onAssistantMessageDoneRef.current?.({ ...finalMessage, text: finalText, status: "done" });
      }
    },
    []
  );

  const handleError = useCallback((err: Error) => {
    const id = activeAssistantIdRef.current;
    setGlobalError(err);
    if (id) {
      setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, status: "error" as const } : m)));
      onErrorRef.current?.(err, id);
    }
  }, []);

  const stream = useTokenStream(factory, {
    // autoStart is gated on turn > 0 rather than a hardcoded false: turn=0
    // means no message has been sent yet (nothing should stream on mount),
    // but every sendMessage() call bumps turn, and since turn IS streamKey,
    // the effect inside useTokenStream re-fires on that same change and
    // reads this freshly-evaluated autoStart value — so the stream actually
    // starts. A hardcoded `false` here would mean the assistant's reply
    // never streams at all, since nothing else ever calls start().
    autoStart: turn > 0,
    streamKey: turn,
    onChunk: handleChunk,
    onDone: handleDone,
    onError: handleError,
  });

  // Sync the live streaming text/status onto the active assistant message
  // as it updates. This intentionally runs as a side-effect-free derivation
  // rather than its own useEffect, keeping it in lockstep with the render
  // that already has the latest `stream.text` — avoiding an extra render tick.
  const messagesWithLiveStream = useMemo(() => {
    const id = activeAssistantIdRef.current;
    if (!id || stream.status === "idle") return messages;
    return messages.map((m) =>
      m.id === id
        ? { ...m, text: stream.text, status: stream.status, toolCalls: m.toolCalls }
        : m
    );
  }, [messages, stream.text, stream.status]);

  const sendMessage = useCallback(
    (text: string) => {
      const userMessage: StreamMessage = {
        id: generateId("user"),
        role: "user",
        text,
        toolCalls: [],
        status: "done",
      };
      const assistantMessage: StreamMessage = {
        id: generateId("assistant"),
        role: "assistant",
        text: "",
        toolCalls: [],
        status: "idle",
      };
      activeAssistantIdRef.current = assistantMessage.id;
      setGlobalError(null);
      setMessages((prev) => [...prev, userMessage, assistantMessage]);
      // historyRef won't reflect the new messages until after this render
      // commits, but factory() reads historyRef.current lazily inside the
      // async stream-start, which runs after the state update has flushed —
      // so by the time getAssistantStream is actually invoked, history is current.
      setTurn((t) => t + 1);
    },
    []
  );

  const abort = useCallback(() => {
    stream.abort();
  }, [stream]);

  const reset = useCallback(() => {
    stream.abort();
    toolCallState.reset();
    activeAssistantIdRef.current = null;
    setMessages([]);
    setGlobalError(null);
  }, [stream, toolCallState]);

  return {
    messages: messagesWithLiveStream,
    isStreaming: stream.status === "streaming",
    error: globalError,
    sendMessage,
    abort,
    reset,
  };
}

/** Re-exported for convenience so consumers building custom adapters don't need a second import. */
export type { StreamSource };
