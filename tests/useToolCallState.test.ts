import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useToolCallState } from "../src/hooks/useToolCallState";
import type { ToolCallReadyChunk } from "../src/types";

function readyChunk(overrides: Partial<ToolCallReadyChunk> = {}): ToolCallReadyChunk {
  return {
    type: "tool-call-ready",
    toolCallId: "tc1",
    toolName: "search",
    args: { q: "react" },
    ...overrides,
  };
}

describe("useToolCallState", () => {
  it("executes a registered tool and transitions pending -> executing -> success", async () => {
    const search = vi.fn().mockResolvedValue({ hits: 3 });
    const { result } = renderHook(() => useToolCallState({ tools: { search } }));

    act(() => {
      result.current.registerCall(readyChunk());
    });

    await waitFor(() => expect(result.current.calls[0]?.status).toBe("success"));
    expect(result.current.calls[0]?.result).toEqual({ hits: 3 });
    expect(search).toHaveBeenCalledWith({ q: "react" }, expect.any(AbortSignal));
  });

  it("transitions to error status when the tool implementation throws", async () => {
    const search = vi.fn().mockRejectedValue(new Error("api down"));
    const { result } = renderHook(() => useToolCallState({ tools: { search } }));

    act(() => {
      result.current.registerCall(readyChunk());
    });

    await waitFor(() => expect(result.current.calls[0]?.status).toBe("error"));
    expect(result.current.calls[0]?.error?.message).toBe("api down");
  });

  it("errors immediately when no implementation is registered for the tool name", async () => {
    const { result } = renderHook(() => useToolCallState({ tools: {} }));

    act(() => {
      result.current.registerCall(readyChunk({ toolName: "unknown_tool" }));
    });

    await waitFor(() => expect(result.current.calls[0]?.status).toBe("error"));
    expect(result.current.calls[0]?.error?.message).toMatch(/unknown_tool/);
  });

  it("is idempotent — registering the same toolCallId twice does not re-execute", async () => {
    const search = vi.fn().mockResolvedValue({ ok: true });
    const { result } = renderHook(() => useToolCallState({ tools: { search } }));

    act(() => {
      result.current.registerCall(readyChunk());
    });
    await waitFor(() => expect(result.current.calls[0]?.status).toBe("success"));

    act(() => {
      result.current.registerCall(readyChunk());
    });

    // Give any accidental second execution a moment to (not) happen.
    await new Promise((r) => setTimeout(r, 20));
    expect(search).toHaveBeenCalledTimes(1);
    expect(result.current.calls).toHaveLength(1);
  });

  it("calls onCallSettled exactly once per call, on success", async () => {
    const onCallSettled = vi.fn();
    const search = vi.fn().mockResolvedValue({ ok: true });
    const { result } = renderHook(() =>
      useToolCallState({ tools: { search }, onCallSettled })
    );

    act(() => {
      result.current.registerCall(readyChunk());
    });

    await waitFor(() => expect(onCallSettled).toHaveBeenCalledTimes(1));
    expect(onCallSettled).toHaveBeenCalledWith(
      expect.objectContaining({ status: "success", result: { ok: true } })
    );
  });

  it("aborts in-flight executions on unmount without throwing", async () => {
    let capturedSignal: AbortSignal | undefined;
    const slowTool = vi.fn((_args: unknown, signal: AbortSignal) => {
      capturedSignal = signal;
      return new Promise(() => {}); // never resolves on its own
    });

    const { result, unmount } = renderHook(() => useToolCallState({ tools: { slowTool } }));

    act(() => {
      result.current.registerCall(readyChunk({ toolName: "slowTool" }));
    });

    await waitFor(() => expect(result.current.calls[0]?.status).toBe("executing"));

    expect(() => unmount()).not.toThrow();
    expect(capturedSignal?.aborted).toBe(true);
  });

  it("reset() clears all tracked calls and aborts in-flight ones", async () => {
    const slowTool = vi.fn(() => new Promise(() => {}));
    const { result } = renderHook(() => useToolCallState({ tools: { slowTool } }));

    act(() => {
      result.current.registerCall(readyChunk({ toolName: "slowTool" }));
    });
    await waitFor(() => expect(result.current.calls).toHaveLength(1));

    act(() => {
      result.current.reset();
    });

    expect(result.current.calls).toHaveLength(0);
  });

  it("evicts oldest SETTLED calls once maxHistory is exceeded, never a pending/executing one", async () => {
    const fast = vi.fn().mockResolvedValue("done");
    const slow = vi.fn(() => new Promise(() => {})); // stays pending forever

    const { result } = renderHook(() => useToolCallState({ tools: { fast, slow }, maxHistory: 2 }));

    // First call: stays executing forever — must never be evicted.
    act(() => {
      result.current.registerCall(readyChunk({ toolCallId: "pinned", toolName: "slow" }));
    });
    await waitFor(() => expect(result.current.getCall("pinned")?.status).toBe("executing"));

    // Two more calls that settle quickly, pushing total count past maxHistory.
    act(() => {
      result.current.registerCall(readyChunk({ toolCallId: "settled1", toolName: "fast" }));
    });
    await waitFor(() => expect(result.current.getCall("settled1")?.status).toBe("success"));

    act(() => {
      result.current.registerCall(readyChunk({ toolCallId: "settled2", toolName: "fast" }));
    });
    await waitFor(() => expect(result.current.getCall("settled2")?.status).toBe("success"));

    // A third settling call should trigger eviction — but "pinned" (still
    // executing) must survive regardless of how old it is.
    act(() => {
      result.current.registerCall(readyChunk({ toolCallId: "settled3", toolName: "fast" }));
    });
    await waitFor(() => expect(result.current.getCall("settled3")?.status).toBe("success"));

    expect(result.current.getCall("pinned")).toBeDefined();
    expect(result.current.calls.length).toBeLessThanOrEqual(3); // pinned + at most maxHistory settled
  });
});
