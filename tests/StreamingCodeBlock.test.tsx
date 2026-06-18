import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent, waitFor, act } from "@testing-library/react";
import { StreamingCodeBlock } from "../src/components/StreamingCodeBlock";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("StreamingCodeBlock", () => {
  it("highlights known-language code (immediately, since isStreaming defaults to false)", async () => {
    vi.useFakeTimers();
    const { container } = render(<StreamingCodeBlock code="const x = 1;" language="javascript" />);

    // isStreaming defaults to false, which means the "final pass" effect
    // fires on mount and highlights immediately rather than waiting on the
    // debounce window — this is correct: a code block rendered as already-
    // complete content shouldn't sit unhighlighted for 80ms.
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(container.querySelector(".hljs-keyword")?.textContent).toBe("const");
  });

  it("delays highlighting behind the debounce window while actively streaming", async () => {
    vi.useFakeTimers();
    const { container } = render(
      <StreamingCodeBlock code="const x = 1;" language="javascript" debounceMs={80} isStreaming />
    );

    // While isStreaming is true, only the debounced path applies — no
    // immediate pass — so right after render nothing should be highlighted yet.
    expect(container.querySelector(".hljs-keyword")).toBeNull();

    await act(async () => { await vi.advanceTimersByTimeAsync(90); });
    expect(container.querySelector(".hljs-keyword")?.textContent).toBe("const");
  });

  it("does not re-highlight on every rapid update — coalesces bursts within the debounce window", async () => {
    vi.useFakeTimers();
    const { rerender, container } = render(
      <StreamingCodeBlock code="c" language="javascript" debounceMs={80} isStreaming />
    );

    // Simulate 5 rapid character-by-character updates, each well within
    // the debounce window of the previous one.
    for (const partial of ["co", "con", "cons", "const", "const "]) {
      await act(async () => { await vi.advanceTimersByTimeAsync(10); });
      rerender(<StreamingCodeBlock code={partial} language="javascript" debounceMs={80} isStreaming />);
    }

    // None of the intermediate states should have triggered a highlight
    // pass yet, since each update reset the debounce timer.
    expect(container.querySelector(".hljs-keyword")).toBeNull();

    await act(async () => { await vi.advanceTimersByTimeAsync(90); });

    // Only now, after the burst settles, should highlighting reflect the
    // LATEST code value.
    expect(container.querySelector("code")?.textContent).toBe("const ");
  });

  it("falls back to auto-detection when the declared language is not registered", async () => {
    vi.useFakeTimers();
    const { container } = render(
      <StreamingCodeBlock code="def greet(name):\n    return name" language="not_a_real_lang" debounceMs={10} />
    );

    await act(async () => { await vi.advanceTimersByTimeAsync(20); });

    // Should not throw, should produce SOME highlighted output, and should
    // report a resolved language different from the bogus declared one.
    expect(container.querySelector("code")?.innerHTML.length).toBeGreaterThan(0);
    const langLabel = container.querySelector('[data-streamkit="code-block-language"]')?.textContent;
    expect(langLabel).not.toBe("not_a_real_lang");
  });

  it("does not throw on genuinely incomplete/unterminated code mid-stream", async () => {
    vi.useFakeTimers();
    expect(() =>
      render(
        <StreamingCodeBlock
          code={"function greet(name) {\n  const msg = `Hello ${name"}
          language="javascript"
          debounceMs={10}
          isStreaming
        />
      )
    ).not.toThrow();
    await act(async () => { await vi.advanceTimersByTimeAsync(20); });
  });

  it("runs an immediate non-debounced highlight pass the moment isStreaming flips to false", async () => {
    vi.useFakeTimers();
    const { rerender, container } = render(
      <StreamingCodeBlock code="const x = 1" language="javascript" debounceMs={5000} isStreaming />
    );

    // With a huge debounce window and isStreaming true, nothing should be
    // highlighted yet.
    expect(container.querySelector(".hljs-keyword")).toBeNull();

    // Stream ends — even though the long debounce hasn't elapsed, this
    // should trigger an immediate final pass, synchronously visible after
    // flushing microtasks (no real timer advancement needed).
    rerender(<StreamingCodeBlock code="const x = 1" language="javascript" debounceMs={5000} isStreaming={false} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    expect(container.querySelector(".hljs-keyword")?.textContent).toBe("const");
  });

  it("disables the copy button while isStreaming is true and enables it once done", () => {
    const { getByRole, rerender } = render(
      <StreamingCodeBlock code="x" language="javascript" isStreaming />
    );
    expect(getByRole("button", { name: "Copy code" })).toBeDisabled();

    rerender(<StreamingCodeBlock code="x" language="javascript" isStreaming={false} />);
    expect(getByRole("button", { name: "Copy code" })).not.toBeDisabled();
  });

  it("copies code to the clipboard and shows feedback when the copy button is clicked", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const onCopy = vi.fn();

    const { getByRole } = render(
      <StreamingCodeBlock code="const x = 1;" language="javascript" isStreaming={false} onCopy={onCopy} />
    );

    fireEvent.click(getByRole("button", { name: "Copy code" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith("const x = 1;"));
    await waitFor(() => expect(onCopy).toHaveBeenCalled());
  });

  describe("XSS sanitization", () => {
    it("never injects a raw script tag even via a crafted code string", async () => {
      vi.useFakeTimers();
      const malicious = "</code></pre><script>window.__codeXss = true;</script>";
      const { container } = render(
        <StreamingCodeBlock code={malicious} language="javascript" debounceMs={10} />
      );
      await act(async () => { await vi.advanceTimersByTimeAsync(20); });

      expect(container.innerHTML).not.toContain("<script");
      expect((window as unknown as { __codeXss?: boolean }).__codeXss).toBeUndefined();
    });
  });
});
