import {JsonDeltaDebugLogger} from '../debug/StreamDebug.js';
import {JsonDeltaAssembler} from '../delta/DeltaAssembler.js';
import {JsonDeltaThrottler} from '../delta/DeltaThrottler.js';
import {FrameQueue} from '../frames/FrameQueue.js';
import {SliceScheduler} from '../frames/SliceScheduler.js';
import {createWatchdogs} from '../net/Watchdogs.js';
import {buildStreamError} from '../errors/StreamErrors.js';
import {NetworkPolicy} from '../policy/NetworkPolicy.js';
import {RetryManager} from '../retry/RetryManager.js';
import {parseSseFrame} from '../parse/SseParser.js';
import {routeJsonDeltaEvent} from '../parse/JsonEventRouter.js';
import {JsonDeltaRetryReason} from '../types.js';

export interface JsonDeltaPipelineOptions {
  url: string;
  payload: any;
  uiSid: string;
  isJsonStructured: boolean;
  policy: NetworkPolicy;
  dbg: JsonDeltaDebugLogger;
  maxFrames: number;
  maxBytes: number;
  abortSignal?: AbortSignal;
  onDone?: (final: any) => void;
  onDeltaText?: (delta: string, full: string) => void;
  qr?: any; // QueryResponse (typed loosely to avoid import cycle)
}

const MAX_FRAMES_PER_SLICE = 25;
const MAX_SLICE_MS = 12;
const MAX_EMPTY_READS = 64;
const DRAIN_TIMEOUT_MS = 1500;
const DEFAULT_STALL_MS = 45_000;

type AttemptState = {
  assembler: JsonDeltaAssembler;
  throttler: JsonDeltaThrottler;
  ctl: AbortController;
  dogs: ReturnType<typeof createWatchdogs>;
  frameQueue: FrameQueue;
  isDoneBySentinel: () => boolean;
  triggerDoneAbort: () => void;
  finalizeSuccess: () => Promise<any>;
};

type PerfTracker = {
  noteParse: () => void;
  noteParseError: () => void;
  emit: (sliceFrames: number, sliceMs: number, depth: number) => void;
};

export async function runJsonDeltaPipeline(opts: JsonDeltaPipelineOptions) {
  const {url, payload, policy, dbg, isJsonStructured} = opts;
  const retryManager = new RetryManager();
  let attempt = 0;
  let lastErr: any = null;

  while (attempt < policy.maxAttempts) {
    attempt += 1;
    const attemptState = createAttemptState(opts, policy, dbg);
    dbg.requestStart((payload as any)?.model, payload);

    try {
      const r = await fetch(url, {method:'POST', headers:{'Content-Type':'application/json', Accept:'text/event-stream'}, body: JSON.stringify(payload), signal: attemptState.ctl.signal});
      if (!r.ok || !r.body) {
        const failure = await handleResponseFailure(r, attempt, policy, retryManager, dbg, payload, url);
        lastErr = failure.err;
        if (failure.retry) continue;
        return Promise.reject(failure.err);
      }
      // Emit headers/meta
      emitHeaders(r, dbg, opts);

      attemptState.dogs.start();
      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      const perfTracker = createPerfTracker(dbg);
      const markFirstByte = createFirstByteMarker(opts.qr);
      const processFrame = buildFrameProcessor(
        attemptState,
        opts,
        dbg,
        isJsonStructured,
        perfTracker,
        markFirstByte,
      );
      const scheduler = new SliceScheduler(attemptState.frameQueue, {
        maxFramesPerSlice: MAX_FRAMES_PER_SLICE,
        maxSliceMs: MAX_SLICE_MS,
        processFrame,
        onPerfSlice: perfTracker.emit,
        abortSignal: attemptState.ctl.signal,
      });

      await pumpResponse(reader, decoder, attemptState.frameQueue, scheduler, attemptState, maxEmptyReadsForPolicy(policy), MAX_EMPTY_READS);
      return attemptState.finalizeSuccess();
    } catch (e:any) {
      const outcome = await handleAttemptError(e, attempt, policy, retryManager, attemptState, dbg);
      if (outcome.err) lastErr = outcome.err;
      if (outcome.type === 'retry') continue;
      if (outcome.type === 'sentinel' || outcome.type === 'abort') return outcome.result;
      return Promise.reject(outcome.err);
    } finally {
      attemptState.dogs.dispose();
    }
  }
  return Promise.reject(lastErr);
}

