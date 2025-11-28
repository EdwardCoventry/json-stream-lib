import {RetryReason} from '../types';

export type BackoffProfile = 'aggressive' | 'balanced' | 'conservative';

export class NetworkPolicy {
  maxAttempts: number;
  ttfbMs: number;
  retryOnServerErrors: boolean;
  retryOnlyBeforeBytes: boolean;
  midStreamStallMs: number;
  backoffProfile: BackoffProfile;
  private baseBackoff: number;

  constructor(net: any = {}) {
    this.maxAttempts = Math.max(1, Math.min(5, Number(net?.maxAttempts ?? 3)));
    this.ttfbMs = Math.max(5000, Math.min(120000, Number(net?.ttfbTimeoutMs ?? 30000)));
    this.retryOnServerErrors = net?.retryOnServerErrors ?? true;
    this.retryOnlyBeforeBytes = net?.retryOnlyBeforeBytes ?? true;
    this.midStreamStallMs = Math.max(0, Math.min(120000, Number(net?.midStreamStallMs ?? 0)));
    this.backoffProfile = (net?.backoffProfile || 'balanced') as BackoffProfile;
    this.baseBackoff = this.backoffProfile === 'aggressive' ? 100 : this.backoffProfile === 'conservative' ? 400 : 200;
  }

  static fromCurrent(): NetworkPolicy {
    return new NetworkPolicy({});
  }

  backoff(attemptNum: number): number {
    const base = this.baseBackoff * Math.pow(2, Math.max(0, attemptNum - 1));
    const jitter = Math.round(Math.random() * this.baseBackoff);
    return base + jitter;
  }

  classifyStatus(status: number): { retryable: boolean; reason?: RetryReason } {
    const retryableStatus = status === 408 || status === 409 || status === 425 || status === 429 || (status >= 500 && status < 600);
    if (!retryableStatus) return { retryable: false };
    return { retryable: this.retryOnServerErrors, reason: status === 429 ? RetryReason.RateLimit : RetryReason.Upstream };
  }
}
