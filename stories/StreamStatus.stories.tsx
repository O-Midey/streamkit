import type { Meta, StoryObj } from "@storybook/react";
import { StreamStatus } from "../src/components/StreamStatus";

const meta: Meta<typeof StreamStatus> = {
  title: "streamkit/StreamStatus",
  component: StreamStatus,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component: "A small composable lifecycle indicator for a stream. Default markup is intentionally minimal — use the render-prop `children` for full control while keeping the status-to-label mapping.",
      },
    },
  },
};
export default meta;
type Story = StoryObj<typeof StreamStatus>;

export const Idle: Story = { args: { status: "idle" } };
export const Streaming: Story = { args: { status: "streaming" } };
export const Done: Story = { args: { status: "done" } };
export const Aborted: Story = { args: { status: "aborted" } };
export const WithError: Story = {
  args: { status: "error", error: new Error("upstream 503") },
};

export const HeadlessRenderProp: Story = {
  args: { status: "streaming" },
  render: (args) => (
    <StreamStatus {...args}>
      {({ status, label }) => (
        <div style={{
          display: "inline-flex", alignItems: "center", gap: 8,
          background: "var(--surface)", border: "1px solid var(--border)",
          borderRadius: 6, padding: "4px 10px",
        }}>
          <span style={{
            width: 8, height: 8, borderRadius: "50%",
            background: status === "streaming" ? "var(--accent)" : status === "done" ? "var(--success)" : "var(--muted)",
          }} />
          <span style={{ fontSize: 12, fontFamily: "var(--font-mono)", color: "var(--text)" }}>
            {label}
          </span>
        </div>
      )}
    </StreamStatus>
  ),
};
