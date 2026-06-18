import { describe, it, expect, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { StreamingMarkdown } from "../src/components/StreamingMarkdown";
import { afterEach } from "vitest";

afterEach(cleanup);

describe("StreamingMarkdown", () => {
  it("renders basic markdown to the expected HTML structure", () => {
    const { container } = render(<StreamingMarkdown text={"# Title\n\nSome **bold** text."} />);
    expect(container.querySelector("h1")?.textContent).toBe("Title");
    expect(container.querySelector("strong")?.textContent).toBe("bold");
  });

  it("renders each block-level token in its own block wrapper", () => {
    const { container } = render(
      <StreamingMarkdown text={"Paragraph one.\n\nParagraph two.\n\n- a\n- b"} />
    );
    const blocks = container.querySelectorAll('[data-streamkit="markdown-block"]');
    // paragraph, paragraph, list = 3 block-level tokens (marked's "space"
    // tokens between them aren't rendered as separate blocks by us).
    expect(blocks.length).toBe(3);
  });

  it("shows a cursor only on the trailing block while isStreaming is true", () => {
    const { container } = render(
      <StreamingMarkdown text={"First paragraph.\n\nSecond paragraph."} isStreaming />
    );
    const cursors = container.querySelectorAll(".streamkit-cursor");
    expect(cursors.length).toBe(1);

    const blocks = container.querySelectorAll('[data-streamkit="markdown-block"]');
    const lastBlock = blocks[blocks.length - 1];
    expect(lastBlock?.querySelector(".streamkit-cursor")).not.toBeNull();
  });

  it("shows no cursor when isStreaming is false even if showCursor is true", () => {
    const { container } = render(
      <StreamingMarkdown text={"Done streaming."} isStreaming={false} showCursor />
    );
    expect(container.querySelectorAll(".streamkit-cursor").length).toBe(0);
  });

  it("does not re-render a sealed earlier block when a new block is appended", () => {
    const { container, rerender } = render(
      <StreamingMarkdown text={"Paragraph one."} isStreaming />
    );

    const firstBlockBefore = container.querySelectorAll('[data-streamkit="markdown-block"]')[0];
    expect(firstBlockBefore).toBeDefined();

    // Simulate the next chunk arriving: a new block starts, sealing the first.
    rerender(<StreamingMarkdown text={"Paragraph one.\n\nParagraph two starting"} isStreaming />);

    const firstBlockAfter = container.querySelectorAll('[data-streamkit="markdown-block"]')[0];
    // React.memo with the custom comparator means this should be the exact
    // same DOM node (React skips re-rendering it), not just equal content.
    expect(firstBlockAfter).toBe(firstBlockBefore);
  });

  it("re-renders the trailing block as it grows token by token", () => {
    const { container, rerender } = render(<StreamingMarkdown text={"Hel"} isStreaming />);
    let lastBlock = container.querySelector('[data-streamkit="markdown-block"]');
    expect(lastBlock?.textContent).toContain("Hel");

    rerender(<StreamingMarkdown text={"Hello world"} isStreaming />);
    lastBlock = container.querySelector('[data-streamkit="markdown-block"]');
    expect(lastBlock?.textContent).toContain("Hello world");
  });

  it("correctly handles an unterminated code fence mid-stream without breaking", () => {
    const { container } = render(
      <StreamingMarkdown text={"Here is code:\n\n```js\nconst x = 1;"} isStreaming />
    );
    const codeBlock = container.querySelector("pre code");
    expect(codeBlock).not.toBeNull();
    expect(codeBlock?.textContent).toContain("const x = 1;");
  });

  describe("XSS sanitization", () => {
    it("strips raw <script> tags embedded in streamed text", () => {
      const { container } = render(
        <StreamingMarkdown text={'Some text <script>window.__pwned = true;</script> more text'} />
      );
      expect(container.innerHTML).not.toContain("<script");
      expect((window as unknown as { __pwned?: boolean }).__pwned).toBeUndefined();
    });

    it("strips onerror/onload event handler attributes from injected img/elements", () => {
      const { container } = render(
        <StreamingMarkdown text={'<img src="x" onerror="window.__pwned2 = true">'} />
      );
      expect(container.innerHTML).not.toContain("onerror");
      expect((window as unknown as { __pwned2?: boolean }).__pwned2).toBeUndefined();
    });

    it("strips javascript: hrefs from markdown links", () => {
      const { container } = render(
        <StreamingMarkdown text={"[click me](javascript:alert('xss'))"} />
      );
      const link = container.querySelector("a");
      // DOMPurify either drops the href entirely or neutralizes the scheme —
      // either way, it must never be an executable javascript: URI.
      expect(link?.getAttribute("href") ?? "").not.toMatch(/^javascript:/i);
    });

    it("allows safe standard markdown constructs through untouched", () => {
      const { container } = render(
        <StreamingMarkdown
          text={"[a real link](https://example.com) and a normal *italic* word"}
        />
      );
      const link = container.querySelector("a");
      expect(link?.getAttribute("href")).toBe("https://example.com");
      expect(container.querySelector("em")?.textContent).toBe("italic");
    });
  });
});
