import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

/**
 * Per-IP rate limiting for the demo chat endpoint, backed by Upstash Redis so
 * the limit holds across serverless instances and cold starts (an in-memory
 * Map would reset per instance and leak under scale-out).
 *
 * Disabled gracefully when the Upstash env vars are absent — local `next dev`
 * against your own key works without provisioning Redis. In production the vars
 * should always be set; a warning is logged once if they are not.
 */

const REQUESTS_PER_WINDOW = 10;
const WINDOW = "60 s" as const;

function createLimiter(): Ratelimit | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    console.warn(
      "[rate-limit] UPSTASH_REDIS_REST_URL/TOKEN not set — rate limiting is DISABLED. " +
        "Set both before deploying a public demo to protect your API credits.",
    );
    return null;
  }

  return new Ratelimit({
    redis: new Redis({ url, token }),
    limiter: Ratelimit.slidingWindow(REQUESTS_PER_WINDOW, WINDOW),
    analytics: true,
    prefix: "streamkit-demo",
  });
}

// Module-level singleton: one limiter per serverless instance, reused across requests.
const limiter = createLimiter();

export interface RateLimitResult {
  success: boolean;
  /** Seconds until the limit resets, for the Retry-After header. */
  retryAfter: number;
  remaining: number;
}

/**
 * Returns null when rate limiting is disabled (env not configured), so callers
 * can treat "no limiter" as an explicit, visible state rather than silently
 * allowing unlimited traffic.
 */
export async function checkRateLimit(identifier: string): Promise<RateLimitResult | null> {
  if (!limiter) return null;

  const { success, reset, remaining } = await limiter.limit(identifier);
  return {
    success,
    remaining,
    retryAfter: Math.max(0, Math.ceil((reset - Date.now()) / 1000)),
  };
}

/**
 * Best-effort client IP from the proxy chain. Vercel/most proxies set
 * `x-forwarded-for` as a comma-separated list with the client first.
 */
export function getClientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return req.headers.get("x-real-ip")?.trim() || "anonymous";
}
