# streamkit

Rendering and state primitives for streaming LLM UI.

```bash
npm install streamkit
```

---

## What this is

A React library that sits between a streaming LLM response and a production UI. It's not a chat component, a model client, or an agent framework — it's the layer that handles the rendering and state problems so your code can focus on product problems.

```tsx
import { useChatStream, StreamingMarkdown, StreamingCodeBlock, StreamStatus } from "streamkit";
import { fromAnthropic } from "streamkit/adapters/anthropic";

function Chat() {
  const { messages, isStreaming, sendMessage, abort } = useChatStream({
    getAssistantStream: (history) => (signal) => fromAnthropic({ stream: myStream(history, signal) }),
  });

  return (
    <>
      <StreamStatus status={isStreaming ? "streaming" : "idle"} />
      {messages.map((m) =>
        m.role === "user" ? (
          <p key={m.id}>{m.text}</p>
        ) : (
          <StreamingMarkdown
            key={m.id}
            text={m.text}
            isStreaming={isStreaming && m.status === "streaming"}
            showCursor
          />
        )
      )}
      {isStreaming && <button onClick={abort}>Stop</button>}
    </>
  );
}
```

---

## The problems it solves

### 1. Full-document re-parsing on every token

A naive streaming markdown implementation calls `marked(text)` and re-injects the full HTML on every chunk. Earlier paragraphs — which haven't changed — get diffed and potentially re-rendered on every token.

`StreamingMarkdown` re-lexes the text into block-level tokens on every update (cheap), but renders each token in its own memoized subcomponent keyed on raw content. React skips re-rendering a block whose text hasn't changed since the last update — only the currently-growing trailing block re-renders per chunk. Verified: the DOM node reference for a sealed block is the same object before and after a new block arrives.

### 2. XSS from unsanitized rendered markdown

LLM output that passes through tool results, retrieved documents, or prompt injection can carry `<script>` tags, `onerror` attributes, and `javascript:` links. Both `StreamingMarkdown` and `StreamingCodeBlock` sanitize through DOMPurify with an explicit allowlist immediately before `dangerouslySetInnerHTML`. Sanitizing at the rendering boundary — not at the data layer — means it can't be bypassed by a caller forgetting to do it upstream.

### 3. No good state model for tool calls

A model's streamed response is interleaved text and tool calls — not "text, then maybe a single tool call." `useChatStream` handles a full `message_list` reducer with interleaved text and tool-call chunks in the same stream. `useToolCallState` owns execution lifecycle separately from stream consumption: a tool call can outlive the stream that requested it, and needs idempotency guarantees that text deltas don't. Registering the same `toolCallId` twice is a safe no-op.

### 4. Per-stream render thrash under concurrent streams

React 18's automatic batching coalesces `setState` calls within the same synchronous callback — but not across separate macrotask callbacks. N independent `setInterval` timers firing a few milliseconds apart still cause N separate render passes. `useStreamQueue` runs all active streams under a shared 30fps flush tick so simultaneous updates produce one render pass regardless of how many streams are active.

### 5. The inline-factory footgun

The obvious way to pass a stream source to a hook is as a prop: `useStream(() => adapter(response, signal))`. The problem: that arrow function gets a new identity on every render, and a hook that re-runs on factory identity change triggers an infinite restart loop. `useTokenStream` separates the re-run trigger (`streamKey`) from the factory reference, so inline closures are safe and the re-run is controlled explicitly.

### 6. Vendor lock-in at the rendering layer

Building streaming UI directly against the Vercel AI SDK's `TextStreamPart` shape means touching component code when switching providers. Every hook and component in streamkit only sees `StreamChunk` — a single type owned by this library. The three adapters do real translation work:

- **Vercel AI SDK v6**: `text-delta` uses `.text` (not `.textDelta` — a field renamed mid-v5 that broke a lot of code). Tool calls arrive as a complete `tool-call` event with parsed `input`; the adapter emits a synthetic start+ready pair so the tool-call state machine sees a consistent sequence.
- **Anthropic**: Tool arguments arrive as `input_json_delta` events keyed by content-block `index` (not by a stable id). The adapter tracks a `Map<index, BlockTracker>` and defers `JSON.parse()` until `content_block_stop` fires, because individual delta fragments can split a JSON token at arbitrary byte boundaries.
- **OpenAI**: Same accumulate-then-parse pattern as Anthropic, via `delta.tool_calls[].function.arguments` fragments keyed by tool call `index`. Flushes all accumulated calls on `finish_reason === "tool_calls"`.

