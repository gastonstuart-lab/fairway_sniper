/**
 * Retry utility with exponential backoff
 * Handles transient failures in network requests and browser automation
 */

/**
 * Executes a function with retry logic
 * @param {Function} fn - Async function to retry
 * @param {Object} options - Retry configuration
 * @param {number} options.maxRetries - Maximum retry attempts (default: 3)
 * @param {number} options.initialDelay - Initial delay in ms (default: 1000)
 * @param {number} options.maxDelay - Maximum delay in ms (default: 30000)
 * @param {number} options.backoffMultiplier - Delay multiplier (default: 2)
 * @param {Function} options.shouldRetry - Custom function to determine if error is retryable
 * @param {Function} options.onRetry - Callback before each retry
 * @returns {Promise<any>} - Result of successful function execution
 */
export async function withRetry(fn, options = {}) {
  const {
    maxRetries = 3,
    initialDelay = 1000,
    maxDelay = 30000,
    backoffMultiplier = 2,
    shouldRetry = defaultShouldRetry,
    onRetry = null,
  } = options;

  let lastError;
  let delay = initialDelay;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;

      // Check if we should retry this error
      if (!shouldRetry(error)) {
        throw error;
      }

      // No more retries left
      if (attempt === maxRetries) {
        throw new Error(
          `Failed after ${maxRetries + 1} attempts: ${error.message}`,
          { cause: error }
        );
      }

      // Calculate next delay with exponential backoff
      const waitTime = Math.min(delay, maxDelay);
      
      if (onRetry) {
        onRetry(error, attempt + 1, waitTime);
      }

      // Wait before next retry
      await sleep(waitTime);
      delay *= backoffMultiplier;
    }
  }

  throw lastError;
}

/**
 * Default retry logic - retries on network/timeout errors
 * @param {Error} error - Error to check
 * @returns {boolean} - True if error should trigger retry
 */
function defaultShouldRetry(error) {
  const message = error.message?.toLowerCase() || '';
  
  // Retry on common transient errors
  const retryableErrors = [
    'timeout',
    'network',
    'econnreset',
    'enotfound',
    'econnrefused',
    'etimedout',
    'socket hang up',
    'navigation timeout',
    'waiting for locator',
    'page.goto',
  ];

  return retryableErrors.some(pattern => message.includes(pattern));
}

/**
 * Sleep utility
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry specifically for Playwright page navigation
 */
export async function retryPageGoto(page, url, options = {}) {
  return withRetry(
    async (attempt) => {
      return await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
        ...options,
      });
    },
    {
      maxRetries: 3,
      initialDelay: 2000,
      onRetry: (error, attempt, waitTime) => {
        console.log(`[retry] Navigation failed (attempt ${attempt}), retrying in ${waitTime}ms...`);
      },
    }
  );
}

/**
 * Retry for element interactions
 */
export async function retryElementAction(action, elementDescription, options = {}) {
  return withRetry(
    async (attempt) => {
      return await action();
    },
    {
      maxRetries: 2,
      initialDelay: 500,
      maxDelay: 2000,
      onRetry: (error, attempt, waitTime) => {
        console.log(`[retry] ${elementDescription} failed (attempt ${attempt}), retrying in ${waitTime}ms...`);
      },
      ...options,
    }
  );
}

export default { withRetry, retryPageGoto, retryElementAction };
