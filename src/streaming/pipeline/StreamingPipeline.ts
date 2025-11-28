import {StreamDebug} from '../debug/StreamDebug';
import {DeltaAssembler} from '../delta/DeltaAssembler';
import {DeltaThrottler} from '../delta/DeltaThrottler';
import {FrameQueue} from '../frames/FrameQueue';
import {SliceScheduler} from '../frames/SliceScheduler';
import {createWatchdogs} from '../net/Watchdogs';
import {buildStreamError} from '../errors/StreamErrors';
import {NetworkPolicy} from '../policy/NetworkPolicy';
import {RetryManager} from '../retry/RetryManager';
import {parseSseFrame} from '../parse/SseParser';
import {routeParsedEvent} from '../parse/JsonEventRouter';
import {RetryReason} from '../types';

export interface PipelineOptions {
  url: string;
  payload: any;
  uiSid: string;
  isJsonStructured: boolean;
  policy: NetworkPolicy;
  dbg: StreamDebug;
  maxFrames: number;
  maxBytes: number;
  abortSignal?: AbortSignal;
  onDone?: (final: any) => void;
  onDeltaText?: (delta: string, fullText: string) => void;
  qr?: any; // Optional query response object
}

export async function runStreamingPipeline(opts: PipelineOptions) {
  const {url, payload, policy, dbg, isJsonStructured, maxFrames, maxBytes} = opts;
  const retryManager = new RetryManager();
  let attempt = 0; let lastErr: any = null;
  while (attempt < policy.maxAttempts) {
    attempt += 1;
    const assembler = new DeltaAssembler();
    const throttler = new DeltaThrottler((chunk) => { try { opts.onDeltaText?.(chunk, assembler.fullText()); } catch {} });
    const ctl = new AbortController();
    opts.abortSignal?.addEventListener('abort', () => ctl.abort(), {once:true});
    // Always enforce a mid-stream stall guard even if user config sets 0
    const stallMs = policy.midStreamStallMs > 0 ? policy.midStreamStallMs : 45_000;
    const dogs = createWatchdogs(policy.ttfbMs, stallMs, () => ctl.abort());
    dbg.requestStart((payload as any)?.model, payload);

    const frameQueue = new FrameQueue(maxFrames, maxBytes);
    let doneBySentinel = false;
    const finalizeSuccess = async () => {
      try { frameQueue.markReaderFinished(); } catch {}
      // Drain with a timeout so we never hang if the scheduler stops mid-abort
      try {
        await Promise.race([
          frameQueue.drain(),
          new Promise((res) => setTimeout(res, 1500))
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

    try {
      const r = await fetch(url, {method:'POST', headers:{'Content-Type':'application/json', Accept:'text/event-stream'}, body: JSON.stringify(payload), signal: ctl.signal});
      if (!r.ok || !r.body) {
        const errText = await r.text().catch(()=> '');
        const statusNum = (r as any).status | 0;
        const classification = policy.classifyStatus(statusNum);
        const errShape = buildStreamError({status:statusNum, message:'Upstream error', retryable: classification.retryable, attempt, maxAttempts:policy.maxAttempts, bodySnippet: errText});
        lastErr = errShape;
        dbg.error(statusNum, errText.slice(0,1000), attempt >= policy.maxAttempts, (payload as any)?.model, url, payload);
        if (attempt < policy.maxAttempts && classification.retryable) {
          await retryManager.schedule({attemptNext: attempt+1, maxAttempts: policy.maxAttempts, ms: policy.backoff(attempt), reason: classification.reason || RetryReason.Upstream });
          continue;
        }
        return Promise.reject(errShape);
      }
      // Emit headers/meta
      try {
        const requestId = (r.headers as any).get?.('x-request-id') || '';
        const modelUsed = (r.headers as any).get?.('x-model-used') || '';
        const coldStart = (r.headers as any).get?.('x-cold-start') || '';
        const upstreamTTFB = (r.headers as any).get?.('x-upstream-ttfb-ms') || '';
        dbg.headers({requestId, model: modelUsed, coldStart, upstreamTTFBms: upstreamTTFB});
        opts.qr?.markHeaders?.();
        opts.qr?.pushHeaders?.({requestId, modelUsed, coldStart, upstreamTTFB});
        opts.qr?.pushMeta?.({status: (r as any).status, requestId, model: modelUsed});
      } catch {}
      dogs.start();
      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      const MAX_FRAMES_PER_SLICE = 25; const MAX_SLICE_MS = 12;
      const MAX_EMPTY_READS = 64; // guard against tight loops on empty chunks
      let emptyReads = 0;
      let _parseCount = 0; let _parseErrors = 0; let lastPerfEmit = Date.now();
      let firstByteMarked = false;
      const emitPerf = (sliceFrames:number, sliceMs:number, depth:number) => {
        const now = Date.now();
        if (now - lastPerfEmit > 1000) { dbg.perfSlice({sliceFrames, sliceMs:Math.round(sliceMs), queueDepth:depth, parseCount:_parseCount, parseErrors:_parseErrors}); lastPerfEmit = now; }
      };
      const processFrame = (frame: string) => {
        const events = parseSseFrame(frame);
        for (const ev of events) {
          if (ev.notes) for (const n of ev.notes) dbg.heartbeat(n);
          dbg.sse(ev.eventType);
          for (const data of ev.data) {
            if (data === '[DONE]') { triggerDoneAbort(); continue; }
            try {
              routeParsedEvent(ev.eventType, data, isJsonStructured, {
                handleTextDelta: (d) => { assembler.addText(d); throttler.enqueue(d); dbg.textDelta(d, assembler.fullText()); opts.qr?.pushTextDelta?.(d, assembler.fullText()); },
                handleJsonDelta: (d) => { assembler.addJson(d); throttler.enqueue(d); dbg.jsonDelta(d); opts.qr?.pushJsonDelta?.(d); },
                mergeDelta: (delta) => { assembler.mergeGeneric(delta); },
                markCompleted: () => { opts.qr?.markCompleted?.(); }
              });
              if (!firstByteMarked) { firstByteMarked = true; opts.qr?.markFirstByte?.(); }
              _parseCount += 1;
            } catch { _parseErrors += 1; }
          }
        }
      };
      const scheduler = new SliceScheduler(frameQueue, {maxFramesPerSlice: MAX_FRAMES_PER_SLICE, maxSliceMs: MAX_SLICE_MS, processFrame, onPerfSlice: emitPerf, abortSignal: ctl.signal});
      const flush = (chunk: string) => { frameQueue.push(chunk); scheduler.ensureScheduled(); };
      while (!ctl.signal.aborted) {
        const {value, done} = await reader.read();
        if (ctl.signal.aborted) break;
        if (done) break;
        const chunk = decoder.decode(value || new Uint8Array(), {stream:true});
        if (!chunk) {
          emptyReads += 1;
          if (emptyReads >= MAX_EMPTY_READS) { triggerDoneAbort(); break; }
          continue;
        }
        emptyReads = 0;
        dogs.onChunk();
        flush(chunk);
      }
      frameQueue.markReaderFinished();
      await frameQueue.drain();
      return finalizeSuccess();
    } catch (e:any) {
      const isAbort = e?.name === 'AbortError' || /aborted/i.test(String(e?.message||''));
      if (isAbort && doneBySentinel) {
        try { frameQueue.abort(); } catch {}
        return finalizeSuccess();
      }
      if (isAbort) { dbg.aborted(); try { frameQueue.abort(); } catch {} return assembler.final(); }
      lastErr = buildStreamError({message: String(e?.message||'stream aborted'), attempt, maxAttempts: policy.maxAttempts});
      if (attempt < policy.maxAttempts) {
        await retryManager.schedule({attemptNext: attempt+1, maxAttempts: policy.maxAttempts, ms: policy.backoff(attempt), reason: RetryReason.Upstream});
        continue;
      }
      return Promise.reject(lastErr);
    } finally {
      dogs.dispose();
    }
  }
  return Promise.reject(lastErr);
}
