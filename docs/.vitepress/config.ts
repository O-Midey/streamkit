import { defineConfig } from "vitepress";

export default defineConfig({
  title: "streamkit-ui",
  description: "Rendering and state primitives for streaming LLM UI",
  base: "/",
  themeConfig: {
    logo: { text: "streamkit-ui" },
    nav: [
      { text: "Guide", link: "/guide/why" },
      { text: "API", link: "/hooks/useTokenStream" },
      { text: "GitHub", link: "https://github.com/O-Midey/streamkit" },
    ],
    sidebar: [
      {
        text: "Guide",
        items: [
          { text: "Why streamkit", link: "/guide/why" },
          { text: "Installation", link: "/guide/installation" },
          { text: "Architecture", link: "/guide/architecture" },
          { text: "Quick start", link: "/guide/quickstart" },
        ],
      },
      {
        text: "Hooks",
        items: [
          { text: "useTokenStream", link: "/hooks/useTokenStream" },
          { text: "useToolCallState", link: "/hooks/useToolCallState" },
          { text: "useChatStream", link: "/hooks/useChatStream" },
          { text: "useStreamQueue", link: "/hooks/useStreamQueue" },
          { text: "createResumableStream", link: "/hooks/createResumableStream" },
        ],
      },
      {
        text: "Components",
        items: [
          { text: "StreamingMarkdown", link: "/components/StreamingMarkdown" },
          { text: "StreamingCodeBlock", link: "/components/StreamingCodeBlock" },
          { text: "StreamStatus", link: "/components/StreamStatus" },
        ],
      },
      {
        text: "Adapters",
        items: [
          { text: "Vercel AI SDK", link: "/adapters/vercel-ai-sdk" },
          { text: "Anthropic", link: "/adapters/anthropic" },
          { text: "OpenAI", link: "/adapters/openai" },
          { text: "Custom backend", link: "/adapters/custom" },
        ],
      },
    ],
    socialLinks: [{ icon: "github", link: "https://github.com/O-Midey/streamkit" }],
    footer: { message: "MIT License" },
  },
});
