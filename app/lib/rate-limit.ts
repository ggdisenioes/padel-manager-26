/**
 * Simple in-memory rate limiter for serverless environments.
 * Provides basic burst protection per IP within a single instance.
 * For distributed rate limiting, use @upstash/ratelimit with KV store.
 */

import { Ratelimit } from "@upstash/ratelimit";
import { kv } from "@vercel/kv";

type RateLimitEntry = { count: number; resetAt: number };
type RateLimitOptions = { maxRequests?: number; windowMs?: number };
type RateLimitResult = {
  success: boolean;
  remaining: number;
  limit: number;
  resetAt: number;
  retryAfterSeconds: number;
  strategy: "memory" | "distributed";
};

const store = new Map<string, RateLimitEntry>();
const limiterCache = new Map<string, Ratelimit>();
const distributedEnabled = Boolean(
  process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN
);

// Cleanup old entries every 60s to prevent memory leaks
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (entry.resetAt < now) store.delete(key);
  }
}, 60_000);

export function rateLimit(
  identifier: string,
  { maxRequests = 10, windowMs = 60_000 }: RateLimitOptions = {}
): { success: boolean; remaining: number } {
  const result = rateLimitMemory(identifier, { maxRequests, windowMs });
  return { success: result.success, remaining: result.remaining };
}

function rateLimitMemory(
  identifier: string,
  { maxRequests = 10, windowMs = 60_000 }: RateLimitOptions = {}
): RateLimitResult {
  const now = Date.now();
  const entry = store.get(identifier);

  if (!entry || entry.resetAt < now) {
    const resetAt = now + windowMs;
    store.set(identifier, { count: 1, resetAt });
    return {
      success: true,
      remaining: maxRequests - 1,
      limit: maxRequests,
      resetAt,
      retryAfterSeconds: Math.max(1, Math.ceil(windowMs / 1000)),
      strategy: "memory",
    };
  }

  entry.count++;
  if (entry.count > maxRequests) {
    return {
      success: false,
      remaining: 0,
      limit: maxRequests,
      resetAt: entry.resetAt,
      retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)),
      strategy: "memory",
    };
  }

  return {
    success: true,
    remaining: maxRequests - entry.count,
    limit: maxRequests,
    resetAt: entry.resetAt,
    retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)),
    strategy: "memory",
  };
}

function getDistributedLimiter(maxRequests: number, windowMs: number) {
  const seconds = Math.max(1, Math.ceil(windowMs / 1000));
  const key = `${maxRequests}:${seconds}`;
  let limiter = limiterCache.get(key);

  if (!limiter) {
    limiter = new Ratelimit({
      redis: kv,
      limiter: Ratelimit.slidingWindow(maxRequests, `${seconds} s`),
      prefix: "padelx:rl",
      analytics: false,
    });
    limiterCache.set(key, limiter);
  }

  return limiter;
}

export async function rateLimitAsync(
  identifier: string,
  { maxRequests = 10, windowMs = 60_000 }: RateLimitOptions = {}
): Promise<RateLimitResult> {
  if (!distributedEnabled) {
    return rateLimitMemory(identifier, { maxRequests, windowMs });
  }

  try {
    const limiter = getDistributedLimiter(maxRequests, windowMs);
    const result = await limiter.limit(identifier);
    const now = Date.now();
    return {
      success: result.success,
      remaining: result.remaining,
      limit: result.limit,
      resetAt: result.reset,
      retryAfterSeconds: Math.max(1, Math.ceil((result.reset - now) / 1000)),
      strategy: "distributed",
    };
  } catch (error) {
    console.error("[rate-limit] distributed limiter fallback", error);
    return rateLimitMemory(identifier, { maxRequests, windowMs });
  }
}

export function getClientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  const real = req.headers.get("x-real-ip");
  if (real) return real;
  return "unknown";
}
