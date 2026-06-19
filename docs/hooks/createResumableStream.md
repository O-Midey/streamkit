# createResumableStream

Wraps a stream-building function with **automatic retry-with-resume-context** on transient failure. It's not a hook — it returns a `StreamSourceFactory` you pass to `useTokenStream` (or any consumer). On a dropped connection it retries with backoff instead of surfacing a hard error, and threads the text accumulated so far into each attempt for backends that support true resumption.

## Signature

```typescript
function createResumableStream(
  options: CreateResumableStreamOptions
): StreamSourceFactory
```

## Options

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `buildFactory` | `(ctx: ResumeContext) => StreamSourceFactory` | — | Build the factory for this attempt. `ctx` is `{ textSoFar, attempt }` (attempt 0 = first try). |
| `shouldRetry` | `(error: Error, attempt: number) => boolean` | retries all except messages matching `/abort/i` | Decide if an error is worth retrying vs. terminal. |
| `maxRetries` | `number` | `2` | Retries after the initial try (so up to 3 total attempts). |
| `retryDelayMs` | `(attempt: number) => number` | `min(500 · 2^(n-1), 4000)` | Delay before each retry (1-indexed). Defaults to capped exponential backoff. |
| `onRetry` | `(error: Error, attempt: number) => void` | — | Called before each retry — useful for telemetry. |

## Honest limits

True mid-stream resumption (continuing generation from an exact token offset after a drop) is **backend-specific** — it needs the provider's API to expose a resume/cursor parameter, which most don't today. This utility does **not** fake that. What it provides is the scaffolding every resumable implementation needs regardless of backend:

1. **Accumulated-text tracking** across attempts, so a resume-capable backend has something to resume from (via `ResumeContext.textSoFar`).
2. **A sensible default retry policy** (exponential backoff, abort-aware) so callers don't hand-roll it badly.
3. **A clean seam** (`buildFactory` receives `ResumeContext`) where resume-capable integrations plug in their real logic.

For backends *without* resume support it still adds value: a single dropped connection becomes an automatic clean retry instead of a hard error — the common, still-valuable case.

## Key design decision: transient errors aren't leaked

A mid-stream `error` chunk is **not** yielded to the consumer immediately — doing so would flip a consuming `useTokenStream` to `"error"` status even though a retry is about to happen and may well succeed. The error reaches the consumer only once retries are exhausted or the error is judged non-retryable.

## Example

```tsx
import { useTokenStream, createResumableStream } from "streamkit-ui";
import { fromOpenAI } from "streamkit-ui/adapters/openai";

const factory = createResumableStream({
  buildFactory: ({ attempt }) => (signal) =>
    fromOpenAI({ stream: callOpenAI({ signal }) }),
  maxRetries: 3,
  onRetry: (err, attempt) => console.warn(`retry ${attempt}:`, err.message),
});

function Resilient() {
  const { text, status } = useTokenStream(factory);
  return <p data-status={status}>{text}</p>;
}
```
