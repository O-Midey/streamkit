import { useEffect, useMemo, useRef, useState } from "react";
import hljs from "highlight.js";
import DOMPurify from "dompurify";

export interface StreamingCodeBlockProps {
  /** The code content accumulated so far. */
  code: string;
  /** Language identifier from the fence (e.g. "js", "python"). Falls back to auto-detection if unrecognized. */
  language?: string;
  /** Whether more code is still streaming in. Disables the copy button and shows a subtle pulse while true. */
  isStreaming?: boolean;
  className?: string;
  /**
   * Debounce window in ms between re-highlight passes while streaming.
   * Highlighting the FULL code string is relatively expensive compared to
   * the per-character text-append rate of a token stream, so re-running it
   * on every single delta would be wasteful and can visibly stutter on
   * longer code blocks. Default 80ms — fast enough to feel live, slow
   * enough to coalesce a burst of rapid token arrivals into one highlight
   * pass. Set to 0 to highlight on every render (rarely what you want).
   */
  debounceMs?: number;
  /** Called when the copy button is clicked, after the copy succeeds. */
  onCopy?: () => void;
}

/**
 * Renders a code block with syntax highlighting that updates incrementally
 * as the code streams in, without re-highlighting (and thus re-painting)
 * on every single character.
 *
 * THE PROBLEM: syntax highlighting requires re-tokenizing the ENTIRE code
 * string on every change — unlike StreamingMarkdown, there's no clean
 * "sealed block" boundary mid-snippet, since a single code block is one
 * lexical unit until it's complete (an early `{` isn't safely highlightable
 * in isolation from the matching `}` that hasn't arrived yet). So the
 * realistic strategy here is debouncing the highlight pass itself, not
 * structurally partitioning the content like StreamingMarkdown does.
 *
 * WHY highlight.js OVER shiki: shiki produces more accurate, theme-able
 * highlighting via real TextMate grammars, but it's built around tokenizing
 * COMPLETE, well-formed source and a heavier runtime. highlight.js is
 * explicitly designed to tolerate arbitrary, possibly-malformed pasted
 * snippets — which is exactly the shape of a code block mid-stream (an
 * unclosed string, an unfinished bracket). It degrades to "best effort"
 * output instead of throwing, which is the right failure mode here.
 *
 * LANGUAGE FALLBACK: a model's fence language tag is not guaranteed to
 * match a registered highlight.js language (hallucinated, unusual, or
 * just absent). If the declared language isn't registered, this component
 * falls back to highlightAuto — but only as a last resort, since
 * auto-detection on short/incomplete snippets (which is common early in a
 * stream) frequently guesses wrong.
 */
export function StreamingCodeBlock({
  code,
  language,
  isStreaming = false,
  className,
  debounceMs = 80,
  onCopy,
}: StreamingCodeBlockProps) {
  const [highlightedHtml, setHighlightedHtml] = useState("");
  const [resolvedLanguage, setResolvedLanguage] = useState<string | undefined>(language);
  const [copied, setCopied] = useState(false);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestCodeRef = useRef(code);
  latestCodeRef.current = code;

  const runHighlight = useMemo(
    () => () => {
      const currentCode = latestCodeRef.current;
      try {
        if (language && hljs.getLanguage(language)) {
          const result = hljs.highlight(currentCode, { language });
          setHighlightedHtml(sanitize(result.value));
          setResolvedLanguage(language);
        } else {
          // Either no language was declared, or it's not one hljs knows —
          // fall back to best-effort auto-detection rather than throwing
          // or leaving the block unhighlighted.
          const result = hljs.highlightAuto(currentCode);
          setHighlightedHtml(sanitize(result.value));
          setResolvedLanguage(result.language);
        }
      } catch {
        // highlight.js is generally tolerant, but if anything still goes
        // wrong, fail safe to plain escaped text rather than crash the
        // component or render unsanitized content.
        setHighlightedHtml(escapeHtml(currentCode));
      }
    },
    [language]
  );

  useEffect(() => {
    if (debounceMs <= 0) {
      runHighlight();
      return;
    }
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(runHighlight, debounceMs);
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
    // Re-run whenever code or language changes; runHighlight itself is
    // recreated only when `language` changes, but we still want to
    // schedule a fresh debounced pass on every code update.
  }, [code, language, debounceMs, runHighlight]);

  // Always run one immediate, non-debounced highlight pass once streaming
  // ends, so the final rendered state isn't sitting on a stale debounced
  // pass that never got to fire for the last few characters.
  useEffect(() => {
    if (!isStreaming) {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      runHighlight();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStreaming]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      onCopy?.();
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API can fail (permissions, non-secure context, etc.) —
      // fail silently rather than throw; there's no good in-component
      // recovery action beyond letting the user select-and-copy manually.
    }
  };

  return (
    <div className={className} data-streamkit="code-block" data-streaming={isStreaming || undefined}>
      <div data-streamkit="code-block-header">
        <span data-streamkit="code-block-language">{resolvedLanguage ?? "text"}</span>
        <button
          type="button"
          data-streamkit="code-block-copy"
          onClick={handleCopy}
          disabled={isStreaming}
          aria-label={copied ? "Copied" : "Copy code"}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre data-streamkit="code-block-pre">
        <code
          data-streamkit="code-block-code"
          className={resolvedLanguage ? `language-${resolvedLanguage}` : undefined}
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: highlightedHtml || escapeHtml(code) }}
        />
      </pre>
    </div>
  );
}

function sanitize(html: string): string {
  // highlight.js output is just <span class="hljs-*"> wrappers around
  // escaped text, but sanitizing anyway is a near-zero-cost safety net —
  // the same "never trust LLM-influenced content into innerHTML" principle
  // from StreamingMarkdown applies here too, since the source code itself
  // is the streamed content.
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ["span"],
    ALLOWED_ATTR: ["class"],
  });
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