function createAttemptState(opts: JsonDeltaPipelineOptions, policy: NetworkPolicy, dbg: JsonDeltaDebugLogger): AttemptState {
  const assembler = new JsonDeltaAssembler();
  const throttler = new JsonDeltaThrottler((chunk) => {
    try { opts.onDeltaText?.(chunk, assembler.fullText()); } catch {}
  });
  const ctl = new AbortController();
  opts.abortSignal?.addEventListener('abort', () => ctl.abort(), {once: true});
  // Always enforce a mid-stream stall guard even if user config sets 0
  const stallMs = policy.midStreamStallMs > 0 ? policy.midStreamStallMs : DEFAULT_STALL_MS;
  const dogs = createWatchdogs(policy.ttfbMs, stallMs, () => ctl.abort());
  const frameQueue = new FrameQueue(opts.maxFrames, opts.maxBytes);
  let doneBySentinel = false;

  const finalizeSuccess = async () => {
    try { frameQueue.markReaderFinished(); } catch {}
    // Drain with a timeout so we never hang if the scheduler stops mid-abort
    try {
      await Promise.race([
        frameQueue.drain(),
        new Promise((res) => setTimeout(res, DRAIN_TIMEOUT_MS)),
      ]);
    } catch {}
    dbg.clearRetry();
    const finalPayload = assembler.final();
    try { opts.onDone?.(finalPayload); } catch {}
    try { opts.qr?.markCompleted?.(); } catch {}
    return finalPayload;
  };

  const triggerDoneAbort = () => {
    if (doneBySentinel) return;
    doneBySentinel = true;
    try { frameQueue.markReaderFinished(); } catch {}
    try { frameQueue.abort(); } catch {}
    const abortFetch = () => { if (!ctl.signal.aborted) { try { ctl.abort(); } catch {} } };
    if (typeof queueMicrotask === 'function') queueMicrotask(abortFetch);
    else setTimeout(abortFetch, 0);
  };

  return {
    assembler,
    throttler,
    ctl,
    dogs,
    frameQueue,
    isDoneBySentinel: () => doneBySentinel,
    triggerDoneAbort,
    finalizeSuccess,
  };
}

function emitHeaders(r: Response, dbg: JsonDeltaDebugLogger, opts: JsonDeltaPipelineOptions) {
  try {
    const requestId = r.headers.get('x-request-id') || '';
    const modelUsed = r.headers.get('x-model-used') || '';
    const coldStart = r.headers.get('x-cold-start') || '';
    const upstreamTTFB = r.headers.get('x-upstream-ttfb-ms') || '';
    dbg.headers({requestId, model: modelUsed, coldStart, upstreamTTFBms: upstreamTTFB});
    opts.qr?.markHeaders?.();
    opts.qr?.pushHeaders?.({requestId, modelUsed, coldStart, upstreamTTFB});
    opts.qr?.pushMeta?.({status: (r as any).status, requestId, model: modelUsed});
  } catch {}
}

function createPerfTracker(dbg: JsonDeltaDebugLogger): PerfTracker {
  let parseCount = 0;
  let parseErrors = 0;
  let lastPerfEmit = Date.now();
  return {
    noteParse: () => { parseCount += 1; },
    noteParseError: () => { parseErrors += 1; },
    emit: (sliceFrames: number, sliceMs: number, depth: number) => {
      const now = Date.now();
      if (now - lastPerfEmit > 1000) {
        dbg.perfSlice({sliceFrames, sliceMs: Math.round(sliceMs), queueDepth: depth, parseCount, parseErrors});
        lastPerfEmit = now;
      }
    },
  };
}

function createFirstByteMarker(qr?: any) {
  let marked = false;
  return () => {
    if (marked) return;
    marked = true;
    try { qr?.markFirstByte?.(); } catch {}
  };
}

