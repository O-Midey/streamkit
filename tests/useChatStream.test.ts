import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useChatStream } from "../src/hooks/useChatStream";
import { createControllableStream } from "./test-utils";
import type { StreamMessage, StreamSourceFactory } from "../src/types";

describe("useChatStream", () => {
  it("appends a user message immediately and an empty streaming assistant message", async () => {
    const { factory } = createControllableStream();
    const { result } = renderHook(() =>
      useChatStream({ getAssistantStream: () => factory })
    );

    act(() => {
      result.current.sendMessage("hello there");
    });

    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[0]).toMatchObject({ role: "user", text: "hello there" });
    expect(result.current.messages[1]).toMatchObject({ role: "assistant" });
  });

  it("streams assistant text into the assistant message and reaches done", async () => {
    const { factory, push, finish } = createControllableStream();
    const { result } = renderHook(() =>
      useChatStream({ getAssistantStream: () => factory })
    );

    act(() => {
      result.current.sendMessage("hi");
    });

    await waitFor(() => expect(result.current.isStreaming).toBe(true));

    act(() => {
      push({ type: "text", delta: "Hello! " });
      push({ type: "text", delta: "How can I help?" });
    });
    finish();

    await waitFor(() => expect(result.current.isStreaming).toBe(false));
    const assistantMsg = result.current.messages[1];
    expect(assistantMsg?.text).toBe("Hello! How can I help?");
    expect(assistantMsg?.status).toBe("done");
  });

  it("passes the FULL history including the just-sent user message to getAssistantStream", async () => {
    const { factory, finish } = createControllableStream();
    const capturedHistories: StreamMessage[][] = [];

    const getAssistantStream = vi.fn((history: StreamMessage[]): StreamSourceFactory => {
      capturedHistories.push(history);
      return factory;
    });

    const { result } = renderHook(() => useChatStream({ getAssistantStream }));

    act(() => {
      result.current.sendMessage("what is the capital of France");
    });

    await waitFor(() => expect(getAssistantStream).toHaveBeenCalled());

    // This is the critical timing assertion: by the time getAssistantStream
    // actually runs (inside the async stream-start), historyRef must
    // already reflect the user message + placeholder assistant message
    // appended by sendMessage — not the pre-send empty array.
    const history = capturedHistories[0];
    expect(history).toBeDefined();
    expect(history!.some((m) => m.role === "user" && m.text === "what is the capital of France")).toBe(
      true
    );

    await act(async () => {
      finish();
      await Promise.resolve();
    });
  });

  it("handles a second turn with the correct accumulated history, not stale from turn one", async () => {
    const first = createControllableStream();
    const second = createControllableStream();
    let callCount = 0;
    const capturedHistories: StreamMessage[][] = [];

    const getAssistantStream = vi.fn((history: StreamMessage[]): StreamSourceFactory => {
      capturedHistories.push(history);
      callCount += 1;
      return callCount === 1 ? first.factory : second.factory;
    });

    const { result } = renderHook(() => useChatStream({ getAssistantStream }));

    act(() => {
      result.current.sendMessage("first question");
    });
    await waitFor(() => expect(result.current.isStreaming).toBe(true));
    act(() => {
      first.push({ type: "text", delta: "first answer" });
    });
    first.finish();
    await waitFor(() => expect(result.current.isStreaming).toBe(false));

    act(() => {
      result.current.sendMessage("second question");
    });
    await waitFor(() => expect(callCount).toBe(2));

    const secondHistory = capturedHistories[1];
    expect(secondHistory).toBeDefined();
    // Second turn's history must include all four messages: first user,
    // first assistant (settled), second user, second assistant (placeholder).
    expect(secondHistory).toHaveLength(4);
    expect(secondHistory!.map((m) => m.text)).toEqual([
      "first question",
      "first answer",
      "second question",
      "",
    ]);

    await act(async () => {
      second.finish();
      await Promise.resolve();
    });
  });

  it("executes tool calls that arrive mid-stream and reflects results onto the message", async () => {
    const { factory, push, finish } = createControllableStream();
    const search = vi.fn().mockResolvedValue({ results: ["a", "b"] });

    const { result } = renderHook(() =>
      useChatStream({ getAssistantStream: () => factory, tools: { search } })
    );

    act(() => {
      result.current.sendMessage("search for cats");
    });
    await waitFor(() => expect(result.current.isStreaming).toBe(true));

    act(() => {
      push({ type: "text", delta: "Let me check. " });
      push({ type: "tool-call-start", toolCallId: "tc1", toolName: "search" });
      push({ type: "tool-call-ready", toolCallId: "tc1", toolName: "search", args: { q: "cats" } });
    });

    await waitFor(() => {
      const tc = result.current.messages[1]?.toolCalls.find((t) => t.toolCallId === "tc1");
      expect(tc?.status).toBe("success");
    });

    const toolCall = result.current.messages[1]?.toolCalls[0];
    expect(toolCall?.result).toEqual({ results: ["a", "b"] });
    expect(search).toHaveBeenCalledWith({ q: "cats" }, expect.any(AbortSignal));

    act(() => {
      push({ type: "text", delta: "Found some cats!" });
    });
    finish();

    await waitFor(() => expect(result.current.isStreaming).toBe(false));
    expect(result.current.messages[1]?.text).toBe("Let me check. Found some cats!");
  });

  it("marks the assistant message as error and surfaces the error when the stream fails", async () => {
    const { factory, push } = createControllableStream();
    const onError = vi.fn();
    const { result } = renderHook(() =>
      useChatStream({ getAssistantStream: () => factory, onError })
    );

    act(() => {
      result.current.sendMessage("hi");
    });
    await waitFor(() => expect(result.current.isStreaming).toBe(true));

    const boom = new Error("upstream 500");
    act(() => {
      push({ type: "error", error: boom });
    });

    await waitFor(() => expect(result.current.error?.message).toBe("upstream 500"));
    expect(result.current.messages[1]?.status).toBe("error");
    expect(onError).toHaveBeenCalledWith(boom, result.current.messages[1]?.id);
  });

  it("abort() stops the in-flight assistant stream", async () => {
    const { factory, push } = createControllableStream();
    const { result } = renderHook(() => useChatStream({ getAssistantStream: () => factory }));

    act(() => {
      result.current.sendMessage("hi");
    });
    await waitFor(() => expect(result.current.isStreaming).toBe(true));

    act(() => {
      push({ type: "text", delta: "partial" });
    });
    await waitFor(() => expect(result.current.messages[1]?.text).toBe("partial"));

    act(() => {
      result.current.abort();
    });

    await waitFor(() => expect(result.current.isStreaming).toBe(false));
  });

  it("reset() clears all messages and error state", async () => {
    const { factory, finish } = createControllableStream();
    const { result } = renderHook(() => useChatStream({ getAssistantStream: () => factory }));

    act(() => {
      result.current.sendMessage("hi");
    });
    await waitFor(() => expect(result.current.messages).toHaveLength(2));
    finish();

    act(() => {
      result.current.reset();
    });

    expect(result.current.messages).toHaveLength(0);
    expect(result.current.error).toBeNull();
  });

  it("calls onAssistantMessageDone with the final settled message", async () => {
    const { factory, push, finish } = createControllableStream();
    const onAssistantMessageDone = vi.fn();
    const { result } = renderHook(() =>
      useChatStream({ getAssistantStream: () => factory, onAssistantMessageDone })
    );

    act(() => {
      result.current.sendMessage("hi");
    });
    await waitFor(() => expect(result.current.isStreaming).toBe(true));

    act(() => {
      push({ type: "text", delta: "final reply" });
    });
    finish();

    await waitFor(() => expect(onAssistantMessageDone).toHaveBeenCalled());
    expect(onAssistantMessageDone).toHaveBeenCalledWith(
      expect.objectContaining({ text: "final reply", status: "done", role: "assistant" })
    );
  });
});
