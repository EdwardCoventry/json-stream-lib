import type {NetworkPolicy} from './policy/NetworkPolicy.js';
import type {JsonDeltaDebugLogger} from './debug/StreamDebug.js';

// Core streaming types and enums

export enum JsonDeltaRetryReason {
  RateLimit = 'rate-limit',
  Upstream = 'upstream',
}

export enum JsonDeltaRetryPhase {
  Scheduled = 'scheduled',
  Clear = 'clear',
}

export interface RetryScheduleOptions {
  attemptNext: number;
  maxAttempts: number;
  ms: number;
  reason?: JsonDeltaRetryReason;
  status?: number;
}

export interface IRetryManager {
  schedule(opts: RetryScheduleOptions): Promise<void>;
  clear(): void;
}

export type JsonDeltaHandlers = {
  onDeltaText?: (delta: string, fullText: string) => void;
  onError?: (e: any) => void;
  onDone?: (final: any) => void;
};

export interface IWatchdogManager {
  kickTTFB(): void;
  kickStall(): void;
  clear(): void;
}

export interface BuildPayloadOptions {
  messages: any[];
  model?: string;
  forcedModel?: string;
  text?: Record<string, any>;
  tools?: any;
  toolChoice?: any;
  parallelToolCalls?: boolean;
  overrides?: {model?: string; reasoning?: any; verbosity?: any};
  clientSessionId?: string;
  getCurrentModelSettings?: () => any;
}

export interface BuiltPayloadResult {
  payload: any;
  isJsonStructured: boolean;
  uiSid: string;
  clientId?: string;
}

export interface JsonDeltaResponsesOptions {
  text?: Record<string, any>;
  tools?: any;
  toolChoice?: any;
  parallelToolCalls?: boolean;
  overrides?: {model?: string; reasoning?: any; verbosity?: any};
  signal?: AbortSignal;
  qr?: any;
  policy?: NetworkPolicy;
  dbg?: JsonDeltaDebugLogger;
  apiBase?: string;
  endpointPath?: string;
  forcedModel?: string;
  shadowMode?: boolean;
  maxQueueFrames?: number;
  maxQueueBytes?: number;
  clientSessionId?: string;
  getCurrentModelSettings?: () => any;
}
