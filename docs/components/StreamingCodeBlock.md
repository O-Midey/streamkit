# StreamingCodeBlock

Renders a syntax-highlighted code block that updates incrementally as code streams in — **debouncing** the highlight pass so it doesn't re-tokenize and re-paint on every character. Includes a copy button and sanitizes highlighter output.

## Signature

```typescript
function StreamingCodeBlock(props: StreamingCodeBlockProps): JSX.Element
```

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `code` | `string` | — | The code accumulated so far. |
| `language` | `string` | — | Fence language tag (e.g. `"ts"`, `"python"`). Falls back to auto-detection if unrecognized. |
| `isStreaming` | `boolean` | `false` | Disables the copy button and shows a subtle pulse while true. |
| `debounceMs` | `number` | `80` | Window between re-highlight passes while streaming. `0` highlights every render (rarely wanted). |
| `onCopy` | `() => void` | — | Called after a successful copy. |
| `className` | `string` | — | Applied to the wrapping `<div data-streamkit="code-block">`. |

## Key design decisions

- **Debounce, don't partition.** Unlike markdown, a code block has no "sealed block" boundary mid-snippet — an early `{` isn't safely highlightable without the matching `}` that hasn't arrived. So the strategy is debouncing the full-string highlight pass, not structurally splitting content. Highlighting is expensive relative to the token append rate, and `80ms` coalesces bursts while still feeling live.
- **highlight.js over shiki.** shiki is more accurate via TextMate grammars but assumes complete, well-formed source. highlight.js is built to tolerate arbitrary, possibly-malformed snippets — exactly the shape of mid-stream code (an unclosed string, an unfinished bracket) — degrading to best-effort output instead of throwing.
- **Language fallback as last resort.** A model's fence tag may be hallucinated, unusual, or absent. If the declared language isn't registered, the component falls back to `highlightAuto` — but only then, since auto-detection on short/incomplete snippets often guesses wrong.
- **A final non-debounced pass** runs once streaming ends, so the rendered state isn't left on a stale debounced pass that never fired for the last few characters.
- **Sanitized output.** highlight.js output is escaped `<span>` wrappers, but it's still run through DOMPurify — the same "never trust streamed content into innerHTML" principle applies, since the code itself is the streamed content.

## Example

```tsx
import { StreamingCodeBlock } from "streamkit";

function CodeSnippet({ code, lang, streaming }) {
  return (
    <StreamingCodeBlock
      code={code}
      language={lang}
      isStreaming={streaming}
      onCopy={() => console.log("copied")}
    />
  );
}
```
