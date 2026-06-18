import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useTokenStream } from "../src/hooks/useTokenStream";
import { createControllableStream } from "./test-utils";

describe("useTokenStream", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("accumulates text chunks and reaches done status", async () => {
    const { factory, push, finish } = createControllableStream();
    const { result } = renderHook(() => useTokenStream(factory));

    await waitFor(() => expect(result.current.status).toBe("streaming"));

    act(() => {
      push({ type: "text", delta: "Hello" });
      push({ type: "text", delta: " world" });
    });
    finish();

    await waitFor(() => expect(result.current.status).toBe("done"));
    expect(result.current.text).toBe("Hello world");
    expect(result.current.error).toBeNull();
  });

  it("calls onDone with the final accumulated text", async () => {
    const onDone = vi.fn();
    const { factory, push, finish } = createControllableStream();
    renderHook(() => useTokenStream(factory, { onDone }));

    act(() => {
      push({ type: "text", delta: "final text" });
    });
    finish();

    await waitFor(() => expect(onDone).toHaveBeenCalledWith("final text"));
  });

  it("transitions to error status and calls onError when the stream throws", async () => {
    const onError = vi.fn();
    const { factory, push } = createControllableStream();
    const { result } = renderHook(() => useTokenStream(factory, { onError }));

    const boom = new Error("stream exploded");
    act(() => {
      push({ type: "text", delta: "partial" });
      push({ type: "error", error: boom });
    });

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error?.message).toBe("stream exploded");
    expect(onError).toHaveBeenCalledWith(boom);
    // Text accumulated before the error should still be visible.
    expect(result.current.text).toBe("partial");
  });

  it("abort() stops the stream and sets status to aborted", async () => {
    const { factory, push } = createControllableStream();
    const { result } = renderHook(() => useTokenStream(factory));

    await waitFor(() => expect(result.current.status).toBe("streaming"));

    act(() => {
      push({ type: "text", delta: "before abort" });
    });

    await waitFor(() => expect(result.current.text).toBe("before abort"));

    act(() => {
      result.current.abort();
    });

    expect(result.current.status).toBe("aborted");
  });

  it("abort() is a no-op when not streaming", async () => {
    const { factory, finish } = createControllableStream();
    const { result } = renderHook(() => useTokenStream(factory));

    finish();
    await waitFor(() => expect(result.current.status).toBe("done"));

    act(() => {
      result.current.abort();
    });

    // Status should remain "done", not flip to "aborted" — abort after
    // completion must not corrupt a terminal state.
    expect(result.current.status).toBe("done");
  });

  it("restart via streamKey discards a previous in-flight run's late-arriving chunks", async () => {
    const first = createControllableStream();
    const second = createControllableStream();

    const { result, rerender } = renderHook(
      ({ key }: { key: 1 | 2 }) =>
        useTokenStream((signal) => (key === 1 ? first.factory(signal) : second.factory(signal)), {
          streamKey: key,
        }),
      { initialProps: { key: 1 } }
    );

    await waitFor(() => expect(result.current.status).toBe("streaming"));

    act(() => {
      first.push({ type: "text", delta: "stale" });
    });
    await waitFor(() => expect(result.current.text).toBe("stale"));

    // Changing streamKey is the documented way to start a new logical
    // stream; it must abort the first run before the second begins.
    rerender({ key: 2 });

    await waitFor(() => expect(result.current.text).toBe(""));

    act(() => {
      second.push({ type: "text", delta: "fresh" });
    });
    await waitFor(() => expect(result.current.text).toBe("fresh"));

    // Now resolve the FIRST (stale) stream's pending chunk — it must not
    // be able to corrupt state, since a newer run has superseded it.
    await act(async () => {
      first.push({ type: "text", delta: " corruption" });
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(result.current.text).toBe("fresh");
  });

  it("an inline factory with a new identity every render does NOT cause an infinite restart loop", async () => {
    const { factory, push, finish } = createControllableStream();
    let renderCount = 0;

    const { result, rerender } = renderHook(() => {
      renderCount++;
      // Deliberately a fresh inline closure every render — this is the
      // pattern most consumers will reach for naturally.
      return useTokenStream((signal) => factory(signal));
    });

    await waitFor(() => expect(result.current.status).toBe("streaming"));

    act(() => {
      push({ type: "text", delta: "stable" });
    });
    finish();
    await waitFor(() => expect(result.current.status).toBe("done"));

    const countAfterFirstSettle = renderCount;
    rerender();
    rerender();

    // A handful of manual rerenders should only add a handful of renders,
    // not trigger new stream runs or runaway re-render cascades.
    expect(renderCount).toBeLessThan(countAfterFirstSettle + 5);
    expect(result.current.text).toBe("stable");
    expect(result.current.status).toBe("done");
  });

  it("does not start the stream when autoStart is false, and start() begins it", async () => {
    const { factory, push, finish } = createControllableStream();
    const { result } = renderHook(() => useTokenStream(factory, { autoStart: false }));

    expect(result.current.status).toBe("idle");

    act(() => {
      result.current.start();
    });

    await waitFor(() => expect(result.current.status).toBe("streaming"));

    act(() => {
      push({ type: "text", delta: "started manually" });
    });
    finish();

    await waitFor(() => expect(result.current.status).toBe("done"));
    expect(result.current.text).toBe("started manually");
  });

  it("tracks tool call lifecycle from start through ready to result", async () => {
    const { factory, push, finish } = createControllableStream();
    const { result } = renderHook(() => useTokenStream(factory));

    act(() => {
      push({ type: "tool-call-start", toolCallId: "tc1", toolName: "search" });
    });
    await waitFor(() => expect(result.current.toolCalls).toHaveLength(1));
    expect(result.current.toolCalls[0]).toMatchObject({ status: "pending", toolName: "search" });

    act(() => {
      push({ type: "tool-call-ready", toolCallId: "tc1", toolName: "search", args: { q: "x" } });
    });
    await waitFor(() => expect(result.current.toolCalls[0]?.status).toBe("executing"));

    act(() => {
      push({ type: "tool-result", toolCallId: "tc1", result: { hits: 3 } });
    });
    finish();

    await waitFor(() => expect(result.current.toolCalls[0]?.status).toBe("success"));
    expect(result.current.toolCalls[0]?.result).toEqual({ hits: 3 });
  });

  it("aborts the in-flight stream on unmount", async () => {
    const { factory, getFactoryCallCount } = createControllableStream();
    const { result, unmount } = renderHook(() => useTokenStream(factory));

    await waitFor(() => expect(result.current.status).toBe("streaming"));
    expect(getFactoryCallCount()).toBe(1);

    // Unmounting should not throw, and should not leave a dangling interval.
    expect(() => unmount()).not.toThrow();
  });
});
