import {type IRetryManager, type RetryScheduleOptions} from '../types.js';

/**
 * Minimal retry scheduler that simply waits for the computed backoff duration.
 * Can be swapped out for more sophisticated transport/event bus implementations.
 */
export class RetryManager implements IRetryManager {
  async schedule(opts: RetryScheduleOptions): Promise<void> {
    // No external event bus; just wait with backoff.
    await new Promise((res) => setTimeout(res, opts.ms));
  }
  clear(): void {
    // No-op; kept for API parity.
  }
}
