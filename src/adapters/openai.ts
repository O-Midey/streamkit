import type { StreamChunk, StreamSource } from "../types";

/**
 * The subset of the openai SDK's ChatCompletionChunk shape this adapter
 * understands, typed loosely so consumers aren't forced onto a specific
 * openai package version as a hard dependency.
 *
 * VERIFIED AGAINST: openai package (installed) at
 * node_modules/openai/resources/chat/completions/completions.d.ts
 */
interface OpenAIChunk {
  choices: Array<{
    index: number;
    delta: {
      content?: string | null;
      tool_calls?: Array<{
        index: number;
        id?: string;
        type?: "function";
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
    finish_reason?: string | null;
  }>;
}

export interface OpenAIAdapterOptions {
  /**
   * An async-iterable of ChatCompletionChunk objects, i.e. the result of:
   *   `client.chat.completions.create({ ..., stream: true })`
   * The OpenAI SDK's stream object implements AsyncIterable<ChatCompletionChunk>
   * so it satisfies this type directly.
   */
  stream: AsyncIterable<OpenAIChunk>;
}

interface ToolCallTracker {
  toolCallId: string;
  toolName: string;
  argsBuffer: string;
}

/**
 * Adapts an OpenAI streaming chat completion into a streamkit StreamSource.
 *
 * KEY TRANSLATION DECISIONS:
 *
 * 1. OpenAI's streaming tool calls mirror Anthropic's structure but with
 *    different event shapes: instead of separate content_block_start/delta/
 *    stop events, each ChatCompletionChunk can carry a `delta.tool_calls`
 *    array. The first chunk for a given tool call index includes the `id`
 *    and `function.name`; subsequent chunks carry only partial
 *    `function.arguments` JSON fragments (same split-across-chunks problem
 *    as Anthropic). This adapter tracks per-index state in a Map and emits
 *    tool-call-start immediately when id+name are first seen, then
 *    tool-call-ready when `finish_reason === "tool_calls"` triggers a flush.
 *
 * 2. OpenAI has no explicit "stream done" event — completion is signaled by
 *    a chunk with `finish_reason` set to `"stop"`, `"tool_calls"`, etc.
 *    (not null). The adapter emits streamkit's `done` chunk on any non-null
 *    finish_reason on any choice.
 *
 * 3. `n > 1` (multiple choices) is not supported by this adapter — it
 *    processes only the first choice (index 0) per chunk, which covers the
 *    overwhelming majority of real usage. Supporting multiple simultaneous
 *    completions would require exposing a per-choice stream, which is a
 *    different use case better served by useStreamQueue.
 */
export function fromOpenAI(options: OpenAIAdapterOptions): StreamSource {
  const { stream } = options;

  return {
    async *[Symbol.asyncIterator](): AsyncIterator<StreamChunk> {
      // Per-tool-call-index state — same accumulate-then-parse discipline
      // as the Anthropic adapter, for the same reason: individual argument
      // fragments are not safely parseable as standalone JSON.
      const toolTrackers = new Map<number, ToolCallTracker>();

      for await (const chunk of stream) {
        // Only process choice at index 0 — see class doc for rationale.
        const choice = chunk.choices.find((c) => c.index === 0);
        if (!choice) continue;

        const { delta, finish_reason } = choice;

        // Text delta
        if (typeof delta.content === "string" && delta.content.length > 0) {
          yield { type: "text", delta: delta.content };
        }

        // Tool call deltas — may carry id+name (first chunk) and/or
        // partial arguments (any chunk including the first)
        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const existing = toolTrackers.get(tc.index);
            if (!existing) {
              // First chunk for this tool call index — id and name should
              // both be present here (OpenAI sends them on the first chunk)
              const id = tc.id;
              const name = tc.function?.name;
              if (id && name) {
                const tracker: ToolCallTracker = {
                  toolCallId: id,
                  toolName: name,
                  argsBuffer: tc.function?.arguments ?? "",
                };
                toolTrackers.set(tc.index, tracker);
                yield { type: "tool-call-start", toolCallId: id, toolName: name };
              }
              // If id or name is missing on the first chunk (edge case),
              // skip — we can't emit a meaningful start without both.
            } else {
              // Subsequent chunk — accumulate argument fragment only
              existing.argsBuffer += tc.function?.arguments ?? "";
            }
          }
        }

        // finish_reason signals stream completion
        if (finish_reason) {
          if (finish_reason === "tool_calls") {
            // Flush all accumulated tool calls as tool-call-ready before done
            for (const tracker of toolTrackers.values()) {
              let parsedArgs: unknown = {};
              try {
                parsedArgs = tracker.argsBuffer.length > 0 ? JSON.parse(tracker.argsBuffer) : {};
              } catch (err) {
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
                continue;
              }
              yield {
                type: "tool-call-ready",
                toolCallId: tracker.toolCallId,
                toolName: tracker.toolName,
                args: parsedArgs,
              };
            }
            toolTrackers.clear();
          }
          yield { type: "done", finishReason: finish_reason };
          return; // terminal
        }
      }
    },
  };
}
