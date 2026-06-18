import type { StreamChunk, StreamSource } from "../types";

/**
 * The subset of @anthropic-ai/sdk's RawMessageStreamEvent shape this
 * adapter understands, typed loosely so consumers aren't forced onto a
 * specific SDK version as a hard dependency.
 *
 * VERIFIED AGAINST: the actual installed @anthropic-ai/sdk@0.104.2 type
 * definitions (node_modules/@anthropic-ai/sdk/resources/messages/messages.d.ts).
 */
interface AnthropicStreamEvent {
  type: string;
  index?: number;
  content_block?: { type: string; id?: string; name?: string; input?: unknown };
  delta?: { type: string; text?: string; partial_json?: string };
}

export interface AnthropicAdapterOptions {
  /** The async-iterable stream from `client.messages.stream(...)` or `await client.messages.create({ stream: true, ... })`. */
  stream: AsyncIterable<AnthropicStreamEvent>;
}

interface BlockTracker {
  type: "text" | "tool_use" | "other";
  toolCallId?: string;
  toolName?: string;
  /** Accumulated partial_json string for a tool_use block, parsed once content_block_stop fires. */
  jsonBuffer: string;
}

/**
 * Adapts an Anthropic Messages API raw stream into a streamkit StreamSource.
 *
 * THE REAL TRANSLATION WORK, AND WHY IT'S NONTRIVIAL: Anthropic's stream is
 * structured around content block INDEX, not a stable per-block id that
 * arrives upfront. A tool_use block's `content_block_start` event carries
 * an empty `input: {}` — the actual arguments arrive incrementally as a
 * SEPARATE event type, `content_block_delta` with `delta.type ===
 * 'input_json_delta'`, carrying a `partial_json` string FRAGMENT (not a
 * complete, parseable value) keyed only by `index`. The only safe way to
 * get a real, parseable args object is to accumulate every partial_json
 * fragment for that index and JSON.parse() the concatenated result once
 * `content_block_stop` fires for that index — attempting to parse any
 * individual delta is not reliable, since deltas can split a JSON token
 * (e.g. a string literal or number) across chunk boundaries.
 *
 * This adapter therefore maintains a small per-index state machine
 * (BlockTracker) for the duration of the stream: content_block_start opens
 * a tracker (and for tool_use, immediately yields streamkit's
 * tool-call-start), content_block_delta routes text deltas straight
 * through as streamkit text chunks, and routes input_json_delta fragments
 * into the tracker's buffer (yielding nothing yet — partial JSON isn't
 * safely exposable, consistent with streamkit's general stance on this,
 * see useTokenStream's tool-call-delta handling). content_block_stop is
 * where a tool_use block's buffered JSON is finally parsed and yielded as
 * tool-call-ready.
 */
export function fromAnthropic(options: AnthropicAdapterOptions): StreamSource {
  const { stream } = options;

  return {
    async *[Symbol.asyncIterator](): AsyncIterator<StreamChunk> {
      const trackers = new Map<number, BlockTracker>();

      for await (const event of stream) {
        switch (event.type) {
          case "content_block_start": {
            if (event.index === undefined || !event.content_block) break;
            const block = event.content_block;
            if (block.type === "text") {
              trackers.set(event.index, { type: "text", jsonBuffer: "" });
            } else if (block.type === "tool_use" && block.id && block.name) {
              trackers.set(event.index, {
                type: "tool_use",
                toolCallId: block.id,
                toolName: block.name,
                jsonBuffer: "",
              });
              yield { type: "tool-call-start", toolCallId: block.id, toolName: block.name };
            } else {
              // thinking, redacted_thinking, server tool results, etc. —
              // not meaningful to streamkit's text/tool-call primitives.
              trackers.set(event.index, { type: "other", jsonBuffer: "" });
            }
            break;
          }

          case "content_block_delta": {
            if (event.index === undefined || !event.delta) break;
            const tracker = trackers.get(event.index);
            if (!tracker) break;

            if (event.delta.type === "text_delta" && typeof event.delta.text === "string") {
              yield { type: "text", delta: event.delta.text };
            } else if (event.delta.type === "input_json_delta" && typeof event.delta.partial_json === "string") {
              // Accumulate only — see class doc on why a partial fragment
              // is never parsed or yielded on its own.
              tracker.jsonBuffer += event.delta.partial_json;
            }
            // citations_delta / thinking_delta / signature_delta intentionally ignored.
            break;
          }

          case "content_block_stop": {
            if (event.index === undefined) break;
            const tracker = trackers.get(event.index);
            if (tracker?.type === "tool_use" && tracker.toolCallId && tracker.toolName) {
              let parsedArgs: unknown = {};
              try {
                parsedArgs = tracker.jsonBuffer.length > 0 ? JSON.parse(tracker.jsonBuffer) : {};
              } catch (err) {
                // A malformed/truncated JSON buffer (e.g. the model emitted
                // invalid arguments, or the stream was cut mid-block) is a
                // real possibility, not a bug in this adapter — surface it
                // as a tool-result error rather than throwing and killing
                // the whole stream over one bad tool call.
                yield {
                  type: "tool-result",
                  toolCallId: tracker.toolCallId,
                  result: new Error(
                    `Failed to parse tool call arguments for "${tracker.toolName}": ${
                      err instanceof Error ? err.message : String(err)
                    }`
                  ),
                  isError: true,
                };
                trackers.delete(event.index);
                break;
              }
              yield {
                type: "tool-call-ready",
                toolCallId: tracker.toolCallId,
                toolName: tracker.toolName,
                args: parsedArgs,
              };
            }
            trackers.delete(event.index);
            break;
          }

          case "message_stop": {
            yield { type: "done" };
            return; // terminal
          }

          case "message_delta": {
            // Carries stop_reason/usage updates, not content — streamkit's
            // `done` chunk fires on message_stop instead, which is the
            // actual end of the event stream for a given message.
            break;
          }

          case "message_start":
          default:
            // message_start carries initial message metadata (id, model,
            // usage so far) — not meaningful to streamkit's primitives.
            break;
        }
      }
    },
  };
}
