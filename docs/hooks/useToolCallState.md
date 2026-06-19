# useToolCallState

A registry-backed hook that owns the **execution lifecycle** of tool calls. Given a map of tool implementations, it runs each call as its arguments become ready and tracks `pending → executing → success | error` state for rendering — decoupled from stream consumption, because tool execution has different lifecycle needs than text streaming.

## Signature

```typescript
function useToolCallState(
  options: UseToolCallStateOptions
): UseToolCallStateResult
```

## Options

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `tools` | `ToolRegistry` | — | Map of `toolName → implementation`. Calls for an unregistered name land in `"error"` status. |
| `onCallSettled` | `(call: ToolCallState) => void` | — | Fired whenever a call reaches `"success"` or `"error"`. Useful for sending `tool-result` chunks back upstream. |
| `maxHistory` | `number` | `50` | Max calls retained. Oldest **settled** calls are evicted first once exceeded — never an in-flight one. |

A `ToolImplementation` is `(args, signal) => Promise<result> | result`. It receives an `AbortSignal` so long-running tools can be cancelled on unmount.

## Return value

| Field | Type | Description |
|-------|------|-------------|
| `calls` | `ToolCallState[]` | All tracked calls, in arrival order. |
| `registerCall` | `(chunk: ToolCallReadyChunk) => void` | Register a ready call for execution. Idempotent — re-registering the same `toolCallId` is a no-op. |
| `getCall` | `(toolCallId: string) => ToolCallState \| undefined` | Look up one call's current state. |
| `reset` | `() => void` | Abort all in-flight calls and clear tracked state. |

## Key design decisions

- **Separated from `useTokenStream`.** A stream reports *that* a tool call is ready; this hook decides *what to do about it*. Tool execution can run concurrently, can outlive the stream that requested it (a slow API call after the model stopped talking), and needs idempotency that text deltas don't.
- **Idempotency.** `registerCall` is safe to call multiple times with the same `toolCallId` — only the first registration triggers execution. This makes re-delivery after a reconnect harmless.
- **Eviction never orphans in-flight work.** When over `maxHistory`, eviction skips any call still `pending`/`executing`, so an in-flight execution's eventual state update always has somewhere to land.
- **Abort on unmount.** Every running tool's `AbortController` is aborted when the component unmounts.

## Example

```tsx
import { useToolCallState } from "streamkit-ui";

function ToolPanel() {
  const { calls, registerCall } = useToolCallState({
    tools: {
      search: async ({ query }: { query: string }, signal) => {
        const res = await fetch(`/api/search?q=${query}`, { signal });
        return res.json();
      },
    },
    onCallSettled: (call) => console.log(`${call.toolName} → ${call.status}`),
  });

  // registerCall(readyChunk) is typically driven by a stream's
  // tool-call-ready chunks — see useChatStream, which wires this for you.

  return (
    <ul>
      {calls.map((c) => (
        <li key={c.toolCallId}>
          {c.toolName}: {c.status}
        </li>
      ))}
    </ul>
  );
}
```
