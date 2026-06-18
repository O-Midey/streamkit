import type { StreamChunk, StreamSource, StreamSourceFactory } from "../types";

export interface ResumeContext {
  /** Text accumulated from all attempts so far, across this and prior retries. */
  textSoFar: string;
  /** Which retry attempt this is (0 = first attempt, 1 = first retry, ...). */
  attempt: number;
}

export interface CreateResumableStreamOptions {
  /**
   * Given resume context, build the actual factory for this attempt. On the
   * first attempt, textSoFar is "". On a retry after a drop, your factory
   * implementation decides what to do with textSoFar:
   *  - If your backend supports resuming generation from an offset/cursor
   *    (e.g. "continue from here"), use textSoFar to construct that request
   *    and your stream only needs to emit the REMAINING text — this module
   *    handles concatenation either way (see below).
   *  - If your backend does not support resumption, ignore textSoFar and
   *    simply restart the full request; the consumer will see the stream
   *    reset (this module detects that the new stream doesn't pick up where
   *    the old one left off, by NOT assuming continuation — it only
   *    concatenates if you explicitly return chunks for the suffix; a full
   *    restart factory should just emit the full text again, which the
   *    consuming useTokenStream will treat as exactly that since streamKey
   *    changes on each restart at the call-site).
   */
  buildFactory: (ctx: ResumeContext) => StreamSourceFactory;
  /**
   * Decide whether a given error is worth retrying (e.g. network drop,
   * 5xx, timeout) versus a terminal error (e.g. 401, malformed request).
   * Default: retries any error EXCEPT one whose message contains "abort"
   * (so user-initiated aborts never trigger a retry).
   */
  shouldRetry?: (error: Error, attempt: number) => boolean;
  /** Max retry attempts after the initial try. Default 2 (so up to 3 total attempts). */
  maxRetries?: number;
  /** Delay before each retry, in ms. Receives the attempt number (1-indexed). Default: exponential backoff 500ms * 2^(attempt-1), capped at 4000ms. */
  retryDelayMs?: (attempt: number) => number;
  /** Called before each retry attempt, useful for logging/telemetry. */
  onRetry?: (error: Error, attempt: number) => void;
}

function defaultShouldRetry(error: Error): boolean {
  return !/abort/i.test(error.message);
}

function defaultRetryDelay(attempt: number): number {
  return Math.min(500 * 2 ** (attempt - 1), 4000);
}

/**
 * Wraps a stream-building function with automatic retry-with-resume-context
 * on transient failure.
 *
 * WHY THIS EXISTS, AND ITS HONEST LIMITS: true mid-stream resumption (continuing
 * generation from an exact token offset after a network drop) is backend-
 * specific — it requires the model provider's API to support a resume/cursor
 * parameter, which most don't expose today. This utility does NOT pretend
 * to solve that generically. What it DOES provide is the structural
 * scaffolding every resumable-stream implementation needs regardless of
 * backend: (1) tracking accumulated text across attempts so a resume-capable
 * backend has something to resume from, (2) a sensible default retry policy
 * (exponential backoff, abort-awareness) so callers don't hand-roll it badly,
 * and (3) a clean seam (buildFactory receives ResumeContext) where a
 * resume-capable integration plugs in its actual resume logic.
 *
 * For backends WITHOUT resume support, this still adds real value: it turns
 * a single dropped connection into an automatic clean retry instead of a
 * hard error surfaced to the user, which is the more common and still
 * valuable case.
 */
export function createResumableStream(options: CreateResumableStreamOptions): StreamSourceFactory {
  const {
    buildFactory,
    shouldRetry = defaultShouldRetry,
    maxRetries = 2,
    retryDelayMs = defaultRetryDelay,
    onRetry,
  } = options;

  return async function resumableFactory(signal: AbortSignal): Promise<StreamSource> {
    let textSoFar = "";
    let attempt = 0;

    async function* run(): AsyncGenerator<StreamChunk> {
      while (true) {
        const innerFactory = buildFactory({ textSoFar, attempt });
        try {
          const source = await innerFactory(signal);
          for await (const chunk of source) {
            if (chunk.type === "text") {
              textSoFar += chunk.delta;
              yield chunk;
              continue;
            }
            if (chunk.type === "error") {
              // Intentionally NOT yielded here. Yielding it immediately
              // would leak a transient, about-to-be-retried error to the
              // consumer — e.g. a consuming useTokenStream would flip to
              // "error" status even though this module is about to retry
              // and may well succeed. The error is only ever surfaced to
              // the consumer (below) once retries are exhausted or the
              // error is judged non-retryable.
              throw chunk.error;
            }
            yield chunk;
          }
          return; // completed without error
        } catch (err) {
          if (signal.aborted) return;
          const normalizedError = err instanceof Error ? err : new Error(String(err));
          attempt += 1;
          if (attempt > maxRetries || !shouldRetry(normalizedError, attempt)) {
            yield { type: "error", error: normalizedError };
            return;
          }
          onRetry?.(normalizedError, attempt);
          const delay = retryDelayMs(attempt);
          await new Promise((resolve) => setTimeout(resolve, delay));
          if (signal.aborted) return;
          // loop again with the updated attempt/textSoFar context
        }
      }
    }

    return run();
  };
}
