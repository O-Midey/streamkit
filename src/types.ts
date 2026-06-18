/**
 * Core types shared across streamkit's hooks and components.
 *
 * Design note: the library never assumes a specific vendor's wire format.
 * Adapters (src/adapters/*) translate vendor-specific stream shapes into
 * these types. Everything in hooks/ and components/ only ever sees
 * `StreamChunk` and `StreamSource` — this is what makes the library
 * vendor-agnostic rather than "Vercel AI SDK with extra steps."
 */

/** Lifecycle status for a single stream. */
export type StreamStatusValue = "idle" | "streaming" | "done" | "error" | "aborted";

/** A text chunk — the most common case, plain token/text delta. */
export interface TextChunk {
  type: "text";
  delta: string;
}

/** A tool call has started. Emitted once per call, before arguments arrive. */
export interface ToolCallStartChunk {
  type: "tool-call-start";
  toolCallId: string;
  toolName: string;
}

/** Incremental arguments for a tool call (JSON being streamed in pieces). */
export interface ToolCallDeltaChunk {
  type: "tool-call-delta";
  toolCallId: string;
  argsDelta: string;
}

/** A tool call's arguments are fully streamed and ready to execute. */
export interface ToolCallReadyChunk {
  type: "tool-call-ready";
  toolCallId: string;
  toolName: string;
  args: unknown;
}

/** The result of executing a tool call (supplied by the consumer, not the model). */
export interface ToolResultChunk {
  type: "tool-result";
  toolCallId: string;
  result: unknown;
  isError?: boolean;
}

/** Terminal chunk signaling the stream is complete, with optional metadata. */
export interface DoneChunk {
  type: "done";
  finishReason?: string;
}

/** Terminal chunk signaling an error occurred mid-stream. */
export interface ErrorChunk {
  type: "error";
  error: Error;
}

export type StreamChunk =
  | TextChunk
  | ToolCallStartChunk
  | ToolCallDeltaChunk
  | ToolCallReadyChunk
  | ToolResultChunk
  | DoneChunk
  | ErrorChunk;

/**
 * The normalized shape every adapter must produce: an async iterable of
 * StreamChunk. This is intentionally the lowest common denominator —
 * AsyncIterable is satisfied by ReadableStreams (via a helper), generators,
 * and most SDK stream objects already implement it or are trivially wrapped.
 */
export type StreamSource = AsyncIterable<StreamChunk>;

/** A factory function so hooks can (re)create the stream on demand, e.g. for retries. */
export type StreamSourceFactory = (signal: AbortSignal) => StreamSource | Promise<StreamSource>;

export interface ToolCallState {
  toolCallId: string;
  toolName: string;
  status: "pending" | "executing" | "success" | "error";
  args?: unknown;
  result?: unknown;
  error?: Error;
}

/** A single message in a chat-style conversation, as assembled by useChatStream. */
export interface StreamMessage {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  toolCalls: ToolCallState[];
  status: StreamStatusValue;
}
