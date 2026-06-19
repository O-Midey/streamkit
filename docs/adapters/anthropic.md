# Anthropic adapter

Translates the Anthropic Messages API raw stream events into `StreamChunk` sequences.

## Import

```typescript
import { fromAnthropic } from "streamkit-ui/adapters/anthropic";
// or (includes all adapters):
import { fromAnthropic } from "streamkit-ui";
```

## Usage

```typescript
import Anthropic from "@anthropic-ai/sdk";
import { fromAnthropic } from "streamkit-ui/adapters/anthropic";

const client = new Anthropic();

const stream = await client.messages.create({
  model: "claude-opus-4-6",
  max_tokens: 1024,
  messages: [{ role: "user", content: "Hello" }],
  stream: true,
});

const source = fromAnthropic({ stream });

for await (const chunk of source) {
  console.log(chunk);
}
```

## Translation notes

### Tool call arguments

Anthropic's API streams tool-use arguments as `input_json_delta` events, each carrying a partial JSON string fragment (`partial_json`). Individual fragments are not safely parseable — a fragment can split a JSON token at an arbitrary byte boundary (e.g. the fragment `"cit` might be followed by `y"`).

The adapter maintains a `Map<index, BlockTracker>` for the duration of the stream. On `content_block_start` for a `tool_use` block, a `tool-call-start` chunk is emitted immediately. `input_json_delta` fragments are accumulated in the tracker's buffer. On `content_block_stop`, the full buffer is `JSON.parse()`d and a `tool-call-ready` chunk is emitted with the complete args.

If the accumulated JSON is malformed (truncated stream, model-emitted invalid JSON), the adapter emits a `tool-result` chunk with `isError: true` rather than throwing, so one bad tool call doesn't abort the entire stream.

### Events not translated

`reasoning-delta`, `thinking-delta`, `signature-delta`, `citations-delta`, `message_start`, `message_delta`, `file`, and all extended server-tool events are silently dropped — streamkit is a text + tool-call rendering layer, not a full reimplementation of every Anthropic API feature.

### Tool results

Tool results do not come back through the assistant-turn stream in the Anthropic Messages API. They are sent by the caller as `tool_result` content blocks in the next user-turn message. This adapter has no `tool-result`-from-execution case — use `useToolCallState` with your own tool implementations to handle execution.
