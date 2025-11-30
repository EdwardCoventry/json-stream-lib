import {JsonDeltaRetryPhase} from '../types.js';
import {emitJsonDeltaDebugEvent, emitJsonDeltaErrorReport} from '../utils/eventBus.js';
import {emitJsonDeltaRetryEvent} from '../utils/retry.js';

type QueryResponseLike = {
  pushHeaders?: (meta: any) => void;
  markCompleted?: () => void;
};

export class JsonDeltaDebugLogger {
  constructor(private readonly uiSid: string, private readonly qr?: QueryResponseLike) {}

  private swallow(fn: () => void) {
    try { fn(); } catch {}
  }

  requestStart(model: string, payload: any) {
    this.swallow(() => emitJsonDeltaDebugEvent({
      source: 'system',
      type: 'request.start',
      data: {api: 'responses', model, stream: true, payload, sessionId: this.uiSid},
    }));
  }
  headers(meta: {requestId: string; model: string; coldStart?: string; upstreamTTFBms?: string}) {
    this.swallow(() => emitJsonDeltaDebugEvent({source: 'system', type: 'response.headers', data: {...meta, sessionId: this.uiSid}}));
    this.swallow(() => this.qr?.pushHeaders?.(meta as any));
  }
  error(status: number, bodySnippet: string, willUiReport: boolean, model?: string, url?: string, payload?: any) {
    this.swallow(() => emitJsonDeltaDebugEvent({source: 'system', type: 'response.error', data: {status, bodySnippet, sessionId: this.uiSid, uiReported: willUiReport}}));
    if (willUiReport) {
      this.swallow(() => emitJsonDeltaErrorReport({
        source: 'stream',
        context: 'stream.core',
        name: 'StreamError',
        message: `status ${status}`,
        stack: '',
        request: {url, model, payload, stream: true},
        response: {status, bodySnippet, requestId: '', model: '', headers: {}},
      }));
    }
  }
  textDelta(delta: string, fullText: string) {
    if (!delta) return;
    this.swallow(() => emitJsonDeltaDebugEvent({source: 'system', type: 'response.text.delta', data: {delta, fullText, sessionId: this.uiSid}}));
  }
  jsonDelta(delta: string) {
    if (!delta) return;
    this.swallow(() => emitJsonDeltaDebugEvent({source: 'system', type: 'response.json.delta', data: {delta, sessionId: this.uiSid}}));
  }
  sse(eventType: string) {
    if (!eventType) return;
    this.swallow(() => emitJsonDeltaDebugEvent({source: 'system', type: 'response.sse', data: {eventType, sessionId: this.uiSid}}));
  }
  sseSuppressed() { this.swallow(() => emitJsonDeltaDebugEvent({source: 'system', type: 'response.sse.suppressed', data: {suppressed: true, sessionId: this.uiSid}})); }
  perfSlice(data: any) { this.swallow(() => emitJsonDeltaDebugEvent({source: 'system', type: 'response.perf.slice', data: {...data, sessionId: this.uiSid}})); }
  perfSample(data: any) { this.swallow(() => emitJsonDeltaDebugEvent({source: 'system', type: 'response.perf', data: {...data, sessionId: this.uiSid}})); }
  parseSlow(ms: number) { this.swallow(() => emitJsonDeltaDebugEvent({source: 'system', type: 'response.perf.parseSlow', data: {ms, sessionId: this.uiSid}})); }
  heartbeat(note: string) { this.swallow(() => emitJsonDeltaDebugEvent({source: 'system', type: 'response.heartbeat', data: {note, sessionId: this.uiSid}})); }
  aborted() {
    this.swallow(() => emitJsonDeltaDebugEvent({source: 'system', type: 'response.aborted', data: {sessionId: this.uiSid}}));
    this.swallow(() => this.qr?.markCompleted?.());
  }
  pipelineDiff(primaryLen: number, secondaryLen: number, sessionId: string) { this.swallow(() => emitJsonDeltaDebugEvent({source: 'system', type: 'pipeline.diff', data: {primaryLen, secondaryLen, sessionId}})); }
  clearRetry() { this.swallow(() => emitJsonDeltaRetryEvent({phase: JsonDeltaRetryPhase.Clear})); }
  static noop(): JsonDeltaDebugLogger { return new JsonDeltaDebugLogger('', undefined); }
}
