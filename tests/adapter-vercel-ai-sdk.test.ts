import { describe, it, expect } from "vitest";
import { fromVercelAISDK } from "../src/adapters/vercel-ai-sdk";
import type { StreamChunk } from "../src/types";

async function collect(source: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const out: StreamChunk[] = [];
  for await (const c of source) out.push(c);
  return out;
}

// These fixtures mirror the REAL shape from node_modules/ai/dist/index.d.ts's
// TextStreamPart union (verified directly against the installed ai@6.0.208
// package, not from memory or docs), specifically: text-delta uses `text`
// (not `textDelta`), tool-call carries `input` (not `args`) and arrives as
// a single complete event, tool-result carries `output` (not `result`).
function* vercelFixtureStream(): Generator<any> {
  yield { type: "start" };
  yield { type: "text-start", id: "1" };
  yield { type: "text-delta", id: "1", text: "Let me check the weather. " };
  yield { type: "tool-call", toolCallId: "call_abc123", toolName: "getWeather", input: { city: "Lagos" } };
  yield { type: "tool-result", toolCallId: "call_abc123", toolName: "getWeather", input: { city: "Lagos" }, output: { tempC: 29, condition: "sunny" } };
  yield { type: "text-delta", id: "2", text: "It's sunny and 29°C." };
  yield { type: "text-end", id: "2" };
  yield { type: "finish", finishReason: "stop", totalUsage: {} };
}

describe("fromVercelAISDK adapter", () => {
  it("translates text-delta parts using `text` (not the old `textDelta` field name)", async () => {
    async function* stream() {
      yield { type: "text-delta", id: "1", text: "hello" };
      yield { type: "finish", finishReason: "stop" };
    }
    const chunks = await collect(fromVercelAISDK({ fullStream: stream() }));
    expect(chunks[0]).toEqual({ type: "text", delta: "hello" });
  });

  it("translates a complete tool-call part into a start+ready pair with `input` mapped to `args`", async () => {
    async function* stream() {
      yield { type: "tool-call", toolCallId: "tc1", toolName: "search", input: { q: "react" } };
      yield { type: "finish", finishReason: "stop" };
    }
    const chunks = await collect(fromVercelAISDK({ fullStream: stream() }));

    expect(chunks[0]).toEqual({ type: "tool-call-start", toolCallId: "tc1", toolName: "search" });
    expect(chunks[1]).toEqual({
      type: "tool-call-ready",
      toolCallId: "tc1",
      toolName: "search",
      args: { q: "react" },
    });
  });

  it("translates tool-result parts using `output` mapped to `result`", async () => {
    async function* stream() {
      yield { type: "tool-result", toolCallId: "tc1", toolName: "search", output: { hits: 5 } };
      yield { type: "finish", finishReason: "stop" };
    }
    const chunks = await collect(fromVercelAISDK({ fullStream: stream() }));
    const toolResult = chunks.find((c) => c.type === "tool-result");
    expect(toolResult).toEqual({ type: "tool-result", toolCallId: "tc1", result: { hits: 5 } });
  });

  it("translates tool-error parts into a tool-result chunk with isError: true", async () => {
    async function* stream() {
      yield { type: "tool-error", toolCallId: "tc1", toolName: "search", error: new Error("rate limited") };
      yield { type: "finish", finishReason: "stop" };
    }
    const chunks = await collect(fromVercelAISDK({ fullStream: stream() }));
    const toolResult = chunks.find((c) => c.type === "tool-result") as { type: "tool-result"; isError?: boolean; result: unknown };
    expect(toolResult.isError).toBe(true);
    expect((toolResult.result as Error).message).toBe("rate limited");
  });

  it("translates finish into a done chunk and stops iterating (terminal)", async () => {
    let yieldedAfterFinish = false;
    async function* stream() {
      yield { type: "finish", finishReason: "stop" };
      yieldedAfterFinish = true; // should never run if the adapter returns early
      yield { type: "text-delta", id: "x", text: "should not appear" };
    }
    const chunks = await collect(fromVercelAISDK({ fullStream: stream() }));
    expect(chunks).toEqual([{ type: "done", finishReason: "stop" }]);
    // Note: a generator naturally won't be driven past the first yield once
    // the consumer stops calling .next(), so this assertion just documents
    // that intent rather than independently proving early-return — the
    // chunks array above is the real proof.
    expect(chunks.length).toBe(1);
  });

  it("translates a top-level error part into an error chunk and stops", async () => {
    async function* stream() {
      yield { type: "error", error: new Error("upstream failure") };
    }
    const chunks = await collect(fromVercelAISDK({ fullStream: stream() }));
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ type: "error" });
    expect((chunks[0] as { type: "error"; error: Error }).error.message).toBe("upstream failure");
  });

  it("silently ignores part types not meaningful to streamkit (reasoning, source, start-step, etc.)", async () => {
    async function* stream() {
      yield { type: "start" };
      yield { type: "reasoning-start", id: "r1" };
      yield { type: "reasoning-delta", id: "r1", text: "thinking..." };
      yield { type: "reasoning-end", id: "r1" };
      yield { type: "source", id: "s1" };
      yield { type: "start-step", request: {}, warnings: [] };
      yield { type: "text-delta", id: "1", text: "visible text" };
      yield { type: "finish-step", response: {}, usage: {}, finishReason: "stop", rawFinishReason: "stop", providerMetadata: undefined };
      yield { type: "finish", finishReason: "stop" };
    }
    const chunks = await collect(fromVercelAISDK({ fullStream: stream() }));
    expect(chunks).toEqual([
      { type: "text", delta: "visible text" },
      { type: "done", finishReason: "stop" },
    ]);
  });

  it("handles a realistic full fixture end to end (text + tool call + tool result + finish)", async () => {
    const chunks = await collect(fromVercelAISDK({ fullStream: vercelFixtureStream() as any }));

    expect(chunks).toEqual([
      { type: "text", delta: "Let me check the weather. " },
      { type: "tool-call-start", toolCallId: "call_abc123", toolName: "getWeather" },
      { type: "tool-call-ready", toolCallId: "call_abc123", toolName: "getWeather", args: { city: "Lagos" } },
      { type: "tool-result", toolCallId: "call_abc123", result: { tempC: 29, condition: "sunny" } },
      { type: "text", delta: "It's sunny and 29°C." },
      { type: "done", finishReason: "stop" },
    ]);
  });
});
