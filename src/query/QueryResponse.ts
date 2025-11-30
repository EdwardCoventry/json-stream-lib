import {RawJsonStreamParser, type RawJsonStatus} from '../jsonStream.js';
import {STREAM_EVENT_NAME} from '../streaming/utils/eventBus.js';

export type QueryResponseKind = string;
export type QueryResponseLogLevel = 'debug' | 'info' | 'warn' | 'error' | 'log';

export type QueryResponseLogger = Partial<Record<QueryResponseLogLevel, (...args: any[]) => void>>;

export type QueryResponseOptions = {
  listenToDom?: boolean;
  logger?: QueryResponseLogger;
  logEvents?: boolean;
  eventLogLevel?: QueryResponseLogLevel;
};

export type QueryResponseSnapshot<K extends string = string> = {
  id: string;
  kind: K;
  started: boolean;
  headers: boolean;
  firstByte: boolean;
  acked: boolean; // true if any of headers/firstByte/ack signal occurred
  completed: boolean;
  errored: boolean;
  response: {
    text: string;
    jsonText: string;
  };
};

export type QueryResponseEvent =
  | {type: 'headers'; data?: any; ts: number}
  | {type: 'first-byte'; data?: any; ts: number}
  | {type: 'text-delta'; data: {delta: string; fullText: string}; ts: number}
  | {type: 'json-delta'; data: {delta: string}; ts: number}
  | {type: 'json-started'; ts: number}
  | {type: 'json-partial'; data: {index: number; status: RawJsonStatus; forcedClosures: number; value: any}; ts: number}
  | {type: 'json-completed'; data: {index: number; value: any}; ts: number}
  | {type: 'sse'; data: {eventType: string}; ts: number}
  | {type: 'meta'; data: any; ts: number}
  | {type: 'completed'; ts: number}
  | {type: 'error'; data?: any; ts: number};

export type QueryResponseListener<K extends string = string> = (snap: QueryResponseSnapshot<K>) => void;
export type QueryResponseEventListener = (ev: QueryResponseEvent) => void;

type StreamEventDetail = {type?: string; data?: any};
type LifecycleFlags = {headers?: boolean; firstByte?: boolean; acked?: boolean};

const LOG_LEVELS: QueryResponseLogLevel[] = ['debug', 'info', 'warn', 'error', 'log'];

const toSafeLogger = (logger?: QueryResponseLogger | null): QueryResponseLogger | null => {
  if (!logger) return null;
  const safeLogger: QueryResponseLogger = {};
  for (const level of LOG_LEVELS) {
    const fn = (logger as any)[level] || (logger as any).log;
    if (typeof fn === 'function') {
      safeLogger[level] = (...args: any[]) => {
        try { fn(...args); } catch {}
      };
    }
  }
  return safeLogger;
};

/**
 * Tracks the lifecycle and payload of a streaming query keyed by sessionId.
 * Can listen to DOM events (STREAM_EVENT_NAME) or be driven via imperative push* calls.
 */
export class QueryResponse<K extends string = string> {
  readonly id: string;
  readonly kind: K;
  private readonly listeners = new Set<QueryResponseListener<K>>();
  private readonly eventListeners = new Set<QueryResponseEventListener>();
  private boundHandler?: (ev: any) => void;
  private readonly listenToDom: boolean;
  private logger: QueryResponseLogger | null;
  private logEventsFlag: boolean;
  private eventLogLevel: QueryResponseLogLevel;
  private lastEventTs: number | null = null;
  private responseTextAcc = '';
  private responseJsonAcc = '';
  private jsonParser = new RawJsonStreamParser();
  private startedFlag = false;
  private headersFlag = false;
  private firstByteFlag = false;
  private ackedFlag = false;
  private completedFlag = false;
  private erroredFlag = false;
  private lastJsonValue: any | null = null;
  private readonly clock = () => Date.now();

  constructor(id: string, kind: K = 'generic' as K, opts?: QueryResponseOptions) {
    this.id = id.trim();
    this.kind = kind;
    this.logger = toSafeLogger(opts?.logger);
    this.logEventsFlag = opts?.logEvents ?? Boolean(this.logger);
    this.eventLogLevel = opts?.eventLogLevel || 'debug';
    this.listenToDom = opts?.listenToDom !== false; // default true for compatibility
    if (!this.id) {
      // No-op if no id; stays inert
      return;
    }
    if (this.listenToDom && typeof window !== 'undefined') {
      this.boundHandler = (ev: any) => this.handleStreamEvent(ev);
      try {
        window.addEventListener(STREAM_EVENT_NAME as any, this.boundHandler as any);
      } catch {
        // ignore missing window
      }
    }
  }

