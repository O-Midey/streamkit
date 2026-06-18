import type { Meta, StoryObj } from "@storybook/react";
import { useState, useRef } from "react";
import { useTokenStream } from "../src/hooks/useTokenStream";
import { StreamStatus } from "../src/components/StreamStatus";
import { StreamingMarkdown } from "../src/components/StreamingMarkdown";
import type { StreamSourceFactory } from "../src/types";

const meta: Meta = {
  title: "streamkit/useTokenStream",
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component: "The foundational hook. Consumes any StreamSource and exposes accumulated text, tool-call state, and lifecycle status. Backpressure-safe (~30fps flush), abort-correct, and streamKey-driven to avoid the inline-factory-footgun.",
      },
    },
  },
};
export default meta;

const CHUNKS = [
  "The key insight about ",
  "**React's reconciler** is that ",
  "it doesn't compare DOM nodes directly — it compares ",
  "a *virtual* representation and computes the minimal ",
  "set of actual DOM mutations needed.\n\n",
  "This is why `key` props matter so much: they're the ",
  "reconciler's primary signal for whether an element ",
  "is the **same logical thing** across renders.",
];

function makeSimulatedFactory(chunks: string[], delayMs = 120): StreamSourceFactory {
  return async function* (_signal) {
    for (const delta of chunks) {
      await new Promise((r) => setTimeout(r, delayMs));
      yield { type: "text", delta };
    }
    yield { type: "done" };
  };
}

function TokenStreamDemo() {
  const [streamKey, setStreamKey] = useState(0);
  const factory = useRef(makeSimulatedFactory(CHUNKS)).current;

  const { text, status, error, abort, restart } = useTokenStream(factory, {
    streamKey,
    autoStart: streamKey > 0,
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <button onClick={() => setStreamKey((k) => k + 1)} disabled={status === "streaming"} style={{ padding: "6px 14px", background: "var(--accent)", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontFamily: "var(--font-mono)", fontSize: 12 }}>
          ▶ Start stream
        </button>
        <button onClick={abort} disabled={status !== "streaming"} style={{ padding: "6px 14px", background: "var(--surface)", color: "var(--muted)", border: "1px solid var(--border)", borderRadius: 6, cursor: "pointer", fontFamily: "var(--font-mono)", fontSize: 12 }}>
          ■ Abort
        </button>
        <StreamStatus status={status} error={error} />
      </div>
      {text && (
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: 16 }}>
          <StreamingMarkdown text={text} isStreaming={status === "streaming"} showCursor />
        </div>
      )}
    </div>
  );
}

export const Interactive: StoryObj = {
  render: () => <TokenStreamDemo />,
  parameters: {
    docs: {
      description: {
        story: "Click 'Start stream' to run a simulated token stream. 'Abort' mid-stream to verify abort semantics — the component stays stable with whatever text arrived before the abort.",
      },
    },
  },
};

function SlowBurstDemo() {
  const [streamKey, setStreamKey] = useState(0);
  const BURST = Array.from({ length: 50 }, (_, i) => `token_${i} `);
  const factory = useRef(makeSimulatedFactory(BURST, 15)).current;

  const { text, status } = useTokenStream(factory, {
    streamKey,
    autoStart: streamKey > 0,
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <p style={{ fontSize: 12, color: "var(--muted)", fontFamily: "var(--font-mono)" }}>
        50 tokens at 15ms intervals — batched to ~30fps, not one re-render per token
      </p>
      <button onClick={() => setStreamKey((k) => k + 1)} disabled={status === "streaming"} style={{ alignSelf: "flex-start", padding: "6px 14px", background: "var(--accent)", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontFamily: "var(--font-mono)", fontSize: 12 }}>
        ▶ Run burst
      </button>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--text)", minHeight: 40 }}>
        {text}
      </div>
      <StreamStatus status={status} />
    </div>
  );
}

export const BackpressureBatching: StoryObj = {
  render: () => <SlowBurstDemo />,
  parameters: {
    docs: {
      description: {
        story: "50 rapid tokens coalesced into ~30fps React state updates. Open React DevTools Profiler to verify — you should see far fewer renders than tokens.",
      },
    },
  },
};
