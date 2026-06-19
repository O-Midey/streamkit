---
layout: home

hero:
  name: streamkit
  text: Rendering and state primitives for streaming LLM UI
  tagline: Token streaming, incremental markdown, tool-call state machines, and multi-stream orchestration — vendor-agnostic.
  actions:
    - theme: brand
      text: Why streamkit
      link: /guide/why
    - theme: alt
      text: Quick start
      link: /guide/quickstart
    - theme: alt
      text: GitHub
      link: https://github.com/O-Midey/streamkit

features:
  - title: Vendor-agnostic
    details: Hooks and components only ever see one normalized `StreamChunk` type. Adapters translate Vercel AI SDK, OpenAI, and Anthropic streams — switch providers without touching UI code.
  - title: Production-safe
    details: Markdown and code render through DOMPurify at the injection boundary, so LLM output carrying script tags or prompt-injection payloads can't reach the DOM unsanitized. Abort-correct and backpressure-batched by default.
  - title: Composable
    details: Small primitives that build on each other — useTokenStream → useToolCallState → useChatStream → useStreamQueue. Use the high-level hook or drop down to the one beneath it.
---

## Install

```bash
npm install streamkit-ui
```

```tsx
import { useChatStream, StreamingMarkdown, StreamStatus } from "streamkit-ui";
import { fromAnthropic } from "streamkit-ui/adapters/anthropic";
```

Start with the [guide](/guide/why) for the design rationale, or jump to the [quick start](/guide/quickstart) to wire it up.
