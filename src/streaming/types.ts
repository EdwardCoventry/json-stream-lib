// Core streaming types and enums

export enum RetryReason {
  RateLimit = 'rate-limit',
  Upstream = 'upstream'
}

export enum RetryPhase {
  Scheduled = 'scheduled',
  Clear = 'clear'
}

export interface RetryScheduleOptions {
  attemptNext: number;
  maxAttempts: number;
  ms: number;
  reason: any; // RetryReason enum value
  status?: number;
}

export interface IRetryManager {
  schedule(opts: RetryScheduleOptions): Promise<void>;
  clear(): void;
}
