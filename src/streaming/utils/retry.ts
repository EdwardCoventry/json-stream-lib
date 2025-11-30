import {JsonDeltaRetryPhase, JsonDeltaRetryReason} from '../types.js';

export type JsonDeltaRetryEvent = {
  phase: JsonDeltaRetryPhase;
  reason?: JsonDeltaRetryReason;
  attempt?: number;
  maxAttempts?: number;
  seconds?: number;
  status?: number;
};

let retryListener: ((e: JsonDeltaRetryEvent) => void) | undefined;

export function setJsonDeltaRetryListener(fn?: (e: JsonDeltaRetryEvent) => void) {
  retryListener = fn;
}

export function emitJsonDeltaRetryEvent(e: JsonDeltaRetryEvent) {
  try {
    retryListener?.(e);
  } catch {}
}
