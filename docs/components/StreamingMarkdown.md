# StreamingMarkdown

Renders markdown incrementally as it streams in, **without** the flicker of naively re-parsing and re-rendering the entire document on every chunk. Sanitizes through DOMPurify at the injection boundary, so LLM output is never trusted into the DOM.

## Signature

```typescript
function StreamingMarkdown(props: StreamingMarkdownProps): JSX.Element
```

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `text` | `string` | — | The full markdown accumulated so far (e.g. `useTokenStream`'s `text`). |
| `isStreaming` | `boolean` | `false` | Whether the stream is in progress — controls the trailing cursor. |
| `showCursor` | `boolean` | `true` | Render a blinking cursor after the last block while streaming. |
| `className` | `string` | — | Applied to the wrapping `<div data-streamkit="markdown">`. |

## Key design decisions

- **Block-level memoization.** Markdown block tokens (paragraphs, headings, list items, code fences) don't retroactively change once a *later* block has started. The component re-lexes the full text on every update (cheap) into block tokens, then renders each through a memoized subcomponent keyed on **raw content** — so React skips re-rendering any sealed block, and only the currently-growing trailing block re-renders per chunk.
- **Memoize on `token.raw`, not identity.** `marked.lexer()` returns fresh token objects every parse even when text is unchanged; comparing `token.raw` is what actually lets React skip sealed blocks.
- **Sanitize at the boundary.** Markdown from LLM output is untrusted — it can carry script tags or prompt-injection payloads via tool results or retrieved documents. DOMPurify runs with an explicit tag/attribute allowlist immediately before `dangerouslySetInnerHTML`, so it can't be bypassed by a caller forgetting to sanitize upstream.
- **The trailing block stays "live."** A block is sealed only once a later block exists, so an unterminated code fence or unclosed emphasis keeps rendering correctly as it grows.

## Example

```tsx
import { useTokenStream, StreamingMarkdown } from "streamkit";

function Answer({ factory }) {
  const { text, status } = useTokenStream(factory);
  return (
    <StreamingMarkdown
      text={text}
      isStreaming={status === "streaming"}
      showCursor
    />
  );
}
```

> Styling: blocks render as `<span data-streamkit="markdown-block" data-block-type="...">`, and the cursor as `<span class="streamkit-cursor">`. Target these in your own CSS.
