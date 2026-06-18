import type { StreamChunk, StreamSource } from "../types";

/**
 * The subset of Vercel AI SDK v6's TextStreamPart shape this adapter
 * understands, typed loosely (rather than importing `ai` as a hard
 * dependency) so consumers aren't forced onto a specific `ai` version.
 *
 * VERIFIED AGAINST: the actual installed `ai@6.0.208` package's type
 * definitions (node_modules/ai/dist/index.d.ts), not documentation or
 * blog posts — the SDK's chunk shape has changed across versions in ways
 * that scattered online examples don't agree on (e.g. `textDelta` was
 * renamed to `text` on the `text-delta` part at some point; tool call
 * fields differ between major versions). Pin this against your installed
 * `ai` version if you're not on v6, and adjust accordingly.
 */
interface VercelTextStreamPart {
  type: string;
  // text-delta
  text?: string;
  // tool-call (already-complete call by the time it appears in fullStream)
  toolCallId?: string;
  toolName?: string;
  input?: unknown;
  // tool-result
  output?: unknown;
  // tool-error
  error?: unknown;
  // finish/abort
  finishReason?: string;
}

export interface VercelAISDKAdapterOptions {
  /**
   * The fullStream from a Vercel AI SDK streamText() result, i.e.
   * `result.fullStream`. Must be an AsyncIterable of TextStreamPart.
   */
  fullStream: AsyncIterable<VercelTextStreamPart>;
}

/**
 * Adapts a Vercel AI SDK `streamText()` result's `fullStream` into a
 * streamkit StreamSource.
 *
 * KEY TRANSLATION DECISIONS:
 *
 * 1. Vercel's fullStream emits a single complete `tool-call` event (with
 *    `input` already fully parsed) rather than a separate
 *    start/delta/ready sequence — there's no "args are still streaming in"
 *    phase exposed at this level (that exists at the lower-level
 *    `tool-input-delta` part, which carries raw partial JSON text, not
 *    something safe to treat as a meaningfully-parseable partial value).
 *    This adapter therefore emits BOTH a synthetic `tool-call-start` and
 *    an immediate `tool-call-ready` for each Vercel `tool-call` part, so
 *    streamkit's tool-call state machine (which expects a start before a
 *    ready) sees a consistent sequence — just with the pending/start phase
 *    being effectively instantaneous rather than gradual, since Vercel's
 *    fullStream doesn't expose meaningful intermediate state here.
 *
 * 2. Vercel's `tool-result` part is translated straight to streamkit's
 *    `tool-result`; `tool-error` is translated to a `tool-result` with
 *    `isError: true` (streamkit doesn't have a separate tool-error chunk
 *    type — execution failure is just a result variant — see types.ts).
 *
 * 3. `finish`/`abort` map to streamkit's `done`; a top-level `error` part
 *    maps to streamkit's `error`. All other Vercel part types not
 *    meaningful to streamkit's primitives (reasoning, source, file,
 *    start-step, finish-step, raw, etc.) are silently dropped — streamkit
 *    is a rendering/state layer for text + tool calls, not a full
 *    reimplementation of every Vercel AI SDK feature.
 */
export function fromVercelAISDK(options: VercelAISDKAdapterOptions): StreamSource {
  const { fullStream } = options;

  return {
    async *[Symbol.asyncIterator](): AsyncIterator<StreamChunk> {
      for await (const part of fullStream) {
        switch (part.type) {
          case "text-delta": {
            if (typeof part.text === "string" && part.text.length > 0) {
              yield { type: "text", delta: part.text };
            }
            break;
          }
          case "tool-call": {
            if (part.toolCallId && part.toolName) {
              yield { type: "tool-call-start", toolCallId: part.toolCallId, toolName: part.toolName };
              yield {
                type: "tool-call-ready",
                toolCallId: part.toolCallId,
                toolName: part.toolName,
                args: part.input,
              };
            }
            break;
          }
          case "tool-result": {
            if (part.toolCallId) {
              yield { type: "tool-result", toolCallId: part.toolCallId, result: part.output };
            }
            break;
          }
          case "tool-error": {
            if (part.toolCallId) {
              yield {
                type: "tool-result",
                toolCallId: part.toolCallId,
                result: part.error,
                isError: true,
              };
            }
            break;
          }
          case "error": {
            const err = part.error instanceof Error ? part.error : new Error(String(part.error ?? "Unknown stream error"));
            yield { type: "error", error: err };
            return; // terminal
          }
          case "finish": {
            yield { type: "done", finishReason: part.finishReason };
            return; // terminal
          }
          case "abort": {
            // An abort here means the SDK itself ended the stream (e.g. a
            // stop condition fired) — distinct from the consumer calling
            // AbortController.abort(), which the consuming useTokenStream
            // handles separately via its own signal check. We surface this
            // as `done` since, from streamkit's perspective, the stream
            // simply ended; there's nothing erroneous about a deliberate
            // stop condition.
            yield { type: "done", finishReason: "aborted" };
            return;
          }
          default:
            // Intentionally ignored: reasoning-*, source, file, start,
            // start-step, finish-step, tool-input-start/delta/end, raw,
            // tool-output-denied, tool-approval-request. See class doc.
            break;
        }
      }
    },
  };
}
