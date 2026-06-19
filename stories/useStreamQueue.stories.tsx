import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { useStreamQueue } from "../src/hooks/useStreamQueue";
import { StreamStatus } from "../src/components/StreamStatus";
import type { StreamSourceFactory } from "../src/types";

const meta: Meta = {
  title: "streamkit-ui/useStreamQueue",
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "Runs multiple StreamSources concurrently under a shared ~30fps flush tick, with optional concurrency cap and admission control. Built for the dynamic case — an unknown number of streams enqueued over time.",
      },
    },
  },
};
export default meta;

const LOREM = [
  "Streaming ",
  "tokens ",
  "arrive ",
  "incrementally ",
  "and ",
  "are ",
  "batched ",
  "into ",
  "a ",
  "single ",
  "render ",
  "pass.",
];

/** A simulated stream that emits a label prefix then a few tokens. */
function makeSimulatedFactory(
  label: string,
  delayMs: number,
): StreamSourceFactory {
  return async function* (signal) {
    yield { type: "text", delta: `[${label}] ` };
    for (const word of LOREM) {
      await new Promise((r) => setTimeout(r, delayMs));
      if (signal.aborted) return;
      yield { type: "text", delta: word };
    }
    yield { type: "done" };
  };
}

const card: React.CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: 12,
  fontSize: 13,
  minHeight: 64,
};

const btn: React.CSSProperties = {
  padding: "6px 14px",
  background: "var(--accent)",
  color: "#fff",
  border: "none",
  borderRadius: 6,
  cursor: "pointer",
  fontFamily: "var(--font-mono)",
  fontSize: 12,
};

const btnGhost: React.CSSProperties = {
  ...btn,
  background: "var(--surface)",
  color: "var(--muted)",
  border: "1px solid var(--border)",
};

// ── Concurrent streams ──────────────────────────────────────────────────────

function ConcurrentDemo() {
  const { streams, enqueue, abortAll, isAnyActive } = useStreamQueue();

  const run = () => {
    // Three parallel streams at slightly different rates — they update
    // independently but flush together on one shared tick (one render pass).
    enqueue(makeSimulatedFactory("alpha", 90));
    enqueue(makeSimulatedFactory("beta", 140));
    enqueue(makeSimulatedFactory("gamma", 200));
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <p
        style={{
          fontSize: 12,
          color: "var(--muted)",
          fontFamily: "var(--font-mono)",
        }}
      >
        3 streams running concurrently — all flushed on one shared ~30fps tick.
      </p>
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={run} disabled={isAnyActive} style={btn}>
          ▶ Run 3 streams
        </button>
        {isAnyActive && (
          <button onClick={abortAll} style={btnGhost}>
            ■ Abort all
          </button>
        )}
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 12,
        }}
      >
        {streams.map((s) => (
          <div key={s.id} style={card}>
            <div style={{ marginBottom: 8 }}>
              <StreamStatus status={s.status} error={s.error} />
            </div>
            <div>{s.text}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export const ConcurrentStreams: StoryObj = {
  render: () => <ConcurrentDemo />,
  parameters: {
    docs: {
      description: {
        story:
          "Three simulated streams run in parallel at different token rates. With no concurrency cap, all start immediately; their independent updates still coalesce into a single render pass per shared tick.",
      },
    },
  },
};

// ── Concurrency cap / admission control ─────────────────────────────────────

function ConcurrencyCapDemo() {
  const [cap, setCap] = useState(2);
  const { streams, enqueue, abortAll, isAnyActive } = useStreamQueue({
    concurrency: cap,
  });

  const run = () => {
    // Enqueue 5 streams against a cap of `cap`. Only `cap` run at once; the
    // rest sit waiting (their factory isn't even invoked) until a slot frees.
    for (let i = 1; i <= 5; i++) {
      enqueue(makeSimulatedFactory(`task-${i}`, 160));
    }
  };

  const runningCount = streams.filter((s) => s.status === "streaming").length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <p
        style={{
          fontSize: 12,
          color: "var(--muted)",
          fontFamily: "var(--font-mono)",
        }}
      >
        5 streams, concurrency cap = {cap}. Waiting streams show as “Idle” until
        a slot frees — their factory isn’t invoked while pending, so a
        rate-limited backend never sees more than {cap} in flight.
      </p>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button onClick={run} disabled={isAnyActive} style={btn}>
          ▶ Enqueue 5 (cap {cap})
        </button>
        {isAnyActive && (
          <button onClick={abortAll} style={btnGhost}>
            ■ Abort all
          </button>
        )}
        <label
          style={{
            fontSize: 12,
            color: "var(--muted)",
            fontFamily: "var(--font-mono)",
            marginLeft: "auto",
          }}
        >
          cap:{" "}
          <select
            value={cap}
            disabled={isAnyActive}
            onChange={(e) => setCap(Number(e.target.value))}
            style={{
              background: "var(--surface)",
              color: "var(--text)",
              border: "1px solid var(--border)",
              borderRadius: 4,
              padding: "2px 6px",
            }}
          >
            <option value={1}>1</option>
            <option value={2}>2</option>
            <option value={3}>3</option>
          </select>
        </label>
        <span
          style={{
            fontSize: 12,
            color: "var(--muted)",
            fontFamily: "var(--font-mono)",
          }}
        >
          running: {runningCount}/{cap}
        </span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {streams.map((s) => (
          <div
            key={s.id}
            style={{
              ...card,
              minHeight: 0,
              display: "flex",
              gap: 12,
              alignItems: "center",
            }}
          >
            <div style={{ minWidth: 90 }}>
              <StreamStatus status={s.status} error={s.error} />
            </div>
            <div
              style={{
                color: "var(--muted)",
                fontFamily: "var(--font-mono)",
                fontSize: 12,
              }}
            >
              {s.text || "— waiting for a slot —"}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export const ConcurrencyCap: StoryObj = {
  render: () => <ConcurrencyCapDemo />,
  parameters: {
    docs: {
      description: {
        story:
          "Five streams enqueued against a cap of 2 (adjustable). At most `cap` run at once; the rest wait without their factory being invoked, then promote as slots free. This is admission control, not just rendering — it bounds in-flight requests to the backend.",
      },
    },
  },
};
