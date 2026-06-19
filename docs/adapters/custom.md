# Custom backend

If you're not using the Vercel AI SDK, Anthropic SDK, or OpenAI SDK directly, you can write a `StreamSourceFactory` that parses whatever protocol your backend speaks.

## ndjson (recommended)

The example app uses newline-delimited JSON: the server serializes `StreamChunk` objects as JSON lines, the client parses them back.

```typescript
// Shared type — your server serializes StreamChunk to JSON lines.
// Your client parses them back.
import type { StreamChunk, StreamSourceFactory } from "streamkit-ui";

export function ndjsonFactory(url: string, body: unknown): StreamSourceFactory {
  return async function* (signal) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });

    if (!res.ok || !res.body) {
      yield { type: "error", error: new Error(`HTTP ${res.status}`) };
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const chunk = JSON.parse(line) as StreamChunk;
          // Error.message doesn't survive JSON serialization — reconstruct.
          if (chunk.type === "error") {
            const msg = (chunk.error as any)?.message ?? String(chunk.error);
            yield { type: "error", error: new Error(msg) };
          } else {
            yield chunk;
          }
        } catch {
          // Skip malformed lines
        }
      }
    }
  };
}
```

## Server-sent events (SSE)

```typescript
export function sseFactory(url: string): StreamSourceFactory {
  return async function* (signal) {
    const res = await fetch(url, { signal });
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const events = buf.split("\n\n");
      buf = events.pop() ?? "";

      for (const event of events) {
        const dataLine = event.split("\n").find((l) => l.startsWith("data: "));
        if (!dataLine) continue;
        const data = dataLine.slice(6);
        if (data === "[DONE]") { yield { type: "done" }; return; }
        try {
          yield JSON.parse(data) as StreamChunk;
        } catch { /* skip */ }
      }
    }
  };
}
```

## Writing a factory directly

A `StreamSourceFactory` is any function that takes an `AbortSignal` and returns an `AsyncIterable<StreamChunk>`:

```typescript
const myFactory: StreamSourceFactory = async function* (signal) {
  yield { type: "text", delta: "Hello " };
  await delay(100);
  yield { type: "text", delta: "world!" };
  yield { type: "done" };
};
```
