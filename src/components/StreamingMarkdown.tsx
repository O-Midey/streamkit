import { memo, useMemo } from "react";
import { marked } from "marked";
import type { Tokens } from "marked";
import DOMPurify from "dompurify";

export interface StreamingMarkdownProps {
  /** The full markdown text accumulated so far (e.g. from useTokenStream's `text`). */
  text: string;
  /** Whether the stream is still in progress. Used to decide if the trailing block should show a streaming cursor. */
  isStreaming?: boolean;
  className?: string;
  /** Render a blinking cursor after the last block while streaming. Default true. */
  showCursor?: boolean;
}

/**
 * Renders markdown incrementally as it streams in, without the flicker that
 * comes from naively re-parsing and re-rendering the entire document on
 * every chunk.
 *
 * THE PROBLEM: a naive `<div dangerouslySetInnerHTML={{ __html: marked(text) }} />`
 * re-renders the *entire* DOM subtree on every update. For short messages
 * this is invisible; for longer streamed responses it causes visible jank —
 * syntax highlighters re-run, scroll position can jump, and any focus or
 * selection inside the rendered content is lost on every token.
 *
 * THE APPROACH: markdown has a useful property for streaming — block-level
 * tokens (paragraphs, headings, list items, code fences) don't retroactively
 * change once a later block has started. A streamed response builds up
 * left-to-right, so once token N+1 exists, token N is "sealed" and will
 * render identically forever. This component re-lexes the full text on
 * every update (cheap — lexing, unlike DOM diffing, is fast) into block
 * tokens, then renders each token through its own memoized subcomponent
 * keyed by (index, raw content). React's reconciliation then skips
 * re-rendering any block whose raw text hasn't changed — only the
 * currently-growing last block actually re-renders per chunk.
 *
 * CAVEAT this approach embraces rather than fights: a block is only
 * "sealed" once a *later* block exists. The trailing block is always
 * treated as potentially incomplete (this is also where an unterminated
 * code fence or unclosed bold/list correctly continues rendering as it
 * grows, since `marked`'s lexer tolerates incomplete syntax mid-token).
 */
export function StreamingMarkdown({
  text,
  isStreaming = false,
  className,
  showCursor = true,
}: StreamingMarkdownProps) {
  const tokens = useMemo(() => {
    const allTokens = marked.lexer(text);
    // marked emits "space" tokens for the blank-line gaps between block
    // elements. These carry no renderable content — block-level HTML
    // elements (p, h1, li, etc.) already provide their own spacing via CSS,
    // so rendering a wrapper for each gap is pure DOM noise.
    return allTokens.filter((t) => t.type !== "space");
  }, [text]);

  return (
    <div className={className} data-streamkit="markdown">
      {tokens.map((token, i) => {
        const isLastToken = i === tokens.length - 1;
        return (
          <MarkdownBlock
            key={`${i}-${token.type}`}
            token={token}
            // Only the trailing block during an active stream needs the
            // cursor; sealed earlier blocks never re-render this prop's effect.
            showCursor={isStreaming && showCursor && isLastToken}
          />
        );
      })}
    </div>
  );
}

interface MarkdownBlockProps {
  token: Tokens.Generic;
  showCursor: boolean;
}

/**
 * Renders a single block-level markdown token to HTML.
 *
 * Memoized on (raw content, showCursor) — NOT on object identity of `token`,
 * since `marked.lexer()` produces a fresh token object on every parse even
 * when the underlying text is unchanged. Comparing `token.raw` is what
 * actually lets React skip re-rendering a sealed block.
 */
const MarkdownBlock = memo(
  function MarkdownBlock({ token, showCursor }: MarkdownBlockProps) {
    const html = useMemo(() => {
      const rawHtml = marked.parser([token as never]);
      // SECURITY: markdown rendered from LLM output is NOT trusted input.
      // The text reaching this component can originate from tool results,
      // retrieved documents, or other content the model relayed verbatim —
      // any of which could carry a prompt-injection payload designed to
      // produce raw <script>/onerror/etc HTML once parsed. Sanitizing here,
      // immediately before injection, is the correct boundary: it can't be
      // bypassed by a caller forgetting to sanitize upstream, and it's
      // re-applied on every block since blocks render independently.
      return DOMPurify.sanitize(rawHtml, {
        ALLOWED_TAGS: [
          "p", "br", "strong", "em", "del", "code", "pre", "blockquote",
          "ul", "ol", "li", "h1", "h2", "h3", "h4", "h5", "h6",
          "a", "img", "table", "thead", "tbody", "tr", "th", "td", "hr", "span",
        ],
        ALLOWED_ATTR: ["href", "src", "alt", "title", "class", "aria-hidden"],
        ALLOW_DATA_ATTR: false,
      });
    }, [token.raw, token.type]);

    return (
      <span
        data-streamkit="markdown-block"
        data-block-type={token.type}
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: showCursor ? html + CURSOR_HTML : html }}
      />
    );
  },
  (prev, next) =>
    prev.token.raw === next.token.raw &&
    prev.token.type === next.token.type &&
    prev.showCursor === next.showCursor
);

const CURSOR_HTML = '<span class="streamkit-cursor" aria-hidden="true">&#9612;</span>';
