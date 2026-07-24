import { createHash } from "node:crypto";
import { isIP } from "node:net";

type RateLimitBucket = {
  count: number;
  resetAt: number;
};

const MAX_BUCKETS = 10_000;
const BUCKET_STORE_KEY = Symbol.for("org.aimauta.rate-limit.buckets.v1");

function rateLimitBuckets(): Map<string, RateLimitBucket> {
  const processGlobal = globalThis as typeof globalThis & {
    [key: symbol]: unknown;
  };
  const existing = processGlobal[BUCKET_STORE_KEY];

  if (existing instanceof Map) {
    return existing as Map<string, RateLimitBucket>;
  }

  const created = new Map<string, RateLimitBucket>();
  processGlobal[BUCKET_STORE_KEY] = created;
  return created;
}

// Route bundles may have separate module registries. A symbol-backed global
// makes all bundles in one Node.js process enforce the same admission budget.
// Horizontal or multi-process deployments still require an external limiter.
const buckets = rateLimitBuckets();

export class RateLimitError extends Error {
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super("Demasiadas solicitudes. Espera un momento antes de continuar.");
    this.name = "RateLimitError";
    this.retryAfterSeconds = Math.max(1, retryAfterSeconds);
  }
}

function prune(now: number): void {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) {
      buckets.delete(key);
    }
  }

  while (buckets.size >= MAX_BUCKETS) {
    const oldest = buckets.keys().next().value as string | undefined;
    if (!oldest) break;
    buckets.delete(oldest);
  }
}

export function consumeRateLimit(input: {
  scope: string;
  key: string;
  limit: number;
  windowMs: number;
  now?: number;
}): { remaining: number; resetAt: number } {
  const now = input.now ?? Date.now();
  const limit = Math.max(1, Math.floor(input.limit));
  const windowMs = Math.max(1_000, Math.floor(input.windowMs));
  const bucketKey = `${input.scope}:${input.key}`;
  const current = buckets.get(bucketKey);

  if (!current || current.resetAt <= now) {
    if (buckets.size >= MAX_BUCKETS) {
      prune(now);
    }
    const next = { count: 1, resetAt: now + windowMs };
    buckets.set(bucketKey, next);
    return { remaining: limit - 1, resetAt: next.resetAt };
  }

  if (current.count >= limit) {
    throw new RateLimitError(
      Math.ceil(Math.max(1, current.resetAt - now) / 1_000)
    );
  }

  current.count += 1;
  return {
    remaining: Math.max(0, limit - current.count),
    resetAt: current.resetAt
  };
}

export function requestRateLimitKey(request: Request): string {
  const trustProxy = process.env.AIMAUTA_TRUST_PROXY_HEADERS === "true";
  const forwardedFor = trustProxy
    ? request.headers.get("x-forwarded-for")?.trim() ?? ""
    : "";
  // The production edge accepts traffic only from Tailscale Funnel, which
  // overwrites X-Forwarded-For with one canonical client IP. Do not consult
  // CF-Connecting-IP or X-Real-IP: Funnel does not sanitize those client
  // headers, so trusting them would make the limiter trivially spoofable.
  const forwardedAddress =
    forwardedFor.length <= 45 &&
    !forwardedFor.includes(",") &&
    isIP(forwardedFor) !== 0
      ? forwardedFor
      : null;
  // A standard Web Request does not expose the peer socket address. When no
  // sanitizing proxy is trusted, use one shared fail-closed bucket rather than
  // a spoofable User-Agent bucket that an attacker can rotate indefinitely.
  const fingerprint = forwardedAddress
    ? `proxy:${forwardedAddress}`
    : "untrusted-proxy:shared";

  return createHash("sha256").update(fingerprint).digest("base64url").slice(0, 22);
}
