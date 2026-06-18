"use client";

import { useRef, useEffect } from "react";
import {
  useChatStream,
  StreamingMarkdown,
  StreamingCodeBlock,
  StreamStatus,
} from "streamkit";
import type {
  StreamChunk,
  StreamMessage,
  StreamSourceFactory,
} from "streamkit";

// Parse an ndjson response from /api/chat into a StreamSource.
// This is the "custom backend" adapter pattern: the server serializes
// StreamChunks as ndjson, we parse them back here and yield them from
// an AsyncGenerator — no vendor SDK needed on the client side.
function ndjsonStreamFactory(history: StreamMessage[]): StreamSourceFactory {
  return async function* (signal: AbortSignal) {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: history
          .filter(
            (m) =>
              (m.status === "done" && m.role !== "assistant") ||
              m.role === "user",
          )
          .map((m) => ({ role: m.role, text: m.text })),
      }),
      signal,
    });

    if (!response.ok || !response.body) {
      yield {
        type: "error",
        error: new Error(`HTTP ${response.status}`),
      } as StreamChunk;
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const chunk = JSON.parse(line) as StreamChunk;
          // Error chunks from the server carry a plain string message,
          // since Error objects aren't JSON-serializable — reconstruct.
          if (chunk.type === "error") {
            const msg =
              (chunk.error as unknown as { message?: string })?.message ??
              String(chunk.error);
            yield { type: "error", error: new Error(msg) };
          } else {
            yield chunk;
          }
        } catch {
          // Malformed line — skip without crashing the stream
        }
      }
    }
  };
}

// Simple inline code fence extractor — split an assistant message's text
// into alternating prose / code segments for rendering with the right component.
function parseSegments(
  text: string,
): Array<{ kind: "prose" | "code"; content: string; lang?: string }> {
  const segments: Array<{
    kind: "prose" | "code";
    content: string;
    lang?: string;
  }> = [];
  const fenceRe = /```(\w*)\n([\s\S]*?)(?:```|$)/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = fenceRe.exec(text)) !== null) {
    if (match.index > cursor) {
      segments.push({
        kind: "prose",
        content: text.slice(cursor, match.index),
      });
    }
    segments.push({
      kind: "code",
      content: match[2] ?? "",
      lang: match[1] || undefined,
    });
    cursor = match.index + match[0].length;
  }

  if (cursor < text.length) {
    segments.push({ kind: "prose", content: text.slice(cursor) });
  }

  return segments.length > 0 ? segments : [{ kind: "prose", content: text }];
}

export function Chat() {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const { messages, isStreaming, error, sendMessage, abort } = useChatStream({
    getAssistantStream: ndjsonStreamFactory,
  });

  // Auto-scroll to the latest message as it streams in
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSubmit = () => {
    const text = inputRef.current?.value.trim();
    if (!text || isStreaming) return;
    inputRef.current!.value = "";
    sendMessage(text);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="chat-root">
      <header className="chat-header">
        <div className="chat-title">
          <span className="chat-logo">streamkit</span>
          <span className="chat-badge">demo</span>
        </div>
        <StreamStatus
          status={
            isStreaming
              ? "streaming"
              : error
                ? "error"
                : messages.length > 0
                  ? "done"
                  : "idle"
          }
          error={error}
        />
      </header>

      <main className="chat-messages">
        {messages.length === 0 && (
          <div className="chat-empty">
            <p className="chat-empty-title">Start a conversation</p>
            <p className="chat-empty-hint">
              Try asking for code, markdown formatting, or a question that needs
              a tool call.
            </p>
            <div className="chat-suggestions">
              {[
                "Explain React Server Components with a code example",
                "What are the SOLID principles? Use markdown formatting",
                "Write a TypeScript utility type for deep partial objects",
              ].map((s) => (
                <button
                  key={s}
                  className="chat-suggestion"
                  onClick={() => {
                    if (inputRef.current) {
                      inputRef.current.value = s;
                    }
                    handleSubmit();
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <Message
            key={msg.id}
            message={msg}
            isStreaming={isStreaming && msg.status === "streaming"}
          />
        ))}

        {error && (
          <div className="chat-error" role="alert">
            <strong>Error:</strong> {error.message}
          </div>
        )}

        <div ref={bottomRef} />
      </main>

      <footer className="chat-input-area">
        <textarea
          ref={inputRef}
          className="chat-input"
          placeholder="Ask anything…"
          rows={1}
          onKeyDown={handleKeyDown}
          disabled={isStreaming}
        />
        <div className="chat-actions">
          {isStreaming ? (
            <button className="chat-btn chat-btn-stop" onClick={abort}>
              Stop
            </button>
          ) : (
            <button className="chat-btn chat-btn-send" onClick={handleSubmit}>
              Send
            </button>
          )}
        </div>
      </footer>
    </div>
  );
}

function Message({
  message,
  isStreaming,
}: {
  message: StreamMessage;
  isStreaming: boolean;
}) {
  if (message.role === "user") {
    return (
      <div className="message message-user">
        <div className="message-bubble">{message.text}</div>
      </div>
    );
  }

  const segments = parseSegments(message.text);
  const lastIdx = segments.length - 1;

  return (
    <div className="message message-assistant">
      <div className="message-avatar">AI</div>
      <div className="message-content">
        {message.toolCalls.length > 0 && (
          <div className="tool-calls">
            {message.toolCalls.map((tc) => (
              <div
                key={tc.toolCallId}
                className={`tool-call tool-call-${tc.status}`}
              >
                <span className="tool-call-name">⚙ {tc.toolName}</span>
                <span className="tool-call-status">{tc.status}</span>
              </div>
            ))}
          </div>
        )}
        {segments.map((seg, i) =>
          seg.kind === "code" ? (
            <StreamingCodeBlock
              key={i}
              code={seg.content}
              language={seg.lang}
              isStreaming={isStreaming && i === lastIdx}
            />
          ) : (
            <StreamingMarkdown
              key={i}
              text={seg.content}
              isStreaming={isStreaming && i === lastIdx}
              showCursor
            />
          ),
        )}
        {message.text === "" && isStreaming && (
          <span className="thinking">thinking…</span>
        )}
      </div>
    </div>
  );
}
