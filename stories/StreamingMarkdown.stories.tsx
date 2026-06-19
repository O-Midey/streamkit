import type { Meta, StoryObj } from "@storybook/react";
import { useState, useEffect } from "react";
import { StreamingMarkdown } from "../src/components/StreamingMarkdown";

const meta: Meta<typeof StreamingMarkdown> = {
  title: "streamkit-ui/StreamingMarkdown",
  component: StreamingMarkdown,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component: "Renders markdown incrementally without re-rendering stable earlier blocks on every chunk. Uses marked's block-level lexer to identify sealed tokens, then memoizes each block on its raw content.",
      },
    },
  },
};
export default meta;
type Story = StoryObj<typeof StreamingMarkdown>;

const FULL_TEXT = `## How async/await works in JavaScript

Async functions always return a **Promise**, even if you don't explicitly return one. Under the hood, \`await\` pauses execution of the current function and yields control back to the event loop — it doesn't block the thread.

\`\`\`javascript
async function fetchUser(id) {
  const response = await fetch(\`/api/users/\${id}\`);
  if (!response.ok) throw new Error(\`HTTP \${response.status}\`);
  return response.json();
}
\`\`\`

Key things to remember:
- **\`await\` only pauses the enclosing async function**, not the whole program
- Unhandled promise rejections will crash your app in Node.js 15+
- \`Promise.all()\` runs promises concurrently — use it when tasks are independent`;

export const Static: Story = {
  args: { text: FULL_TEXT, isStreaming: false },
};

export const WithCursor: Story = {
  args: { text: "I'm still generating this response and more is coming", isStreaming: true, showCursor: true },
};

function LiveTyping() {
  const [text, setText] = useState("");
  const [streaming, setStreaming] = useState(false);

  const start = () => {
    setText("");
    setStreaming(true);
    let i = 0;
    const id = setInterval(() => {
      i += 3;
      setText(FULL_TEXT.slice(0, i));
      if (i >= FULL_TEXT.length) { clearInterval(id); setStreaming(false); }
    }, 40);
  };

  return (
    <div>
      <button onClick={start} disabled={streaming} style={{ marginBottom: 16, padding: "6px 14px", background: "var(--accent)", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontFamily: "var(--font-mono)", fontSize: 12 }}>
        {streaming ? "Streaming…" : "▶ Play"}
      </button>
      <StreamingMarkdown text={text} isStreaming={streaming} showCursor />
    </div>
  );
}

export const LiveTypingSimulation: Story = {
  render: () => <LiveTyping />,
  parameters: { docs: { description: { story: "Click Play to simulate a real LLM token stream. Sealed earlier blocks are not re-rendered as new blocks arrive — verify in React DevTools." } } },
};

export const WithXSSPayload: Story = {
  args: {
    text: 'Normal text and then <script>alert("xss")</script> an injection attempt and `inline code` too',
    isStreaming: false,
  },
  parameters: { docs: { description: { story: "DOMPurify sanitizes the rendered HTML — the script tag is stripped, the rest renders normally." } } },
};
