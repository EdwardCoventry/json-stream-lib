// Minimal DOM-based event bus for debug/error reporting

export type JsonDeltaDebugEvent = {
  ts?: number;
  source: string;
  type: string;
  data: { sessionId: string; [k: string]: any };
};

export type JsonDeltaErrorReport = {
  ts?: number;
  source: string;
  context?: string;
  name?: string;
  message: string;
  stack?: string;
  request?: { url?: string; model?: string; payload?: any; stream?: boolean };
  response?: {
    status?: number;
    headers?: Record<string, string>;
    requestId?: string;
    model?: string;
    retryAfter?: string | number;
    rateLimitRemaining?: string | number;
    rateLimitReset?: string | number;
    bodySnippet?: string;
  };
  extra?: Record<string, any>;
};

export const STREAM_EVENT_NAME = 'stream:event';
export const ERROR_REPORT_EVENT_NAME = 'stream:error-report';

const hasWindow = typeof window !== 'undefined' && typeof (window as any).dispatchEvent === 'function';

export function emitJsonDeltaDebugEvent(e: JsonDeltaDebugEvent) {
  try {
    if (!hasWindow) return;
    const evt = new CustomEvent(STREAM_EVENT_NAME, { detail: e });
    (window as any).dispatchEvent(evt);
  } catch {}
}

export function emitJsonDeltaErrorReport(e: JsonDeltaErrorReport) {
  try {
    if (!hasWindow) return;
    const evt = new CustomEvent(ERROR_REPORT_EVENT_NAME, { detail: e });
    (window as any).dispatchEvent(evt);
  } catch {}
}
