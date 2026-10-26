import ApiError from '../utils/ApiError.js';
import config from '../config/env.js';

/**
 * Small fixed-window rate limiter kept in process memory.
 *
 * Note: for multi-instance deployments (more than one Render instance) move the
 * counters to Redis / a shared cache - see README "Scaling notes".
 */
const buckets = new Map();

function pruneExpired(now) {
  if (buckets.size < 5000) return;
  for (const [key, bucket] of buckets.entries()) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export function rateLimit({
  windowMs = 60_000,
  max = 30,
  keyPrefix = 'default',
  message,
  keyGenerator,
  force = false
}) {
  return function rateLimiter(req, res, next) {
    if (!config.rateLimit.enabled && !force) return next();
    const now = Date.now();
    pruneExpired(now);
    const identity = keyGenerator
      ? keyGenerator(req)
      : req.user?._id || req.ip || req.socket?.remoteAddress || 'unknown';
    const key = `${keyPrefix}:${identity}`;
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;

    const remaining = Math.max(0, max - bucket.count);
    res.setHeader('RateLimit-Limit', String(max));
    res.setHeader('RateLimit-Remaining', String(remaining));
    res.setHeader('RateLimit-Reset', String(Math.ceil((bucket.resetAt - now) / 1000)));

    if (bucket.count > max) {
      res.setHeader('Retry-After', String(Math.ceil((bucket.resetAt - now) / 1000)));
      return next(
        ApiError.tooMany(message || 'Too many requests. Please wait a moment and try again.', {
          code: 'RATE_LIMITED'
        })
      );
    }
    return next();
  };
}

/** Used by tests to start from a clean slate. */
export function resetRateLimiters() {
  buckets.clear();
}

export default rateLimit;
