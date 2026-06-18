import type { StreamChunk, StreamSource, StreamSourceFactory } from "../src/types";

/**
 * Creates a StreamSourceFactory backed by a manually-controlled queue.
 * Tests push chunks and call `finish()`/`fail()` to drive the stream,
 * instead of relying on real timers or network calls — this keeps the
 * abort/race-condition tests deterministic.
 */
export function createControllableStream() {
  const pendingResolvers: Array<(value: { chunk?: StreamChunk; done: boolean }) => void> = [];
  const queue: StreamChunk[] = [];
  let finished = false;
  let aborted = false;
  let factoryCallCount = 0;

  function push(chunk: StreamChunk) {
    if (pendingResolvers.length > 0) {
      const resolve = pendingResolvers.shift()!;
      resolve({ chunk, done: false });
    } else {
      queue.push(chunk);
    }
  }

  function finish() {
    finished = true;
    while (pendingResolvers.length > 0) {
      const resolve = pendingResolvers.shift()!;
      resolve({ done: true });
    }
  }

  const source: StreamSource = {
    [Symbol.asyncIterator]() {
      return {
        async next(): Promise<IteratorResult<StreamChunk>> {
          if (aborted) return { value: undefined, done: true };
          if (queue.length > 0) {
            return { value: queue.shift()!, done: false };
          }
          if (finished) return { value: undefined, done: true };
          const result = await new Promise<{ chunk?: StreamChunk; done: boolean }>((resolve) => {
            pendingResolvers.push(resolve);
          });
          if (result.done || aborted) return { value: undefined, done: true };
          return { value: result.chunk!, done: false };
        },
      };
    },
  };

  const factory: StreamSourceFactory = (signal: AbortSignal) => {
    factoryCallCount++;
    signal.addEventListener("abort", () => {
      aborted = true;
    });
    return source;
  };

  return {
    factory,
    push,
    finish,
    getFactoryCallCount: () => factoryCallCount,
  };
}
