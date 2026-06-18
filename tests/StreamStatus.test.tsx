import { describe, it, expect } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import { StreamStatus } from "../src/components/StreamStatus";

afterEach(cleanup);

describe("StreamStatus", () => {
  it.each([
    ["idle", "Idle"],
    ["streaming", "Thinking…"],
    ["done", "Done"],
    ["aborted", "Stopped"],
  ] as const)("renders the default label for status=%s", (status, expectedLabel) => {
    const { getByText } = render(<StreamStatus status={status} />);
    expect(getByText(expectedLabel)).toBeInTheDocument();
  });

  it("renders the error message as the label when status is error", () => {
    const { getByText } = render(
      <StreamStatus status="error" error={new Error("rate limited")} />
    );
    expect(getByText("rate limited")).toBeInTheDocument();
  });

  it("falls back to the generic error label if status is error but no Error object is given", () => {
    const { getByText } = render(<StreamStatus status="error" />);
    expect(getByText("Error")).toBeInTheDocument();
  });

  it("uses role=alert for error status and role=status otherwise", () => {
    const { container: errContainer } = render(<StreamStatus status="error" />);
    expect(errContainer.querySelector('[role="alert"]')).not.toBeNull();

    const { container: streamingContainer } = render(<StreamStatus status="streaming" />);
    expect(streamingContainer.querySelector('[role="status"]')).not.toBeNull();
  });

  it("invokes the render-prop child instead of default markup when provided", () => {
    const { getByTestId, queryByText } = render(
      <StreamStatus status="streaming">
        {({ label }) => <div data-testid="custom">Custom: {label}</div>}
      </StreamStatus>
    );
    expect(getByTestId("custom").textContent).toBe("Custom: Thinking…");
    // Default markup's status-dot span should not be present at all.
    expect(queryByText("Thinking…", { selector: '[data-streamkit="stream-status-label"]' })).toBeNull();
  });
});
