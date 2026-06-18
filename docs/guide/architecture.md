# Architecture

## The central abstraction: StreamChunk

Every piece of streamkit — hooks, components, adapters — is built on one type:

```typescript
type StreamChunk =
  | { type: "text"; delta: string }
  | { type: "tool-call-start"; toolCallId: string; toolName: string }
  | { type: "tool-call-delta"; toolCallId: string; argsDelta: string }
  | { type: "tool-call-ready"; toolCallId: string; toolName: string; args: unknown }
  | { type: "tool-result"; toolCallId: string; result: unknown; isError?: boolean }
  | { type: "done"; finishReason?: string }
  | { type: "error"; error: Error };
```

Hooks and components only ever receive `StreamChunk`. They never import from `@anthropic-ai/sdk`, `openai`, or `ai`. This is the line that makes the adapter pattern real rather than decorative.

## StreamSource and StreamSourceFactory

```typescript
type StreamSource = AsyncIterable<StreamChunk>;
type StreamSourceFactory = (signal: AbortSignal) => StreamSource | Promise<StreamSource>;
```

`StreamSourceFactory` receives an `AbortSignal` so the hook can cancel an in-flight request (on unmount, on restart, on `abort()`). Every adapter returns a `StreamSource`. The factory pattern — rather than passing the source directly — lets the hook *create* a new source on demand (for retries, for `restart()`, for `streamKey`-driven re-runs) rather than consuming a source that was already created before the hook knew it needed to be aborted.

## Adapter layer

Adapters translate vendor-specific stream shapes into `StreamChunk` sequences. The translation is non-trivial for each vendor:

**Vercel AI SDK v6** (`fullStream`): text arrives as `{ type: "text-delta", text }` (not `textDelta`; the field was renamed). Tool calls arrive as a single complete `tool-call` event with parsed `input` — the adapter emits a synthetic `tool-call-start` followed immediately by `tool-call-ready`, since v6's fullStream doesn't expose a partial-args streaming phase.

**Anthropic** (raw Messages API): text and tool-use content are interleaved as indexed content blocks. A `tool_use` block's `content_block_start` arrives with empty `input: {}`; arguments come in as `input_json_delta` events keyed by block `index`. The adapter maintains a `Map<index, BlockTracker>` and defers parsing until `content_block_stop` fires — safe, because any individual delta might split a JSON token at an arbitrary byte boundary.

**OpenAI** (raw Chat Completions): same split-args problem as Anthropic, but using `delta.tool_calls[].function.arguments` fragments keyed by tool call `index`. A `finish_reason === "tool_calls"` chunk signals that all argument accumulation is complete and it's safe to `JSON.parse()` each buffer.

## Composition model

The hooks compose upward:

```
StreamSourceFactory
    → useTokenStream        (low-level: text accumulation, batched flush, abort)
        → useToolCallState  (execution lifecycle: pending → executing → success/error)
            → useChatStream (high-level: message history, turn sequencing, multi-turn history)

useStreamQueue              (orthogonal: N concurrent streams, shared flush tick, concurrency cap)
createResumableStream       (wrapper: retry policy, textSoFar accumulation across attempts)
```

Components (`StreamingMarkdown`, `StreamingCodeBlock`, `StreamStatus`) don't depend on any hook — they accept plain props (`text: string`, `isStreaming: boolean`) and can be used independently of the hook layer.
