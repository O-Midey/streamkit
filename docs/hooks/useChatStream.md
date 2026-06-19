# useChatStream

The high-level hook: composes `useTokenStream` + `useToolCallState` into a multi-turn, chat-shaped reducer. Append a user message, stream the assistant's reply (text **interleaved** with tool calls), execute any tool calls that come ready, and track the whole conversation as a `StreamMessage[]` history.

## Signature

```typescript
function useChatStream(
  options: UseChatStreamOptions
): UseChatStreamResult
```

## Options

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `getAssistantStream` | `(history: StreamMessage[]) => StreamSourceFactory` | — | Given the full history (incl. the just-sent user message), return a factory for the assistant's reply. This is where you call an adapter. |
| `tools` | `ToolRegistry` | `{}` | Tool implementations, forwarded to the underlying `useToolCallState`. |
| `onAssistantMessageDone` | `(message: StreamMessage) => void` | — | Called once per assistant message when its stream completes successfully. |
| `onError` | `(error: Error, messageId: string) => void` | — | Called if the assistant's stream errors. |

## Return value

| Field | Type | Description |
|-------|------|-------------|
| `messages` | `StreamMessage[]` | Full conversation, with the active assistant message reflecting live streaming text/status. |
| `isStreaming` | `boolean` | Whether the assistant's current turn is still streaming. |
| `error` | `Error \| null` | Last turn's error, if any. |
| `sendMessage` | `(text: string) => void` | Append a user message and start the assistant reply. |
| `abort` | `() => void` | Abort the in-flight reply. |
| `reset` | `() => void` | Clear all messages and tool state. |

## Key design decisions

- **Interleaved, not "text then tool call."** A model's streamed response interleaves text and tool-call chunks within one response — the model emits some text, starts a tool call, and the next text depends on its result. A single `useTokenStream` run captures the raw interleaved sequence rather than assuming a single trailing tool call.
- **Shared tool state across messages.** One `useToolCallState` instance backs the whole chat (not one per message), so tool calls from different historical messages keep independent lifecycles even after the conversation moves on.
- **`streamKey`-driven turns.** Each `sendMessage` bumps an internal turn counter that becomes `useTokenStream`'s `streamKey`, triggering a fresh run per turn instead of reusing stale closures. (See [`useTokenStream`](/hooks/useTokenStream) for why `streamKey` exists instead of relying on factory identity.)

## Example

```tsx
import { useChatStream, StreamingMarkdown, StreamStatus } from "streamkit";
import { fromAnthropic } from "streamkit/adapters/anthropic";

function Chat() {
  const { messages, isStreaming, sendMessage, abort } = useChatStream({
    getAssistantStream: (history) => (signal) =>
      fromAnthropic({ stream: callAnthropic(history, signal) }),
    tools: {
      search: async ({ query }: { query: string }) => fetchSearch(query),
    },
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
          />
        ),
      )}
      {isStreaming && <button onClick={abort}>Stop</button>}
    </>
  );
}
```