  get started() { return this.startedFlag; }
  get headers() { return this.headersFlag; }
  get firstByte() { return this.firstByteFlag; }
  get acked() { return this.ackedFlag; }
  get completed() { return this.completedFlag; }
  get errored() { return this.erroredFlag; }
  get lastJson() { return this.lastJsonValue; }
  get responseText() { return this.responseTextAcc; }
  get responseJsonText() { return this.responseJsonAcc; }

  /** Reset only the streaming accumulators and JSON parser; keeps lifecycle flags. */
  resetStream() {
    this.responseTextAcc = '';
    this.responseJsonAcc = '';
    this.jsonParser = new RawJsonStreamParser();
    this.lastJsonValue = null;
  }

  dispose() {
    if (typeof window !== 'undefined' && this.boundHandler) {
      try { window.removeEventListener(STREAM_EVENT_NAME as any, this.boundHandler as any); } catch {}
    }
    this.listeners.clear();
    this.eventListeners.clear();
    this.boundHandler = undefined;
  }

  configureLogger(logger?: QueryResponseLogger | null, opts?: {logEvents?: boolean; eventLogLevel?: QueryResponseLogLevel}) {
    this.logger = toSafeLogger(logger);
    if (typeof opts?.logEvents === 'boolean') this.logEventsFlag = opts.logEvents;
    if (opts?.eventLogLevel) this.eventLogLevel = opts.eventLogLevel;
  }

  /** Subscribe to state changes; returns an unsubscribe function. */
  on(listener: QueryResponseListener<K>): () => void {
    this.listeners.add(listener);
    try { listener(this.snapshot()); } catch {}
    return () => { this.listeners.delete(listener); };
  }

  /** Subscribe to low-level events; returns an unsubscribe function. */
  onEvent(listener: QueryResponseEventListener): () => void {
    this.eventListeners.add(listener);
    return () => { this.eventListeners.delete(listener); };
  }

  snapshot(): QueryResponseSnapshot<K> {
    return {
      id: this.id,
      kind: this.kind,
      started: this.startedFlag,
      headers: this.headersFlag,
      firstByte: this.firstByteFlag,
      acked: this.ackedFlag,
      completed: this.completedFlag,
      errored: this.erroredFlag,
      response: {text: this.responseTextAcc, jsonText: this.responseJsonAcc},
    };
  }

  pushTextDelta(delta: string, fullText?: string) {
    const textDelta = String(delta || '');
    if (!textDelta) return;
    if (typeof fullText === 'string') this.responseTextAcc = fullText;
    else this.responseTextAcc += textDelta;
    this.emitEvent({type: 'text-delta', data: {delta: textDelta, fullText: this.responseTextAcc}, ts: this.clock()});
  }

  pushJsonDelta(delta: string) {
    const jsonDelta = String(delta || '');
    if (!jsonDelta) return;
    this.responseJsonAcc += jsonDelta;
    this.emitEvent({type: 'json-delta', data: {delta: jsonDelta}, ts: this.clock()});
    this.parseIncrementalJson(jsonDelta, false);
  }

  pushSseEvent(eventType: string) {
    const et = String(eventType || '');
    if (!et) return;
    this.emitEvent({type: 'sse', data: {eventType: et}, ts: this.clock()});
  }

  pushError(payload?: any) {
    this.erroredFlag = true;
    this.emitSnapshot();
    this.emitEvent({type: 'error', data: payload, ts: this.clock()});
  }

  pushMeta(meta: any) {
    this.emitEvent({type: 'meta', data: meta, ts: this.clock()});
  }

  pushHeaders(meta?: any) {
    this.emitEvent({type: 'headers', data: meta, ts: this.clock()});
  }

  markStarted() {
    if (!this.startedFlag) {
      this.startedFlag = true;
      this.emitSnapshot();
    }
  }

  markHeaders() {
    const changed = this.ensureFlags({headers: true, acked: true});
    if (changed) this.emitSnapshot();
    this.pushHeaders();
  }

  markFirstByte() {
    const changed = this.ensureFlags({firstByte: true, acked: true});
    if (changed) this.emitSnapshot();
    this.emitEvent({type: 'first-byte', ts: this.clock()});
  }

  markCompleted() {
    if (!this.completedFlag) {
      this.completedFlag = true;
      this.emitSnapshot();
    }
    this.parseIncrementalJson('', true);
    this.emitEvent({type: 'completed', ts: this.clock()});
  }

  markErrored() {
    if (!this.erroredFlag) {
      this.erroredFlag = true;
      this.emitSnapshot();
    }
    this.emitEvent({type: 'error', ts: this.clock()});
  }

