import { describe, it, expect, vi } from "vitest";
import { createResumableStream } from "../src/hooks/createResumableStream";
import type { StreamChunk, StreamSource } from "../src/types";

function sourceFromChunks(chunks: StreamChunk[]): StreamSource {
  return {
    async *[Symbol.asyncIterator]() {
      for (const c of chunks) yield c;
    },
  };
}

function sourceThatThrows(error: Error): StreamSource {
  return {
    async *[Symbol.asyncIterator]() {
      yield { type: "error", error } as StreamChunk;
    },
  };
}

async function collectChunks(source: StreamSource): Promise<StreamChunk[]> {
  const out: StreamChunk[] = [];
  for await (const c of source) out.push(c);
  return out;
}

describe("createResumableStream", () => {
  it("passes through chunks normally when the underlying stream succeeds first try", async () => {
    const buildFactory = vi.fn(() => async () => sourceFromChunks([
      { type: "text", delta: "hello" },
      { type: "done" },
    ]));

    const factory = createResumableStream({ buildFactory, retryDelayMs: () => 0 });
    const controller = new AbortController();
    const source = await factory(controller.signal);
    const chunks = await collectChunks(source);

    expect(chunks).toEqual([{ type: "text", delta: "hello" }, { type: "done" }]);
    expect(buildFactory).toHaveBeenCalledTimes(1);
    expect(buildFactory).toHaveBeenCalledWith({ textSoFar: "", attempt: 0 });
  });

  it("retries on a transient error and eventually succeeds, accumulating textSoFar across attempts", async () => {
    let callCount = 0;
    const buildFactory = vi.fn(({ textSoFar }: { textSoFar: string; attempt: number }) => {
      callCount += 1;
      return async () => {
        if (callCount === 1) {
          return sourceFromChunks([
            { type: "text", delta: "partial-" },
            { type: "error", error: new Error("network drop") },
          ]);
        }
        // Second attempt succeeds; verify it received accumulated text.
        expect(textSoFar).toBe("partial-");
        return sourceFromChunks([{ type: "text", delta: "rest" }, { type: "done" }]);
      };
    });

    const factory = createResumableStream({ buildFactory, retryDelayMs: () => 0, maxRetries: 2 });
    const controller = new AbortController();
    const source = await factory(controller.signal);
    const chunks = await collectChunks(source);

    const textChunks = chunks.filter((c) => c.type === "text") as { type: "text"; delta: string }[];
    expect(textChunks.map((c) => c.delta)).toEqual(["partial-", "rest"]);
    expect(chunks.some((c) => c.type === "done")).toBe(true);
    expect(buildFactory).toHaveBeenCalledTimes(2);

    // Critical: the transient error from attempt 1 must NEVER reach the
    // consumer, since the retry succeeded. A consuming useTokenStream
    // would otherwise incorrectly flip to "error" status mid-retry.
    expect(chunks.some((c) => c.type === "error")).toBe(false);
  });

  it("gives up and yields an error chunk after exceeding maxRetries", async () => {
    const buildFactory = vi.fn(() => async () => sourceThatThrows(new Error("persistent failure")));

    const factory = createResumableStream({ buildFactory, retryDelayMs: () => 0, maxRetries: 2 });
    const controller = new AbortController();
    const source = await factory(controller.signal);
    const chunks = await collectChunks(source);

    // Should have attempted: initial + 2 retries = 3 calls to buildFactory.
    expect(buildFactory).toHaveBeenCalledTimes(3);
    const errorChunk = chunks.find((c) => c.type === "error");
    expect(errorChunk).toBeDefined();
    expect((errorChunk as { type: "error"; error: Error }).error.message).toBe("persistent failure");
  });

  it("does NOT retry when the error indicates an abort", async () => {
    const buildFactory = vi.fn(() => async () => sourceThatThrows(new Error("The operation was aborted")));

    const factory = createResumableStream({ buildFactory, retryDelayMs: () => 0, maxRetries: 5 });
    const controller = new AbortController();
    const source = await factory(controller.signal);
    const chunks = await collectChunks(source);

    expect(buildFactory).toHaveBeenCalledTimes(1);
    expect(chunks.some((c) => c.type === "error")).toBe(true);
  });

  it("calls onRetry with the error and attempt number for each retry", async () => {
    const onRetry = vi.fn();
    let callCount = 0;
    const buildFactory = vi.fn(() => {
      callCount += 1;
      return async () =>
        callCount < 3
          ? sourceThatThrows(new Error(`fail ${callCount}`))
          : sourceFromChunks([{ type: "done" }]);
    });

    const factory = createResumableStream({ buildFactory, retryDelayMs: () => 0, maxRetries: 3, onRetry });
    const controller = new AbortController();
    const source = await factory(controller.signal);
    await collectChunks(source);

    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenNthCalledWith(1, expect.objectContaining({ message: "fail 1" }), 1);
    expect(onRetry).toHaveBeenNthCalledWith(2, expect.objectContaining({ message: "fail 2" }), 2);
  });

  it("respects a custom shouldRetry predicate", async () => {
    const buildFactory = vi.fn(() => async () => sourceThatThrows(new Error("do not retry me")));
    const shouldRetry = vi.fn(() => false);

    const factory = createResumableStream({ buildFactory, retryDelayMs: () => 0, shouldRetry, maxRetries: 5 });
    const controller = new AbortController();
    const source = await factory(controller.signal);
    await collectChunks(source);

    expect(buildFactory).toHaveBeenCalledTimes(1);
    expect(shouldRetry).toHaveBeenCalledWith(expect.objectContaining({ message: "do not retry me" }), 1);
  });

  it("stops retrying immediately if the signal is already aborted", async () => {
    const buildFactory = vi.fn(() => async () => sourceThatThrows(new Error("transient")));

    const factory = createResumableStream({ buildFactory, retryDelayMs: () => 50, maxRetries: 5 });
    const controller = new AbortController();
    const sourcePromise = factory(controller.signal);
    controller.abort();
    const source = await sourcePromise;
    const chunks = await collectChunks(source);

    // Once aborted, the generator should return early without yielding a
    // synthetic error chunk for the abort itself.
    expect(chunks.every((c) => c.type !== "error")).toBe(true);
  });
});
