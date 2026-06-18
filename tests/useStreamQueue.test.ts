import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useStreamQueue } from "../src/hooks/useStreamQueue";
import { createControllableStream } from "./test-utils";

describe("useStreamQueue", () => {
  it("enqueues and runs a single stream to completion", async () => {
    const { factory, push, finish } = createControllableStream();
    const { result } = renderHook(() => useStreamQueue());

    let id = "";
    act(() => {
      id = result.current.enqueue(factory);
    });

    await waitFor(() => expect(result.current.streams[0]?.status).toBe("streaming"));

    act(() => {
      push({ type: "text", delta: "hello" });
    });
    await act(async () => {
      finish();
      await new Promise((r) => setTimeout(r, 50));
    });

    await waitFor(() => expect(result.current.streams[0]?.status).toBe("done"));
    expect(result.current.streams[0]?.text).toBe("hello");
    expect(result.current.streams[0]?.id).toBe(id);
  });

  it("runs multiple streams concurrently with independent state, unbounded by default", async () => {
    const a = createControllableStream();
    const b = createControllableStream();
    const { result } = renderHook(() => useStreamQueue());

    act(() => {
      result.current.enqueue(a.factory, "a");
      result.current.enqueue(b.factory, "b");
    });

    await waitFor(() => {
      expect(result.current.streams.find((s) => s.id === "a")?.status).toBe("streaming");
      expect(result.current.streams.find((s) => s.id === "b")?.status).toBe("streaming");
    });

    act(() => {
      a.push({ type: "text", delta: "from A" });
      b.push({ type: "text", delta: "from B" });
    });

    await waitFor(() => {
      expect(result.current.streams.find((s) => s.id === "a")?.text).toBe("from A");
      expect(result.current.streams.find((s) => s.id === "b")?.text).toBe("from B");
    });

    await act(async () => {
      a.finish();
      b.finish();
      await new Promise((r) => setTimeout(r, 50));
    });

    await waitFor(() => {
      expect(result.current.streams.find((s) => s.id === "a")?.status).toBe("done");
      expect(result.current.streams.find((s) => s.id === "b")?.status).toBe("done");
    });
  });

  it("respects a concurrency cap, keeping excess streams pending (reported as idle) until a slot frees", async () => {
    const a = createControllableStream();
    const b = createControllableStream();
    const c = createControllableStream();
    const { result } = renderHook(() => useStreamQueue({ concurrency: 2 }));

    act(() => {
      result.current.enqueue(a.factory, "a");
      result.current.enqueue(b.factory, "b");
      result.current.enqueue(c.factory, "c");
    });

    await waitFor(() => {
      expect(result.current.streams.find((s) => s.id === "a")?.status).toBe("streaming");
      expect(result.current.streams.find((s) => s.id === "b")?.status).toBe("streaming");
    });

    // Third stream should not have started yet — its factory must not have
    // been invoked, and it should report as not-yet-running.
    expect(c.getFactoryCallCount()).toBe(0);
    expect(result.current.streams.find((s) => s.id === "c")?.status).toBe("idle");

    // Finish "a" — this should free a slot and promote "c".
    await act(async () => {
      a.finish();
      await new Promise((r) => setTimeout(r, 50));
    });

    await waitFor(() => expect(c.getFactoryCallCount()).toBe(1));
    await waitFor(() => expect(result.current.streams.find((s) => s.id === "c")?.status).toBe("streaming"));

    await act(async () => {
      b.finish();
      c.finish();
      await new Promise((r) => setTimeout(r, 50));
    });
  });

  it("abort(id) stops only the targeted stream, leaving others running", async () => {
    const a = createControllableStream();
    const b = createControllableStream();
    const { result } = renderHook(() => useStreamQueue());

    act(() => {
      result.current.enqueue(a.factory, "a");
      result.current.enqueue(b.factory, "b");
    });

    await waitFor(() => {
      expect(result.current.streams.find((s) => s.id === "a")?.status).toBe("streaming");
      expect(result.current.streams.find((s) => s.id === "b")?.status).toBe("streaming");
    });

    act(() => {
      result.current.abort("a");
    });

    expect(result.current.streams.find((s) => s.id === "a")?.status).toBe("aborted");
    expect(result.current.streams.find((s) => s.id === "b")?.status).toBe("streaming");

    await act(async () => {
      b.finish();
      await new Promise((r) => setTimeout(r, 50));
    });
  });

  it("abortAll() stops every running and pending stream", async () => {
    const a = createControllableStream();
    const b = createControllableStream();
    const { result } = renderHook(() => useStreamQueue({ concurrency: 1 }));

    act(() => {
      result.current.enqueue(a.factory, "a");
      result.current.enqueue(b.factory, "b");
    });

    await waitFor(() => expect(result.current.streams.find((s) => s.id === "a")?.status).toBe("streaming"));
    expect(result.current.streams.find((s) => s.id === "b")?.status).toBe("idle");

    act(() => {
      result.current.abortAll();
    });

    expect(result.current.streams.find((s) => s.id === "a")?.status).toBe("aborted");
    expect(result.current.streams.find((s) => s.id === "b")?.status).toBe("aborted");
  });

  it("isAnyActive reflects whether any stream is still streaming or pending", async () => {
    const { factory, push, finish } = createControllableStream();
    const { result } = renderHook(() => useStreamQueue());

    expect(result.current.isAnyActive).toBe(false);

    act(() => {
      result.current.enqueue(factory);
    });
    await waitFor(() => expect(result.current.isAnyActive).toBe(true));

    act(() => {
      push({ type: "text", delta: "x" });
    });
    await act(async () => {
      finish();
      await new Promise((r) => setTimeout(r, 50));
    });

    await waitFor(() => expect(result.current.isAnyActive).toBe(false));
  });

  it("calls onDone with the correct id and final text for each stream independently", async () => {
    const a = createControllableStream();
    const b = createControllableStream();
    const onDone = vi.fn();
    const { result } = renderHook(() => useStreamQueue({ onDone }));

    act(() => {
      result.current.enqueue(a.factory, "a");
      result.current.enqueue(b.factory, "b");
    });

    await waitFor(() => expect(result.current.streams).toHaveLength(2));

    act(() => {
      a.push({ type: "text", delta: "alpha" });
    });
    await act(async () => {
      a.finish();
      await new Promise((r) => setTimeout(r, 50));
    });
    await waitFor(() => expect(onDone).toHaveBeenCalledWith("a", "alpha"));

    act(() => {
      b.push({ type: "text", delta: "beta" });
    });
    await act(async () => {
      b.finish();
      await new Promise((r) => setTimeout(r, 50));
    });
    await waitFor(() => expect(onDone).toHaveBeenCalledWith("b", "beta"));
  });
});
