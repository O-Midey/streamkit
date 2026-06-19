# Quick start

## 1. Create a streaming backend (Next.js App Router)

```typescript
// app/api/chat/route.ts
import Anthropic from "@anthropic-ai/sdk";
import { fromAnthropic } from "streamkit-ui/adapters/anthropic";

const client = new Anthropic();

export async function POST(req: Request) {
  const { messages } = await req.json();

  const stream = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    messages,
    stream: true,
  });

  const encoder = new TextEncoder();
  const source = fromAnthropic({ stream });

  return new Response(
    new ReadableStream({
      async start(controller) {
        for await (const chunk of source) {
          controller.enqueue(encoder.encode(JSON.stringify(chunk) + "\n"));
        }
        controller.close();
      },
    }),
    { headers: { "Content-Type": "application/x-ndjson" } }
  );
}
```

## 2. Parse the ndjson stream on the client

```typescript
// lib/stream-factory.ts
import type { StreamChunk, StreamSourceFactory } from "streamkit-ui";

export function chatFactory(messages: { role: string; text: string }[]): StreamSourceFactory {
  return async function* (signal) {
    const res = await fetch("/api/chat", {
      method: "POST",
      body: JSON.stringify({ messages }),
      signal,
    });
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (line.trim()) yield JSON.parse(line) as StreamChunk;
      }
    }
  };
}
```

## 3. Wire it to the UI

```tsx
// components/Chat.tsx
"use client";
import { useRef } from "react";
import { useChatStream, StreamingMarkdown, StreamStatus } from "streamkit-ui";
import { chatFactory } from "@/lib/stream-factory";
import type { StreamMessage } from "streamkit-ui";

export function Chat() {
  const inputRef = useRef<HTMLInputElement>(null);
  const { messages, isStreaming, sendMessage, abort } = useChatStream({
    getAssistantStream: (history: StreamMessage[]) =>
      chatFactory(
        history
          .filter((m) => m.role === "user")
          .map((m) => ({ role: m.role, text: m.text }))
      ),
  });

  return (
    <div>
      <StreamStatus status={isStreaming ? "streaming" : "idle"} />

      {messages.map((m) => (
        <div key={m.id}>
          {m.role === "user" ? (
            <p>{m.text}</p>
          ) : (
            <StreamingMarkdown
              text={m.text}
              isStreaming={isStreaming && m.status === "streaming"}
              showCursor
            />
          )}
        </div>
      ))}

      <input ref={inputRef} onKeyDown={(e) => {
        if (e.key === "Enter" && !isStreaming) {
          sendMessage(inputRef.current!.value);
          inputRef.current!.value = "";
        }
      }} />

      {isStreaming && <button onClick={abort}>Stop</button>}
    </div>
  );
}
```

That's the full integration: Anthropic SDK → `fromAnthropic` adapter → ndjson → client factory → `useChatStream` → `StreamingMarkdown`. The primitives are independent — swap the adapter, change the backend protocol, or use `useTokenStream` directly instead of `useChatStream` without touching anything else.