---

## Primitives

### Hooks

| Hook | What it does |
|------|--------------|
| `useTokenStream` | Consumes a `StreamSource`. Backpressure-safe (~30fps flush), abort-correct, tool-call-tracking. |
| `useToolCallState` | Registry of tool implementations. Manages execution lifecycle, idempotency, abort-on-unmount. |
| `useChatStream` | Multi-turn message-list reducer. Composes the above two. |
| `useStreamQueue` | N concurrent streams under a shared flush tick, with optional concurrency cap and admission control. |
| `createResumableStream` | Wraps a factory with retry/resume: exponential backoff, abort-awareness, `textSoFar` accumulation. |

### Components

| Component | What it does |
|-----------|--------------|
| `StreamingMarkdown` | Incremental markdown without per-chunk full re-render. Block-sealed memoization, DOMPurify sanitization. |
| `StreamingCodeBlock` | Debounced syntax highlighting (highlight.js). Tolerates incomplete code. Copy button. |
| `StreamStatus` | Lifecycle indicator (`idle → streaming → done/error/aborted`). Headless-capable via render prop. |

### Adapters (subpath imports)

```typescript
import { fromVercelAISDK } from "streamkit/adapters/vercel-ai-sdk";
import { fromAnthropic }    from "streamkit/adapters/anthropic";
import { fromOpenAI }       from "streamkit/adapters/openai";
```

---

## Design decisions documented in the codebase

Every non-obvious design decision is commented at the call site with the problem it solves and the alternative it rejects. Some of the ones worth reading:

**`useTokenStream` — `streamKey` vs factory identity** (`src/hooks/useTokenStream.ts`): why depending on `factory` identity for re-runs causes infinite loops, and why `streamKey` is the right primitive.

**`StreamingMarkdown` — block-sealed memoization** (`src/components/StreamingMarkdown.tsx`): why re-lexing is cheap while re-rendering is expensive, and how the memo comparator's `token.raw` check does the actual work.

**`createResumableStream` — deferred error chunk emission** (`src/hooks/createResumableStream.ts`): why yielding an error chunk before deciding whether to retry was a bug — it would flip a consuming hook to `"error"` status even for transient errors that are about to be successfully retried.

**Anthropic adapter — JSON accumulation** (`src/adapters/anthropic.ts`): why `partial_json` fragments can't be parsed individually and why deferring to `content_block_stop` is the only safe approach.

---

## Test suite

94 tests across 11 files. Each test exercises a specific claim:

- `StreamingMarkdown` verifies DOM node object identity for sealed blocks (React actually skips the render, not just "produces equal output")
- `useTokenStream` verifies that an inline factory with a new identity every render does **not** cause infinite restarts
- `createResumableStream` verifies that successfully-retried errors never leak an error chunk to the consumer
- `useStreamQueue` verifies that a stream's factory is never called when the concurrency cap is full (actual admission control, not rendering)
- All three adapters verify against real types from installed SDK packages, not from memory or docs

```bash
npm test           # run all 94 tests
npm test:coverage  # with v8 coverage report
```

---

## Running the example app

```bash
cd examples/next-app
cp .env.local.example .env.local
# Add your ANTHROPIC_API_KEY to .env.local
npm install && npm run dev
```

The example app wires `useChatStream` to a real Anthropic streaming endpoint via an ndjson protocol (no vendor SDK on the client side — just the custom backend adapter pattern from the docs).

---

## Running Storybook

```bash
npm run storybook
```

Interactive stories for `StreamStatus`, `StreamingMarkdown`, `StreamingCodeBlock`, `useTokenStream`, and `useChatStream` — each with live-typing simulations, controls, and documentation.

---

## Building

```bash
npm run build   # ESM + CJS + .d.ts to dist/
npm run typecheck
```

Dual ESM/CJS output with proper subpath exports for the adapter packages (`streamkit/adapters/anthropic`, etc.) and `"types"` condition first in all exports map entries.

---

## License

MIT
