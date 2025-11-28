import {RetryPhase, type IRetryManager, type RetryScheduleOptions} from '../types';

export class RetryManager implements IRetryManager {
  async schedule(opts: RetryScheduleOptions): Promise<void> {
    // No external event bus; just wait with backoff.
    await new Promise((res) => setTimeout(res, opts.ms));
  }
  clear(): void {
    // No-op; kept for API parity.
  }
}
