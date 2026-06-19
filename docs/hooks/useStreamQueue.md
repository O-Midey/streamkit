# useStreamQueue

Runs **multiple** `StreamSource`s concurrently — up to an optional concurrency cap — and exposes their combined state as a single list. Built for the dynamic case: an unknown number of streams enqueued over time (e.g. a model emits 5 parallel tool calls, each of which itself streams output), where you need one list-shaped view plus admission control.

## Signature

```typescript
function useStreamQueue(
  options?: UseStreamQueueOptions
): UseStreamQueueResult
```

## Options

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `concurrency` | `number` | `Infinity` | Max streams running at once. Extras wait in `pending` until a slot frees. Set this against a rate-limited backend. |
| `onChunk` | `(id: string, chunk: StreamChunk) => void` | — | Raw chunk callback, per stream. |
| `onDone` | `(id: string, finalText: string) => void` | — | Fired when a stream completes. |
| `onError` | `(id: string, error: Error) => void` | — | Fired when a stream errors. |

## Return value

| Field | Type | Description |
|-------|------|-------------|
| `streams` | `QueuedStreamState[]` | All tracked streams, in enqueue order. |
| `enqueue` | `(factory: StreamSourceFactory, id?: string) => string` | Add a stream; returns its id (auto-generated if omitted). |
| `abort` | `(id: string) => void` | Abort one stream by id. |
| `abortAll` | `() => void` | Abort every running/pending stream. |
| `isAnyActive` | `boolean` | True if any stream is still streaming or pending. |

Each `QueuedStreamState` is `{ id, text, toolCalls, status, error }`.

## Key design decisions

- **Why not just call `useTokenStream` N times?** For 2–3 fixed streams, do that — it's simpler. This hook is for the *dynamic* case: a variable number of streams enqueued at runtime, needing one list view and admission control.
- **Shared flush tick.** Each stream buffers incoming text outside React state; all entries flush together on **one** shared ~30fps interval. React 18 batches `setState` only within the same callback — N independent per-stream timers firing milliseconds apart still cause N render passes. One shared tick coalesces them into a single re-render.
- **Admission control is a real scheduler decision.** With `concurrency` set, entries beyond the limit sit in `pending` and their factory **isn't invoked** until a slot frees up. This bounds how many in-flight requests hit the backend, not just how many render.

## Example

```tsx
import { useStreamQueue } from "streamkit";

function ParallelStreams() {
  const { streams, enqueue, abortAll, isAnyActive } = useStreamQueue({
    concurrency: 3, // at most 3 in flight; the rest wait
  });

  const runBatch = () => {
    for (let i = 0; i < 10; i++) {
      enqueue((signal) => makeStream(i, signal));
    }
  };

  return (
    <>
      <button onClick={runBatch}>Run 10 streams</button>
      {isAnyActive && <button onClick={abortAll}>Abort all</button>}
      {streams.map((s) => (
        <div key={s.id}>
          <code>{s.status}</code> {s.text}
        </div>
      ))}
    </>
  );
}
```
