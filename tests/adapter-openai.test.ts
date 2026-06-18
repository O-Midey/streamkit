import { describe, it, expect } from "vitest";
import { fromOpenAI } from "../src/adapters/openai";
import type { StreamChunk } from "../src/types";

async function collect(source: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const out: StreamChunk[] = [];
  for await (const c of source) out.push(c);
  return out;
}

// Fixtures mirror the REAL shape from the installed openai package:
// ChatCompletionChunk.choices[].delta.content for text
// ChatCompletionChunk.choices[].delta.tool_calls[].{index, id, function.{name, arguments}}
// finish_reason "stop" | "tool_calls" | null

async function* textStream() {
  yield { choices: [{ index: 0, delta: { content: "Hello, " }, finish_reason: null }] };
  yield { choices: [{ index: 0, delta: { content: "world!" }, finish_reason: null }] };
  yield { choices: [{ index: 0, delta: {}, finish_reason: "stop" }] };
}

async function* toolCallStream() {
  // First chunk: id + name arrive together on the first tool_calls entry
  yield {
    choices: [{
      index: 0,
      delta: {
        tool_calls: [{ index: 0, id: "call_xyz", type: "function", function: { name: "get_weather", arguments: '{"city"' } }]
      },
      finish_reason: null,
    }]
  };
  // Subsequent chunks: argument fragments only
  yield {
    choices: [{
      index: 0,
      delta: { tool_calls: [{ index: 0, function: { arguments: ': "Lagos"' } }] },
      finish_reason: null,
    }]
  };
  yield {
    choices: [{
      index: 0,
      delta: { tool_calls: [{ index: 0, function: { arguments: "}" } }] },
      finish_reason: null,
    }]
  };
  // finish_reason "tool_calls" triggers flush + done
  yield { choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] };
}

async function* mixedStream() {
  yield { choices: [{ index: 0, delta: { content: "Let me check. " }, finish_reason: null }] };
  yield {
    choices: [{
      index: 0,
      delta: { tool_calls: [{ index: 0, id: "call_abc", type: "function", function: { name: "search", arguments: '{"q":"react"}' } }] },
      finish_reason: null,
    }]
  };
  yield { choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] };
}

describe("fromOpenAI adapter", () => {
  it("translates content deltas into streamkit text chunks", async () => {
    const chunks = await collect(fromOpenAI({ stream: textStream() as any }));
    const texts = chunks.filter((c) => c.type === "text") as { delta: string }[];
    expect(texts.map((c) => c.delta)).toEqual(["Hello, ", "world!"]);
  });

  it("emits done with the finish_reason on a stop chunk", async () => {
    const chunks = await collect(fromOpenAI({ stream: textStream() as any }));
    expect(chunks[chunks.length - 1]).toEqual({ type: "done", finishReason: "stop" });
  });

  it("emits tool-call-start when id and name first arrive", async () => {
    const chunks = await collect(fromOpenAI({ stream: toolCallStream() as any }));
    const start = chunks.find((c) => c.type === "tool-call-start");
    expect(start).toMatchObject({ type: "tool-call-start", toolCallId: "call_xyz", toolName: "get_weather" });
  });

  it("accumulates split argument fragments and emits tool-call-ready with parsed args on finish_reason=tool_calls", async () => {
    const chunks = await collect(fromOpenAI({ stream: toolCallStream() as any }));
    const ready = chunks.find((c) => c.type === "tool-call-ready") as { args: unknown } | undefined;
    expect(ready?.args).toEqual({ city: "Lagos" });
  });

  it("emits done after flushing tool-call-ready when finish_reason is tool_calls", async () => {
    const chunks = await collect(fromOpenAI({ stream: toolCallStream() as any }));
    const types = chunks.map((c) => c.type);
    expect(types).toEqual(["tool-call-start", "tool-call-ready", "done"]);
  });

  it("correctly interleaves text before tool call chunks", async () => {
    const chunks = await collect(fromOpenAI({ stream: mixedStream() as any }));
    const types = chunks.map((c) => c.type);
    expect(types).toEqual(["text", "tool-call-start", "tool-call-ready", "done"]);
  });

  it("handles malformed tool call JSON by yielding a tool-result error instead of throwing", async () => {
    async function* brokenArgsStream() {
      yield {
        choices: [{
          index: 0,
          delta: { tool_calls: [{ index: 0, id: "tc1", type: "function", function: { name: "search", arguments: '{"q":' } }] },
          finish_reason: null,
        }]
      };
      yield { choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] };
    }
    const chunks = await collect(fromOpenAI({ stream: brokenArgsStream() as any }));
    const errorResult = chunks.find((c) => c.type === "tool-result") as { isError?: boolean } | undefined;
    expect(errorResult?.isError).toBe(true);
    expect(chunks[chunks.length - 1]?.type).toBe("done");
  });

  it("tracks two concurrent tool calls by index without cross-contamination", async () => {
    async function* twoToolsStream() {
      yield {
        choices: [{
          index: 0,
          delta: {
            tool_calls: [
              { index: 0, id: "tc_a", type: "function", function: { name: "search", arguments: '{"q"' } },
              { index: 1, id: "tc_b", type: "function", function: { name: "fetch", arguments: '{"url"' } },
            ]
          },
          finish_reason: null,
        }]
      };
      yield {
        choices: [{
          index: 0,
          delta: {
            tool_calls: [
              { index: 0, function: { arguments: ':"cats"}' } },
              { index: 1, function: { arguments: ':"https://example.com"}' } },
            ]
          },
          finish_reason: null,
        }]
      };
      yield { choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] };
    }
    const chunks = await collect(fromOpenAI({ stream: twoToolsStream() as any }));
    const readies = chunks.filter((c) => c.type === "tool-call-ready") as { toolCallId: string; args: unknown }[];
    expect(readies).toHaveLength(2);
    const search = readies.find((r) => r.toolCallId === "tc_a");
    const fetch_ = readies.find((r) => r.toolCallId === "tc_b");
    expect(search?.args).toEqual({ q: "cats" });
    expect(fetch_?.args).toEqual({ url: "https://example.com" });
  });
});
