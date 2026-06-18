import type { Preview } from "@storybook/react";

const preview: Preview = {
  parameters: {
    backgrounds: {
      default: "dark",
      values: [
        { name: "dark", value: "#0f1117" },
        { name: "light", value: "#ffffff" },
      ],
    },
    docs: { theme: undefined },
  },
  decorators: [
    (Story) => (
      <div style={{ padding: "24px", fontFamily: "system-ui, sans-serif" }}>
        <style>{`
          :root {
            --bg: #0f1117; --surface: #1a1d27; --border: #2a2d3a;
            --text: #e2e4ed; --muted: #6b7280; --accent: #7c6af7;
            --accent-dim: rgba(124,106,247,0.15); --success: #34d399;
            --error: #f87171; --radius: 8px;
            --font-mono: "JetBrains Mono", ui-monospace, monospace;
          }
          body { background: var(--bg); color: var(--text); }
          [data-streamkit="stream-status"] { display:inline-flex; align-items:center; gap:6px; font-size:12px; color:var(--muted); font-family:var(--font-mono); }
          [data-streamkit="stream-status-dot"] { width:7px; height:7px; border-radius:50%; background:var(--muted); }
          [data-streamkit="stream-status"][data-status="streaming"] [data-streamkit="stream-status-dot"] { background:var(--accent); animation:pulse 1.2s ease-in-out infinite; }
          [data-streamkit="stream-status"][data-status="done"] [data-streamkit="stream-status-dot"] { background:var(--success); }
          [data-streamkit="stream-status"][data-status="error"] [data-streamkit="stream-status-dot"] { background:var(--error); }
          @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
          [data-streamkit="markdown"] { line-height:1.7; }
          [data-streamkit="markdown"] p+p { margin-top:0.75em; }
          [data-streamkit="markdown"] code { font-family:var(--font-mono); font-size:.88em; background:var(--surface); border:1px solid var(--border); border-radius:4px; padding:1px 5px; }
          .streamkit-cursor { display:inline-block; width:.55em; height:1.1em; background:var(--accent); vertical-align:text-bottom; animation:blink .9s step-end infinite; border-radius:1px; }
          @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }
          [data-streamkit="code-block"] { border:1px solid var(--border); border-radius:var(--radius); overflow:hidden; background:var(--surface); }
          [data-streamkit="code-block-header"] { display:flex; align-items:center; justify-content:space-between; padding:6px 12px; background:rgba(255,255,255,.03); border-bottom:1px solid var(--border); }
          [data-streamkit="code-block-language"] { font-family:var(--font-mono); font-size:11px; color:var(--muted); }
          [data-streamkit="code-block-copy"] { font-family:var(--font-mono); font-size:11px; color:var(--muted); background:none; border:none; cursor:pointer; padding:2px 6px; border-radius:4px; }
          [data-streamkit="code-block-copy"]:hover:not(:disabled) { color:var(--text); background:var(--accent-dim); }
          [data-streamkit="code-block-copy"]:disabled { opacity:.4; cursor:not-allowed; }
          [data-streamkit="code-block-pre"] { padding:14px 16px; overflow-x:auto; }
          [data-streamkit="code-block-code"] { font-family:var(--font-mono); font-size:13px; line-height:1.6; white-space:pre; }
          .hljs-keyword,.hljs-selector-tag{color:#c792ea}
          .hljs-string,.hljs-attr{color:#c3e88d}
          .hljs-number{color:#f78c6c}
          .hljs-comment{color:#546e7a;font-style:italic}
          .hljs-title,.hljs-title.function_{color:#82aaff}
          .hljs-operator{color:#89ddff}
        `}</style>
        <Story />
      </div>
    ),
  ],
};

export default preview;
