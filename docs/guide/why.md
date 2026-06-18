# Why streamkit

Most code that renders streaming LLM responses looks the same: call `marked()` on the full text, inject it via `dangerouslySetInnerHTML`, re-render on every chunk. It works fine for short, fast responses. Under real conditions — longer responses, code blocks, tool calls, React DevTools open — it falls apart.

streamkit is the layer between a streaming LLM response and a production React UI.

## The problems it solves

**Flicker from full-document re-parsing.** Every chunk triggers a full `marked()` parse and a full React reconciliation of the rendered HTML. Earlier paragraphs — which haven't changed — get re-rendered on every token because there's no stable identity between renders. For a 2000-token response with rich markdown, this produces visible jank.

**Naive `dangerouslySetInnerHTML` without sanitization.** LLM output that passes through tool results, retrieved documents, or RAG context can carry attacker-controlled HTML. `<script>` injection, `onerror` attributes, `javascript:` links — these are real vectors in production AI apps, not theoretical. Most streaming implementations don't sanitize.

**No good state model for tool calls.** A model's streamed response isn't "text, then maybe a single tool call." It's interleaved: some text, a tool-call-start, argument deltas arriving mid-stream, more text, a result, a follow-up. Most hand-rolled implementations assume one or the other, or build a bespoke state machine that ties rendering to a specific SDK.

**Per-stream timer thrash.** If you call `useTokenStream` N times for N parallel tool results, each one runs its own `setInterval`. Two intervals firing a millisecond apart cause two separate React render passes. Under React 18 automatic batching, calls within the same synchronous callback are coalesced — but calls from *separate* macrotask callbacks are not.

**Vendor lock-in at the rendering layer.** Building your streaming UI directly against the Vercel AI SDK's chunk shape means a refactor to Anthropic's raw API (or vice versa) touches component code, not just the network layer.

## The design

streamkit defines a single wire type, `StreamChunk`, that every vendor-specific SDK output can be translated into. Adapters (for Vercel AI SDK, Anthropic, and OpenAI) do the translation work; hooks and components only ever see `StreamChunk`. The adapter pattern is not decorative — there are real, non-trivial differences in how each SDK's stream shapes tool-call argument delivery (all three split JSON across chunk boundaries; each uses different field names; the Anthropic adapter has to maintain a per-block-index state machine; the Vercel adapter has to emit a synthetic `start` event for each `tool-call` since v6's `fullStream` delivers completed calls rather than streaming them).

The rendering layer makes one claim per primitive and proves it with a test that exercises the claim directly: `StreamingMarkdown` verifies that a sealed block's DOM node is the same object reference after a new block arrives (React skipped it); `StreamingCodeBlock` verifies that a 5000ms debounce window is bypassed immediately when `isStreaming` flips false; `useStreamQueue` verifies that the third stream in a `concurrency: 2` queue's factory is never called until one of the first two finishes.

## What it is not

streamkit is not a chat UI, a model client, or an agent framework. It has no opinion on which model you use, how you authenticate, or what your tool implementations do. It's a thin primitives layer — a set of hooks and components that solve the rendering problems so your code can focus on the product problems.
