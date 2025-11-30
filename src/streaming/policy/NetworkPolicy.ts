import {JsonDeltaRetryReason} from '../types.js';
import {getCurrentNetworkSettings, type NetworkSettings} from '../utils/currentNetwork.js';

export type BackoffProfile = NetworkSettings['backoffProfile'];

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/**
 * Centralizes retry/backoff and timeout policy for streaming requests.
 */
export class NetworkPolicy {
  readonly maxAttempts: number;
  readonly ttfbMs: number;
  readonly retryOnServerErrors: boolean;
  readonly retryOnlyBeforeBytes: boolean;
  readonly midStreamStallMs: number;
  readonly backoffProfile: BackoffProfile;
  private readonly baseBackoff: number;

  constructor(net: any = {}) {
    this.maxAttempts = clamp(Number(net?.maxAttempts ?? 3), 1, 5);
    this.ttfbMs = clamp(Number(net?.ttfbTimeoutMs ?? 30000), 5000, 120000);
    this.retryOnServerErrors = net?.retryOnServerErrors ?? true;
    this.retryOnlyBeforeBytes = net?.retryOnlyBeforeBytes ?? true;
    this.midStreamStallMs = clamp(Number(net?.midStreamStallMs ?? 0), 0, 120000);
    this.backoffProfile = (net?.backoffProfile || 'balanced') as BackoffProfile;
    this.baseBackoff = this.backoffProfile === 'aggressive' ? 100 : this.backoffProfile === 'conservative' ? 400 : 200;
  }

  static fromCurrent(): NetworkPolicy {
    const current = getCurrentNetworkSettings?.();
    return new NetworkPolicy(current || {});
  }

  backoff(attemptNum: number): number {
    const base = this.baseBackoff * Math.pow(2, Math.max(0, attemptNum - 1));
    const jitter = Math.round(Math.random() * this.baseBackoff);
    return base + jitter;
  }

  classifyStatus(status: number): { retryable: boolean; reason?: JsonDeltaRetryReason } {
    const retryableStatus = status === 408 || status === 409 || status === 425 || status === 429 || (status >= 500 && status < 600);
    if (!retryableStatus) return { retryable: false };
    return { retryable: this.retryOnServerErrors, reason: status === 429 ? JsonDeltaRetryReason.RateLimit : JsonDeltaRetryReason.Upstream };
  }
}
