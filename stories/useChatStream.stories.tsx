import type { Meta, StoryObj } from "@storybook/react";
import { useRef, useState } from "react";
import { useChatStream } from "../src/hooks/useChatStream";
import { StreamingMarkdown } from "../src/components/StreamingMarkdown";
import { StreamStatus } from "../src/components/StreamStatus";
import type { StreamMessage, StreamSourceFactory } from "../src/types";

const meta: Meta = {
  title: "streamkit/useChatStream",
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component: "Composes useTokenStream + useToolCallState into a multi-turn message-list reducer. Handles interleaved text and tool calls, multi-turn history, abort, and reset.",
      },
    },
  },
};
export default meta;

const CANNED_RESPONSES: Record<string, string> = {
  default: "That's a great question! Let me think through it carefully.\n\nThe key insight here is that **composition beats inheritance** in most cases. When you compose behaviors, you get:\n- Clearer boundaries between concerns\n- Easier unit testing\n- More flexible combination of behaviors at runtime",
  code: "Here's a clean TypeScript implementation:\n\n```typescript\ntype Result<T, E = Error> =\n  | { ok: true; value: T }\n  | { ok: false; error: E };\n\nfunction safeRun<T>(fn: () => T): Result<T> {\n  try {\n    return { ok: true, value: fn() };\n  } catch (error) {\n    return { ok: false, error: error as Error };\n  }\n}\n```\n\nThis pattern lets you handle errors without throwing, keeping your control flow explicit.",
};

function makeResponseFactory(text: string): StreamSourceFactory {
  return async function* (_signal) {
    const words = text.split(" ");
    for (const word of words) {
      await new Promise((r) => setTimeout(r, 60));
      yield { type: "text", delta: word + " " };
    }
    yield { type: "done" };
  };
}

function ChatDemo() {
  const inputRef = useRef<HTMLInputElement>(null);
  const turnRef = useRef(0);

  const { messages, isStreaming, error, sendMessage, abort, reset } = useChatStream({
    getAssistantStream: (_history: StreamMessage[]): StreamSourceFactory => {
      turnRef.current += 1;
      const last = _history.filter((m) => m.role === "user").pop();
      const isCodeQ = last?.text.toLowerCase().includes("code") || last?.text.toLowerCase().includes("typescript");
      return makeResponseFactory(isCodeQ ? CANNED_RESPONSES.code! : CANNED_RESPONSES.default!);
    },
  });

  const submit = () => {
    const text = inputRef.current?.value.trim();
    if (!text || isStreaming) return;
    inputRef.current!.value = "";
    sendMessage(text);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0, height: 480, border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
      <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--muted)" }}>useChatStream demo</span>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <StreamStatus status={isStreaming ? "streaming" : error ? "error" : "idle"} />
          <button onClick={reset} style={{ padding: "3px 8px", background: "none", border: "1px solid var(--border)", color: "var(--muted)", borderRadius: 4, cursor: "pointer", fontSize: 11, fontFamily: "var(--font-mono)" }}>reset</button>
        </div>
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
        {messages.length === 0 && (
          <p style={{ color: "var(--muted)", fontSize: 13, textAlign: "center", marginTop: 40 }}>
            Send a message to start. Try "Show me some TypeScript code" for code highlighting.
          </p>
        )}
        {messages.map((m) => (
          <div key={m.id} style={{ display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start" }}>
            {m.role === "user" ? (
              <div style={{ background: "var(--accent-dim)", border: "1px solid rgba(124,106,247,.2)", borderRadius: 8, padding: "8px 12px", maxWidth: "70%", fontSize: 13 }}>
                {m.text}
              </div>
            ) : (
              <div style={{ maxWidth: "85%", fontSize: 13 }}>
                <StreamingMarkdown text={m.text} isStreaming={isStreaming && m.status === "streaming"} showCursor />
              </div>
            )}
          </div>
        ))}
      </div>

      <div style={{ padding: "10px 12px", borderTop: "1px solid var(--border)", display: "flex", gap: 8 }}>
        <input
          ref={inputRef}
          placeholder="Type a message… (Enter to send)"
          disabled={isStreaming}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          style={{ flex: 1, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text)", padding: "8px 12px", fontSize: 13, fontFamily: "inherit" }}
        />
        {isStreaming
          ? <button onClick={abort} style={{ padding: "6px 12px", background: "none", border: "1px solid var(--border)", color: "var(--muted)", borderRadius: 6, cursor: "pointer", fontSize: 12, fontFamily: "var(--font-mono)" }}>stop</button>
          : <button onClick={submit} style={{ padding: "6px 12px", background: "var(--accent)", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 12, fontFamily: "var(--font-mono)" }}>send</button>
        }
      </div>
    </div>
  );
}

export const MultiTurnChat: StoryObj = {
  render: () => <ChatDemo />,
  parameters: {
    docs: {
      description: {
        story: "A working multi-turn chat using simulated streams. Each new message gets a fresh stream keyed by turn counter. Ask about TypeScript for code block highlighting.",
      },
    },
  },
};
