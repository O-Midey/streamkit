# OpenAI adapter

Translates an OpenAI streaming chat completion into a `StreamChunk` sequence.

## Import

```typescript
import { fromOpenAI } from "streamkit-ui/adapters/openai";
// or (includes all adapters):
import { fromOpenAI } from "streamkit-ui";
```

## Usage

```typescript
import OpenAI from "openai";
import { fromOpenAI } from "streamkit-ui/adapters/openai";

const client = new OpenAI();

const stream = await client.chat.completions.create({
  model: "gpt-4o",
  max_tokens: 1024,
  messages: [{ role: "user", content: "Hello" }],
  stream: true,
});

const source = fromOpenAI({ stream });

for await (const chunk of source) {
  console.log(chunk);
}
```

The OpenAI SDK's stream object already implements `AsyncIterable<ChatCompletionChunk>`, so it satisfies the adapter's input type directly.

## Translation notes

### Tool call arguments: accumulate, then parse

Each `ChatCompletionChunk` can carry a `delta.tool_calls` array. The first chunk for a given tool-call **index** includes the `id` and `function.name`; subsequent chunks carry only partial `function.arguments` JSON fragments — and a fragment can split a JSON token at an arbitrary byte boundary, so it isn't safely parseable on its own.

The adapter tracks per-index state in a `Map`, emits `tool-call-start` as soon as `id` + `name` are seen, accumulates argument fragments, and emits `tool-call-ready` (with the fully parsed args) when `finish_reason === "tool_calls"` flushes them. If the accumulated JSON is malformed, it emits a `tool-result` with `isError: true` rather than throwing.

### No explicit "done" event

OpenAI signals completion via a chunk whose `finish_reason` is non-null (`"stop"`, `"tool_calls"`, …). The adapter emits streamkit's `done` on the first non-null `finish_reason`.

### Only the first choice

`n > 1` (multiple choices) isn't supported — the adapter processes only choice `index 0` per chunk, which covers the overwhelming majority of usage. Multiple simultaneous completions are a different use case, better served by [`useStreamQueue`](/hooks/useStreamQueue).

### Verified against the installed SDK

The chunk shape this adapter reads is typed against the installed `openai` package's type definitions, not documentation.
