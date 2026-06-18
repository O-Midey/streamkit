import { describe, it, expect } from "vitest";
import { fromAnthropic } from "../src/adapters/anthropic";
import type { StreamChunk } from "../src/types";

async function collect(source: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const out: StreamChunk[] = [];
  for await (const c of source) out.push(c);
  return out;
}

// Fixtures mirror the REAL shape from @anthropic-ai/sdk@0.104.2:
// RawMessageStreamEvent = RawMessageStartEvent | RawMessageDeltaEvent |
//   RawMessageStopEvent | RawContentBlockStartEvent |
//   RawContentBlockDeltaEvent | RawContentBlockStopEvent
// TextDelta uses `text` field + type "text_delta"
// InputJSONDelta uses `partial_json` field + type "input_json_delta"
// ToolUseBlock uses `id`, `name` fields (NOT `toolCallId`, `toolName`)

async function* textOnlyStream() {
  yield { type: "message_start", message: { id: "msg_1", model: "claude-opus-4-6" } };
  yield { type: "content_block_start", index: 0, content_block: { type: "text" } };
  yield { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello, " } };
  yield { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "world!" } };
  yield { type: "content_block_stop", index: 0 };
  yield { type: "message_delta", delta: { stop_reason: "end_turn" } };
  yield { type: "message_stop" };
}

async function* toolCallStream() {
  yield { type: "message_start", message: { id: "msg_2" } };
  yield { type: "content_block_start", index: 0, content_block: { type: "text" } };
  yield { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Let me check." } };
  yield { type: "content_block_stop", index: 0 };
  // Tool use block — id/name arrive with content_block_start,
  // but input is empty {}; args stream in as partial_json deltas
  yield { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "toolu_abc", name: "get_weather", input: {} } };
  // JSON args split across THREE deltas (the common real-world pattern —
  // Anthropic's SSE splits tool input JSON at arbitrary byte boundaries)
  yield { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"city"' } };
  yield { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: ': "La' } };
  yield { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: 'gos"}' } };
  yield { type: "content_block_stop", index: 1 };
  yield { type: "message_stop" };
}

async function* thinkingBlockStream() {
  yield { type: "message_start", message: { id: "msg_3" } };
  // Thinking block at index 0 — should be silently ignored
  yield { type: "content_block_start", index: 0, content_block: { type: "thinking" } };
  yield { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "let me reason" } };
  yield { type: "content_block_stop", index: 0 };
  // Real content at index 1
  yield { type: "content_block_start", index: 1, content_block: { type: "text" } };
  yield { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "Here is my answer." } };
  yield { type: "content_block_stop", index: 1 };
  yield { type: "message_stop" };
}

describe("fromAnthropic adapter", () => {
  it("translates text_delta events using the `text` field into streamkit text chunks", async () => {
    const chunks = await collect(fromAnthropic({ stream: textOnlyStream() as any }));
    const textChunks = chunks.filter((c) => c.type === "text") as { type: "text"; delta: string }[];
    expect(textChunks.map((c) => c.delta)).toEqual(["Hello, ", "world!"]);
  });

  it("emits a done chunk on message_stop and stops", async () => {
    const chunks = await collect(fromAnthropic({ stream: textOnlyStream() as any }));
    expect(chunks[chunks.length - 1]).toEqual({ type: "done" });
    // Nothing after message_stop
    expect(chunks.filter((c) => c.type === "done")).toHaveLength(1);
  });

  it("emits tool-call-start immediately when tool_use content_block_start arrives (before any args)", async () => {
    const chunks = await collect(fromAnthropic({ stream: toolCallStream() as any }));
    const start = chunks.find((c) => c.type === "tool-call-start");
    expect(start).toMatchObject({ type: "tool-call-start", toolCallId: "toolu_abc", toolName: "get_weather" });
  });

  it("accumulates split input_json_delta fragments and emits tool-call-ready with fully parsed args on content_block_stop", async () => {
    const chunks = await collect(fromAnthropic({ stream: toolCallStream() as any }));
    const ready = chunks.find((c) => c.type === "tool-call-ready") as { type: "tool-call-ready"; args: unknown } | undefined;
    expect(ready).toBeDefined();
    expect(ready?.args).toEqual({ city: "Lagos" });
  });

  it("never yields any partial/intermediate chunks for tool args — only the final ready after stop", async () => {
    const chunks = await collect(fromAnthropic({ stream: toolCallStream() as any }));
    const toolChunks = chunks.filter((c) => c.type === "tool-call-start" || c.type === "tool-call-ready" || c.type === "tool-call-delta");
    // Should see exactly start + ready, nothing in between
    expect(toolChunks.map((c) => c.type)).toEqual(["tool-call-start", "tool-call-ready"]);
  });

  it("correctly interleaves text and tool call chunks in arrival order", async () => {
    const chunks = await collect(fromAnthropic({ stream: toolCallStream() as any }));
    const types = chunks.map((c) => c.type).filter((t) => t !== "done");
    expect(types).toEqual(["text", "tool-call-start", "tool-call-ready"]);
  });

  it("silently ignores thinking/redacted_thinking blocks without emitting any chunks", async () => {
    const chunks = await collect(fromAnthropic({ stream: thinkingBlockStream() as any }));
    const thinkingChunks = chunks.filter((c) => !["text", "done"].includes(c.type));
    expect(thinkingChunks).toHaveLength(0);
    // The text block at index 1 should still come through
    const textChunks = chunks.filter((c) => c.type === "text") as { delta: string }[];
    expect(textChunks[0]?.delta).toBe("Here is my answer.");
  });

  it("handles malformed/truncated tool call JSON by yielding a tool-result error instead of crashing", async () => {
    async function* brokenJsonStream() {
      yield { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "tc1", name: "search", input: {} } };
      yield { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"city": ' } }; // truncated, invalid JSON
      yield { type: "content_block_stop", index: 0 };
      yield { type: "message_stop" };
    }
    const chunks = await collect(fromAnthropic({ stream: brokenJsonStream() as any }));
    const errorResult = chunks.find((c) => c.type === "tool-result") as { type: "tool-result"; isError?: boolean } | undefined;
    expect(errorResult).toBeDefined();
    expect(errorResult?.isError).toBe(true);
    // Stream continues to done — one bad tool call doesn't kill everything
    expect(chunks[chunks.length - 1]?.type).toBe("done");
  });

  it("correctly tracks two concurrent content blocks by index without cross-contamination", async () => {
    // Both a text block (index 0) and tool block (index 1) interleave —
    // deltas keyed to the wrong index must not corrupt the other block's buffer
    async function* interleavedStream() {
      yield { type: "content_block_start", index: 0, content_block: { type: "text" } };
      yield { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "tc99", name: "lookup", input: {} } };
      yield { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"q":' } };
      yield { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "found it" } };
      yield { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '"test"}' } };
      yield { type: "content_block_stop", index: 0 };
      yield { type: "content_block_stop", index: 1 };
      yield { type: "message_stop" };
    }
    const chunks = await collect(fromAnthropic({ stream: interleavedStream() as any }));
    const text = chunks.find((c) => c.type === "text") as { delta: string } | undefined;
    const ready = chunks.find((c) => c.type === "tool-call-ready") as { args: unknown } | undefined;
    expect(text?.delta).toBe("found it");
    expect(ready?.args).toEqual({ q: "test" });
  });
});
