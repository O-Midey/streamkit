# StreamStatus

A small, composable indicator for stream lifecycle state. Default markup is intentionally minimal (a dot + label) so it doesn't fight your design system — or pass a render function for full control while still reusing the status→label mapping.

## Signature

```typescript
function StreamStatus(props: StreamStatusProps): JSX.Element
```

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `status` | `StreamStatusValue` | — | `"idle" \| "streaming" \| "done" \| "error" \| "aborted"`. |
| `error` | `Error \| null` | `null` | When `status` is `"error"`, its `message` becomes the label. |
| `children` | `(info) => ReactNode` | — | Headless render function receiving `{ status, label, error }`. Bypasses default markup. |
| `className` | `string` | — | Applied to the default `<span data-streamkit="stream-status">`. |

Default labels: `idle → "Idle"`, `streaming → "Thinking…"`, `done → "Done"`, `error → "Error"`, `aborted → "Stopped"`.

## Key design decisions

- **Headless escape hatch.** The `children` render function lets you reuse the status→label mapping without inheriting any forced styling — useful when your design system already has badge/spinner components.
- **Accessibility built in.** The default markup sets `role="alert"` on error and `role="status"` otherwise, so screen readers announce state changes appropriately.

## Example

Default markup:

```tsx
import { StreamStatus } from "streamkit";

<StreamStatus status={isStreaming ? "streaming" : "done"} error={error} />
```

Headless, with your own components:

```tsx
<StreamStatus status={status} error={error}>
  {({ status, label }) => (
    <MyBadge tone={status === "error" ? "danger" : "neutral"}>
      {status === "streaming" && <Spinner />}
      {label}
    </MyBadge>
  )}
</StreamStatus>
```