  private ensureFlags(flags: LifecycleFlags): boolean {
    let changed = false;
    if (flags.headers && !this.headersFlag) { this.headersFlag = true; changed = true; }
    if (flags.firstByte && !this.firstByteFlag) { this.firstByteFlag = true; changed = true; }
    if (flags.acked && !this.ackedFlag) { this.ackedFlag = true; changed = true; }
    return changed;
  }

  private isPayloadSse(eventType?: string): boolean {
    const et = String(eventType || '');
    if (!et) return false;
    return (
      et.includes('response.output_text.delta') ||
      et.includes('response.message.delta') ||
      et === 'response.delta' ||
      et.includes('(json:response.output_text.delta)') ||
      et.includes('(json:response.message.delta)') ||
      et.includes('(json:response.delta)')
    );
  }

  private parseIncrementalJson(delta: string, isFinal: boolean) {
    try {
      const res = this.jsonParser.parse(delta, isFinal);
      if (!res) return;
      const ts = this.clock();
      if (res.event === 'JSON_STARTED') {
        this.emitEvent({type: 'json-started', ts});
      }
      if (res.data && typeof res.data === 'object') {
        const {index, status} = res;
        const forcedClosures = res.forcedClosures ?? 0;
        this.emitEvent({type: 'json-partial', data: {index, status, forcedClosures, value: res.data}, ts});
        if (status === 'COMPLETED') {
          this.lastJsonValue = res.data;
          this.emitEvent({type: 'json-completed', data: {index, value: res.data}, ts});
        }
      }
    } catch {
      // swallow parse errors
    }
  }

  private emitSnapshot() {
    const snap = this.snapshot();
    for (const listener of Array.from(this.listeners)) {
      try { listener(snap); } catch {}
    }
  }

  private emitEvent(ev: QueryResponseEvent) {
    const ts = typeof ev.ts === 'number' ? ev.ts : this.clock();
    const event = typeof ev.ts === 'number' ? ev : ({...ev, ts} as QueryResponseEvent);
    const deltaMs = this.lastEventTs === null ? 0 : ts - this.lastEventTs;
    this.lastEventTs = ts;
    this.logEvent(event, ts, deltaMs);
    for (const listener of Array.from(this.eventListeners)) {
      try { listener(event); } catch {}
    }
  }

  private handleStreamEvent(ev: any) {
    const detail: StreamEventDetail = ev?.detail || {};
    const data = detail.data || {};
    const sessionId = String(data.sessionId || '');
    if (!sessionId || sessionId !== this.id) return;

    const type = String(detail.type || '');
    if (!type) return;

    if (type === 'stream.start') return this.markStarted();
    if (type === 'response.headers') return this.markHeaders();

    if (
      type === 'delta' ||
      type === 'json.partial' ||
      type === 'json.stream' ||
      type === 'response.text.delta' ||
      type === 'response.json.delta' ||
      (type === 'response.sse' && this.isPayloadSse(data?.eventType))
    ) return this.markFirstByte();

    if (type === 'stream.end' || type === 'response.completed') return this.markCompleted();

    if (type === 'error' || type === 'response.error') this.pushError(data);
  }

  private logEvent(ev: QueryResponseEvent, ts: number, deltaMs: number) {
    if (!this.logEventsFlag || !this.logger) return;
    const logFn = this.logger[this.eventLogLevel] || this.logger.log;
    if (!logFn) return;
    const payload = {
      id: this.id,
      kind: this.kind,
      event: ev.type,
      ts,
      deltaMs,
      data: this.summarizeEventData(ev),
    };
    try { logFn(`[qr:${this.id}] ${ev.type}`, payload); } catch {}
  }

  private summarizeEventData(ev: QueryResponseEvent) {
    if (ev.type === 'text-delta') {
      return {deltaChars: ev.data?.delta?.length ?? 0, fullChars: ev.data?.fullText?.length ?? 0};
    }
    if (ev.type === 'json-delta') {
      return {deltaChars: ev.data?.delta?.length ?? 0};
    }
    if (ev.type === 'json-partial') {
      return {
        index: ev.data?.index,
        status: ev.data?.status,
        forcedClosures: ev.data?.forcedClosures ?? 0,
      };
    }
    if (ev.type === 'json-completed') {
      return {index: ev.data?.index, value: ev.data?.value};
    }
    if (ev.type === 'sse') return {eventType: ev.data?.eventType};
    if (ev.type === 'meta' || ev.type === 'headers' || ev.type === 'first-byte') return ev.data ?? null;
    if ('data' in ev) return (ev as any).data ?? null;
    return null;
  }
}
