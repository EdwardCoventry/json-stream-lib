type Logger = { info?: (...args: any[]) => void; warn?: (...args: any[]) => void; error?: (...args: any[]) => void; debug?: (...args: any[]) => void; log?: (...args: any[]) => void };

/**
 * Lightweight debug emitter used by the streaming pipeline.
 * All methods are best-effort no-ops unless a logger is provided.
 */
export class StreamDebug {
  constructor(private uiSid: string = '', private logger?: Logger) {}

  private emit(level: keyof Logger, message: string, payload?: any) {
    const fn = this.logger?.[level] || this.logger?.log;
    try { fn?.(message, payload); } catch {}
  }

  requestStart(_model: string, payload: any) { this.emit('info', '[stream] request.start', { sessionId: this.uiSid, payload }); }
  headers(meta: {requestId?: string; model?: string; coldStart?: string; upstreamTTFBms?: string}) { this.emit('info', '[stream] response.headers', { ...meta, sessionId: this.uiSid }); }
  error(status: number, bodySnippet: string, _willReport: boolean, model?: string, url?: string, payload?: any) {
    this.emit('error', '[stream] response.error', { status, bodySnippet, sessionId: this.uiSid, model, url, payload })
  }
  textDelta(delta: string, fullText: string) { this.emit('debug', '[stream] text.delta', { delta, fullText, sessionId: this.uiSid }); }
  jsonDelta(delta: string) { this.emit('debug', '[stream] json.delta', { delta, sessionId: this.uiSid }); }
  sse(eventType: string) { this.emit('debug', '[stream] sse', { eventType, sessionId: this.uiSid }); }
  sseSuppressed() { this.emit('debug', '[stream] sse.suppressed', { sessionId: this.uiSid }); }
  perfSlice(data: any) { this.emit('debug', '[stream] perf.slice', { ...data, sessionId: this.uiSid }); }
  perfSample(data: any) { this.emit('debug', '[stream] perf', { ...data, sessionId: this.uiSid }); }
  parseSlow(ms: number) { this.emit('warn', '[stream] perf.parseSlow', { ms, sessionId: this.uiSid }); }
  heartbeat(note: string) { this.emit('debug', '[stream] heartbeat', { note, sessionId: this.uiSid }); }
  aborted() { this.emit('warn', '[stream] aborted', { sessionId: this.uiSid }); }
  pipelineDiff(primaryLen: number, secondaryLen: number, sessionId: string) { this.emit('debug', '[stream] pipeline.diff', { primaryLen, secondaryLen, sessionId }); }
  clearRetry() { /* noop */ }
  static noop(): StreamDebug { return new StreamDebug('', undefined); }
}
