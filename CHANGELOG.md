# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 0.1.0 — Initial release

First public release.

### Hooks

- `useTokenStream` — consume a `StreamSource` with ~30fps backpressure batching, abort correctness, and `streamKey`-driven restarts.
- `useToolCallState` — tool-execution registry with idempotent registration, abort-on-unmount, and bounded history.
- `useChatStream` — multi-turn message-list reducer composing the above, handling interleaved text and tool calls.
- `useStreamQueue` — run N concurrent streams under a shared flush tick with optional concurrency cap / admission control.
- `createResumableStream` — retry-with-resume-context wrapper around a stream factory.

### Components

- `StreamingMarkdown` — incremental, block-memoized markdown rendering, DOMPurify-sanitized at the injection boundary.
- `StreamingCodeBlock` — debounced syntax highlighting (highlight.js) with a copy button, sanitized output.
- `StreamStatus` — headless-capable stream lifecycle indicator.

### Adapters

- `streamkit-ui/adapters/vercel-ai-sdk` — `fromVercelAISDK`
- `streamkit-ui/adapters/openai` — `fromOpenAI`
- `streamkit-ui/adapters/anthropic` — `fromAnthropic`

All adapters normalize vendor stream shapes into a single `StreamChunk` type; the
library carries no LLM SDK as a runtime dependency.