function buildFrameProcessor(
  attempt: AttemptState,
  opts: JsonDeltaPipelineOptions,
  dbg: JsonDeltaDebugLogger,
  isJsonStructured: boolean,
  perf: PerfTracker,
  markFirstByte: () => void,
) {
  const {assembler, throttler} = attempt;
  return (frame: string) => {
    const events = parseSseFrame(frame);
    for (const ev of events) {
      if (ev.notes) for (const n of ev.notes) dbg.heartbeat(n);
      dbg.sse(ev.eventType);
      for (const data of ev.data) {
        if (data === '[DONE]') { attempt.triggerDoneAbort(); continue; }
        try {
          routeJsonDeltaEvent(ev.eventType, data, isJsonStructured, {
            handleTextDelta: (d) => {
              assembler.addText(d);
              throttler.enqueue(d);
              dbg.textDelta(d, assembler.fullText());
              opts.qr?.pushTextDelta?.(d, assembler.fullText());
            },
            handleJsonDelta: (d) => {
              assembler.addJson(d);
              throttler.enqueue(d);
              dbg.jsonDelta(d);
              opts.qr?.pushJsonDelta?.(d);
            },
            mergeDelta: (delta) => { assembler.mergeGeneric(delta); },
            markCompleted: () => { opts.qr?.markCompleted?.(); },
          });
          markFirstByte();
          perf.noteParse();
        } catch {
          perf.noteParseError();
        }
      }
    }
  };
}

async function pumpResponse(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  decoder: TextDecoder,
  frameQueue: FrameQueue,
  scheduler: SliceScheduler,
  attempt: AttemptState,
  maxEmptyReads: number,
  defaultEmptyReads: number,
) {
  let emptyReads = 0;
  const flush = (chunk: string) => { frameQueue.push(chunk); scheduler.ensureScheduled(); };
  while (!attempt.ctl.signal.aborted) {
    const {value, done} = await reader.read();
    if (attempt.ctl.signal.aborted || done) break;
    const chunk = decoder.decode(value || new Uint8Array(), {stream: true});
    if (!chunk) {
      emptyReads += 1;
      const limit = maxEmptyReads || defaultEmptyReads;
      if (emptyReads >= limit) { attempt.triggerDoneAbort(); break; }
      continue;
    }
    emptyReads = 0;
    attempt.dogs.onChunk();
    flush(chunk);
  }
}

async function handleResponseFailure(
  r: Response,
  attempt: number,
  policy: NetworkPolicy,
  retryManager: RetryManager,
  dbg: JsonDeltaDebugLogger,
  payload: any,
  url: string,
): Promise<{retry: boolean; err: any}> {
  const errText = await r.text().catch(() => '');
  const statusNum = (r as any).status | 0;
  const classification = policy.classifyStatus(statusNum);
  const errShape = buildStreamError({
    status: statusNum,
    message: 'Upstream error',
    retryable: classification.retryable,
    attempt,
    maxAttempts: policy.maxAttempts,
    bodySnippet: errText,
  });
  dbg.error(statusNum, errText.slice(0, 1000), attempt >= policy.maxAttempts, (payload as any)?.model, url, payload);
  if (attempt < policy.maxAttempts && classification.retryable) {
    await retryManager.schedule({
      attemptNext: attempt + 1,
      maxAttempts: policy.maxAttempts,
      ms: policy.backoff(attempt),
      reason: classification.reason || JsonDeltaRetryReason.Upstream,
    });
    return {retry: true, err: errShape};
  }
  return {retry: false, err: errShape};
}

async function handleAttemptError(
  error: any,
  attempt: number,
  policy: NetworkPolicy,
  retryManager: RetryManager,
  attemptState: AttemptState,
  dbg: JsonDeltaDebugLogger,
): Promise<{type: 'retry' | 'sentinel' | 'abort' | 'fatal'; err?: any; result?: any}> {
  const isAbort = error?.name === 'AbortError' || /aborted/i.test(String(error?.message || ''));
  if (isAbort && attemptState.isDoneBySentinel()) {
    try { attemptState.frameQueue.abort(); } catch {}
    const result = await attemptState.finalizeSuccess();
    return {type: 'sentinel', result};
  }
  if (isAbort) {
    dbg.aborted();
    try { attemptState.frameQueue.abort(); } catch {}
    return {type: 'abort', result: attemptState.assembler.final()};
  }
  const errShape = buildStreamError({message: String(error?.message || 'stream aborted'), attempt, maxAttempts: policy.maxAttempts});
  if (attempt < policy.maxAttempts) {
    await retryManager.schedule({
      attemptNext: attempt + 1,
      maxAttempts: policy.maxAttempts,
      ms: policy.backoff(attempt),
      reason: JsonDeltaRetryReason.Upstream,
    });
    return {type: 'retry', err: errShape};
  }
  return {type: 'fatal', err: errShape};
}

function maxEmptyReadsForPolicy(policy: NetworkPolicy): number {
  // Allows future tuning based on policy; currently mirrors the constant.
  return MAX_EMPTY_READS;
}
