'use strict';

/**
 * In-memory sliding-window rate limiter middleware.
 * Zero external dependencies; protects against brute-force and credential-stuffing attacks.
 *
 * @param {Object} options
 * @param {number} options.windowMs - Window duration in milliseconds (default: 15 minutes)
 * @param {number} options.max - Maximum requests allowed per window (default: 10)
 * @param {string} options.message - Error message when rate limit is exceeded
 * @param {Function} options.skip - Function(req) returning boolean to skip rate limiting
 * @returns {Function} Express middleware function
 */
const createRateLimiter = (options = {}) => {
  const windowMs = options.windowMs || 15 * 60 * 1000; // 15 minutes
  const max = options.max || 10;
  const message = options.message || 'Too many requests from this IP, please try again later.';
  const skip = typeof options.skip === 'function' ? options.skip : () => false;

  // Map of ip -> Array of timestamps (ms)
  const clientHits = new Map();

  // Periodic cleanup of expired entries (every 5 minutes)
  const cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [ip, timestamps] of clientHits.entries()) {
      const valid = timestamps.filter((t) => now - t < windowMs);
      if (valid.length === 0) {
        clientHits.delete(ip);
      } else {
        clientHits.set(ip, valid);
      }
    }
  }, 5 * 60 * 1000);

  if (cleanupTimer.unref) {
    cleanupTimer.unref();
  }

  const rateLimiter = (req, res, next) => {
    if (skip(req)) {
      return next();
    }

    const ip = req.ip || req.connection?.remoteAddress || '127.0.0.1';
    const now = Date.now();
    const timestamps = (clientHits.get(ip) || []).filter((t) => now - t < windowMs);

    if (timestamps.length >= max) {
      const oldestHit = timestamps[0];
      const resetTime = oldestHit + windowMs;
      const retryAfterSeconds = Math.max(1, Math.ceil((resetTime - now) / 1000));

      res.set({
        'Retry-After': String(retryAfterSeconds),
        'RateLimit-Limit': String(max),
        'RateLimit-Remaining': '0',
        'RateLimit-Reset': String(Math.ceil(resetTime / 1000))
      });

      return res.status(429).json({
        success: false,
        message,
        errors: []
      });
    }

    timestamps.push(now);
    clientHits.set(ip, timestamps);

    const remaining = Math.max(0, max - timestamps.length);
    const resetTime = timestamps[0] + windowMs;

    res.set({
      'RateLimit-Limit': String(max),
      'RateLimit-Remaining': String(remaining),
      'RateLimit-Reset': String(Math.ceil(resetTime / 1000))
    });

    next();
  };

  rateLimiter.reset = () => {
    clientHits.clear();
  };

  return rateLimiter;
};

// Preset rate limiters for authentication endpoints
const authRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 15, // 15 requests per 15 minutes per IP
  message: 'Too many authentication attempts from this IP. Please try again after 15 minutes.',
  skip: (req) => process.env.NODE_ENV === 'test' && !req.headers['x-test-rate-limit']
});

module.exports = {
  createRateLimiter,
  authRateLimiter
};
