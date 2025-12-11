import {test} from 'node:test';
import {strict as assert} from 'node:assert';

import {NetworkPolicy} from '../streaming/policy/NetworkPolicy.js';
import {JsonDeltaRetryReason} from '../streaming/types.js';

test('NetworkPolicy clamps values and honours backoff profile', () => {
  const aggressive = new NetworkPolicy({maxAttempts: 10, ttfbTimeoutMs: 1000, backoffProfile: 'aggressive'});
  const balanced = new NetworkPolicy({maxAttempts: 1, ttfbTimeoutMs: 4000, backoffProfile: 'balanced'});
  const conservative = new NetworkPolicy({maxAttempts: 0, ttfbTimeoutMs: 200000, backoffProfile: 'conservative'});

  assert.equal(aggressive.maxAttempts, 5);
  assert.equal(balanced.maxAttempts, 1);
  assert.equal(conservative.maxAttempts, 1);

  assert.ok(aggressive.ttfbMs >= 5000 && aggressive.ttfbMs <= 120000);
  assert.ok(balanced.ttfbMs >= 5000 && balanced.ttfbMs <= 120000);
  assert.ok(conservative.ttfbMs >= 5000 && conservative.ttfbMs <= 120000);

  const a1 = aggressive.backoff(1);
  const b1 = balanced.backoff(1);
  const c1 = conservative.backoff(1);

  assert.ok(a1 >= 100 && a1 <= 300);
  assert.ok(b1 >= 200 && b1 <= 400);
  assert.ok(c1 >= 400 && c1 <= 800);
});

test('NetworkPolicy classifyStatus marks retryable statuses with reasons', () => {
  const p = new NetworkPolicy({retryOnServerErrors: true});

  const ok = p.classifyStatus(200);
  assert.equal(ok.retryable, false);

  const r429 = p.classifyStatus(429);
  assert.equal(r429.retryable, true);
  assert.equal(r429.reason, JsonDeltaRetryReason.RateLimit);

  const r500 = p.classifyStatus(500);
  assert.equal(r500.retryable, true);
  assert.equal(r500.reason, JsonDeltaRetryReason.Upstream);

  const r404 = p.classifyStatus(404);
  assert.equal(r404.retryable, false);
});
