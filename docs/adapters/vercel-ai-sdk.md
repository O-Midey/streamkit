# Vercel AI SDK adapter

Translates a Vercel AI SDK v6 `streamText()` result's `fullStream` into a `StreamChunk` sequence.

## Import

```typescript
import { fromVercelAISDK } from "streamkit/adapters/vercel-ai-sdk";
// or (includes all adapters):
import { fromVercelAISDK } from "streamkit";
```

## Usage

```typescript
import { streamText } from "ai";
import { openai } from "@ai-sdk/openai";
import { fromVercelAISDK } from "streamkit/adapters/vercel-ai-sdk";

const result = streamText({
  model: openai("gpt-4o"),
  messages: [{ role: "user", content: "Hello" }],
});

const source = fromVercelAISDK({ fullStream: result.fullStream });

for await (const chunk of source) {
  console.log(chunk);
}
```

> Pass `result.fullStream` (not `result.textStream`) — the full stream is what carries tool-call and finish parts, not just text deltas.

## Translation notes

### `text-delta` uses `.text`, not `.textDelta`

The field was renamed mid-v5 and broke a lot of scattered examples. This adapter reads `.text` and is verified against the installed `ai@6.x` type definitions — not documentation. If you're on a different major version, pin the adapter's chunk shape against your installed `ai` version.

### Tool calls: one complete `tool-call` part

Vercel's `fullStream` emits a single, already-parsed `tool-call` part (with `input` fully resolved) rather than a start/delta/ready sequence — there's no meaningfully-parseable "args still streaming" phase at this level. The adapter emits **both** a synthetic `tool-call-start` and an immediate `tool-call-ready` per Vercel `tool-call`, so streamkit's tool-call state machine (which expects a start before a ready) sees a consistent sequence, just with an instantaneous pending phase.

### Tool results and errors

- `tool-result` → streamkit `tool-result`.
- `tool-error` → streamkit `tool-result` with `isError: true` (streamkit has no separate tool-error chunk — failure is a result variant).

### Terminal events

- `finish` → `done` (carrying `finishReason`).
- `abort` (an SDK-side stop condition, distinct from the consumer's `AbortController`) → `done` with `finishReason: "aborted"`.
- a top-level `error` part → streamkit `error`.

### Events not translated

`reasoning-*`, `source`, `file`, `start`, `start-step`, `finish-step`, `tool-input-start/delta/end`, `raw`, `tool-output-denied`, and `tool-approval-request` are silently dropped — streamkit renders text + tool calls, not every SDK feature.
