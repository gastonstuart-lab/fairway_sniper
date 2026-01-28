/**
 * Rate limiting and request throttling
 * Prevents overwhelming target servers and detection as bot
 */

/**
 * Adds randomized delay to mimic human behavior
 * @param {number} minMs - Minimum delay in milliseconds
 * @param {number} maxMs - Maximum delay in milliseconds
 * @returns {Promise<void>}
 */
export async function randomDelay(minMs = 500, maxMs = 2000) {
  const delay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  return new Promise((resolve) => setTimeout(resolve, delay));
}

/**
 * Human-like typing simulation
 * @param {Object} locator - Playwright locator
 * @param {string} text - Text to type
 * @param {Object} options - Typing options
 * @returns {Promise<void>}
 */
export async function humanType(locator, text, options = {}) {
  const { minDelay = 50, maxDelay = 150 } = options;

  await locator.click();
  await randomDelay(100, 300);

  for (const char of text) {
    await locator.pressSequentially(char, {
      delay: Math.random() * (maxDelay - minDelay) + minDelay,
    });
  }
}

/**
 * Rate limiter class using token bucket algorithm
 */
export class RateLimiter {
  constructor(maxTokens = 10, refillRate = 1, refillInterval = 1000) {
    this.maxTokens = maxTokens;
    this.tokens = maxTokens;
    this.refillRate = refillRate;
    this.refillInterval = refillInterval;

    // Start refill timer
    this.refillTimer = setInterval(() => {
      this.tokens = Math.min(this.maxTokens, this.tokens + this.refillRate);
    }, refillInterval);
  }

  /**
   * Acquire a token, waiting if necessary
   * @param {number} tokens - Number of tokens to acquire
   * @returns {Promise<void>}
   */
  async acquire(tokens = 1) {
    while (this.tokens < tokens) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    this.tokens -= tokens;
  }

  /**
   * Check if tokens are available without acquiring
   * @param {number} tokens - Number of tokens to check
   * @returns {boolean}
   */
  canAcquire(tokens = 1) {
    return this.tokens >= tokens;
  }

  /**
   * Stop the rate limiter
   */
  stop() {
    if (this.refillTimer) {
      clearInterval(this.refillTimer);
      this.refillTimer = null;
    }
  }
}

/**
 * Global rate limiter for API requests
 * 10 requests per 10 seconds = 1 request per second average
 */
export const globalRateLimiter = new RateLimiter(10, 1, 1000);

/**
 * Wrapper to rate-limit async function calls
 * @param {Function} fn - Async function to rate limit
 * @param {RateLimiter} limiter - Rate limiter instance
 * @returns {Function} - Rate-limited function
 */
export function rateLimited(fn, limiter = globalRateLimiter) {
  return async function (...args) {
    await limiter.acquire();
    return await fn(...args);
  };
}

/**
 * Add polite delays with optional range
 * @param {number} minMs - Minimum delay in milliseconds
 * @param {number} maxMs - Maximum delay in milliseconds (optional)
 * @returns {Promise<void>}
 */
export async function politeDelay(minMs, maxMs) {
  if (maxMs === undefined) {
    // Single value delay
    await new Promise((resolve) => setTimeout(resolve, minMs));
  } else {
    // Random delay in range
    await randomDelay(minMs, maxMs);
  }
}

export default {
  randomDelay,
  humanType,
  RateLimiter,
  globalRateLimiter,
  rateLimited,
  politeDelay,
};
