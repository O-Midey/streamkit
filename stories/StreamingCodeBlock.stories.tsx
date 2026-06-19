import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { StreamingCodeBlock } from "../src/components/StreamingCodeBlock";

const meta: Meta<typeof StreamingCodeBlock> = {
  title: "streamkit-ui/StreamingCodeBlock",
  component: StreamingCodeBlock,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component: "Syntax-highlighted code block that re-highlights incrementally as tokens stream in, debounced to avoid re-highlighting on every single character. Uses highlight.js which tolerates incomplete/unterminated code without throwing.",
      },
    },
  },
};
export default meta;
type Story = StoryObj<typeof StreamingCodeBlock>;

const TS_CODE = `interface StreamOptions<T> {
  source: AsyncIterable<T>;
  onChunk?: (chunk: T) => void;
  signal?: AbortSignal;
}

async function* processStream<T>(
  options: StreamOptions<T>
): AsyncGenerator<T> {
  const { source, onChunk, signal } = options;
  for await (const chunk of source) {
    if (signal?.aborted) return;
    onChunk?.(chunk);
    yield chunk;
  }
}`;

const PY_CODE = `from anthropic import Anthropic

client = Anthropic()

with client.messages.stream(
    model="claude-opus-4-6",
    max_tokens=1024,
    messages=[{"role": "user", "content": "Hello!"}],
) as stream:
    for text in stream.text_stream:
        print(text, end="", flush=True)`;

const BASH_CODE = `# Install streamkit and adapters
npm install streamkit-ui

# Set up your API key
export ANTHROPIC_API_KEY="your_key_here"

# Run the example app
cd examples/next-app
npm install && npm run dev`;

export const TypeScript: Story = { args: { code: TS_CODE, language: "typescript", isStreaming: false } };
export const Python: Story = { args: { code: PY_CODE, language: "python", isStreaming: false } };
export const Bash: Story = { args: { code: BASH_CODE, language: "bash", isStreaming: false } };

export const IncompleteCode: Story = {
  args: {
    code: "function greet(name) {\n  const msg = `Hello ${name",
    language: "javascript",
    isStreaming: true,
  },
  parameters: { docs: { description: { story: "highlight.js handles unterminated code gracefully rather than throwing — it produces best-effort output on the partial content, which is exactly right for streaming." } } },
};

function LiveTyping({ code, lang }: { code: string; lang: string }) {
  const [text, setText] = useState("");
  const [streaming, setStreaming] = useState(false);

  const start = () => {
    setText("");
    setStreaming(true);
    let i = 0;
    const id = setInterval(() => {
      i += 4;
      setText(code.slice(0, i));
      if (i >= code.length) { clearInterval(id); setStreaming(false); }
    }, 50);
  };

  return (
    <div>
      <button onClick={start} disabled={streaming} style={{ marginBottom: 12, padding: "6px 14px", background: "var(--accent)", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontFamily: "var(--font-mono)", fontSize: 12 }}>
        {streaming ? "Streaming…" : "▶ Play"}
      </button>
      <StreamingCodeBlock code={text} language={lang} isStreaming={streaming} debounceMs={80} />
    </div>
  );
}

export const LiveTypingTypeScript: Story = {
  render: () => <LiveTyping code={TS_CODE} lang="typescript" />,
  parameters: { docs: { description: { story: "Debounced re-highlighting: rapid token bursts are coalesced into a single highlight pass instead of one per character." } } },
};

export const UnknownLanguage: Story = {
  args: { code: "SELECT * FROM users WHERE active = true LIMIT 10;", language: "somethingweird", isStreaming: false },
  parameters: { docs: { description: { story: "Falls back to highlight.js auto-detection when the declared language is unrecognized, rather than leaving the block unstyled." } } },
};
