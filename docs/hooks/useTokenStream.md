# useTokenStream

The foundational hook. Consumes a `StreamSource` and exposes accumulated text, tool-call state, and lifecycle status with backpressure-safe batching and abort correctness.

## Signature

```typescript
function useTokenStream(
  factory: StreamSourceFactory,
  options?: UseTokenStreamOptions
): UseTokenStreamResult
```

## Options

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `autoStart` | `boolean` | `true` | Start the stream immediately on mount. Set `false` to call `start()` manually. |
| `streamKey` | `string \| number` | `undefined` | Change this value to restart the stream. See below for why this exists instead of depending on `factory` identity. |
| `onChunk` | `(chunk: StreamChunk) => void` | — | Raw chunk callback fired before internal state is updated. |
| `onDone` | `(finalText: string) => void` | — | Called once when the stream completes. |
| `onError` | `(error: Error) => void` | — | Called once if the stream errors. |

## Return value

| Field | Type | Description |
|-------|------|-------------|
| `text` | `string` | Accumulated text from all `text` chunks so far. |
| `toolCalls` | `ToolCallState[]` | Tool calls in arrival order with their current status. |
| `status` | `StreamStatusValue` | `"idle" \| "streaming" \| "done" \| "error" \| "aborted"` |
| `error` | `Error \| null` | Set if status is `"error"`. |
| `abort` | `() => void` | Abort the in-flight stream. No-op if not streaming. |
| `restart` | `() => void` | Cancel any in-flight stream and start fresh. |
| `start` | `() => void` | Start the stream when `autoStart` is `false`. No-op otherwise. |

## The `streamKey` design decision

`factory` is intentionally **not** a dependency that triggers re-runs. If the hook re-ran whenever the factory's object identity changed, any inline factory closure (`useTokenStream((signal) => adapter(response, signal))`) would trigger an infinite restart loop — a fresh arrow function is created on every render.

Instead, pass a stable `streamKey` that you control:

```tsx
const [messageId, setMessageId] = useState(0);

const { text } = useTokenStream(factory, { streamKey: messageId });

// Later, to start a new stream:
setMessageId((id) => id + 1);
```

## Backpressure batching

Incoming chunks are buffered in a ref and flushed to React state on a ~30fps interval, not per-chunk. This decouples network arrival rate from render rate — a burst of 50 tokens arriving in the same tick produces one render pass, not 50.

## Example

```tsx
import { useTokenStream } from "streamkit-ui";
import { fromAnthropic } from "streamkit-ui/adapters/anthropic";

function StreamingOutput({ stream }: { stream: AsyncIterable<any> }) {
  const factory = useCallback(
    () => fromAnthropic({ stream }),
    [] // factory is stable — stream object identity is fixed for this component's lifetime
  );

  const { text, status, error, abort } = useTokenStream(factory);

  if (error) return <p>Error: {error.message}</p>;

  return (
    <div>
      <p>{text}</p>
      {status === "streaming" && <button onClick={abort}>Stop</button>}
    </div>
  );
}
```
