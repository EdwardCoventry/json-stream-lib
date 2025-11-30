import {RawJsonStreamParser, type RawJsonParseResult, type RawJsonStatus} from '../../jsonStream.js';

export type RawJsonStreamEvent =
  | { type: 'start' }
  | { type: 'chunk'; data: { chunk: string } }
  | { type: 'json-start'; data: { index: number } }
  | { type: 'partial'; data: { index: number; value: any; forcedClosures: number; status: RawJsonStatus } }
  | { type: 'ready'; data: { index: number; value: any; forcedClosures: number } }
  | { type: 'complete'; data: { index: number; value: any; forcedClosures: number } }
  | { type: 'error'; error: any };

export type RawJsonStreamOptions<TChunk = string> = {
  source: AsyncIterable<TChunk> | Iterable<TChunk>;
  parser?: RawJsonStreamParser;
  onEvent?: (ev: RawJsonStreamEvent) => void;
  onPartial?: (value: any, meta: { index: number; forcedClosures: number; status: RawJsonStatus }) => void;
  onComplete?: (value: any, meta: { index: number; forcedClosures: number }) => void;
  coerce?: (chunk: TChunk) => string;
};

function emitParseResult(
  res: RawJsonParseResult | null,
  emit: (ev: RawJsonStreamEvent) => void,
  onPartial?: RawJsonStreamOptions['onPartial'],
  onComplete?: RawJsonStreamOptions['onComplete'],
) {
  if (!res) return;
  const { index, status, data, forcedClosures } = res;
  if (res.event === 'JSON_STARTED') emit({ type: 'json-start', data: { index } });
  if (status === 'PARTIAL' && data) {
    emit({ type: 'partial', data: { index, value: data, forcedClosures, status } });
    onPartial?.(data, { index, forcedClosures, status });
  }
  if (status === 'COMPLETED' && data) {
    emit({ type: 'ready', data: { index, value: data, forcedClosures } });
    emit({ type: 'complete', data: { index, value: data, forcedClosures } });
    onComplete?.(data, { index, forcedClosures });
  }
}

/**
 * Consumes any async/iterable stream of text chunks and emits JSON parse events
 * (partial and completed snapshots). Intended for raw text streams that are
 * not already structured as JSON deltas.
 */
export async function runRawJsonStream<TChunk = string>(opts: RawJsonStreamOptions<TChunk>) {
  const parser = opts.parser ?? new RawJsonStreamParser();
  const coerce = opts.coerce ?? ((c: TChunk) => String(c ?? ''));
  const emit = opts.onEvent ?? (() => {});

  emit({ type: 'start' });
  try {
    for await (const rawChunk of opts.source as any) {
      const chunk = coerce(rawChunk);
      emit({ type: 'chunk', data: { chunk } });
      const res = parser.parse(chunk, false);
      emitParseResult(res, emit, opts.onPartial, opts.onComplete);
    }
    const finalRes = parser.parse('', true);
    emitParseResult(finalRes, emit, opts.onPartial, opts.onComplete);
  } catch (error) {
    emit({ type: 'error', error });
    throw error;
  }
}

/**
 * Helper patterned after the recipe/text-only flow: incrementally parse text
 * deltas and emit domain-friendly events without wiring an async iterable.
 */
export function createRawJsonEmitter(onEvent: (ev: RawJsonStreamEvent) => void) {
  let parser = new RawJsonStreamParser();
  const emit = (ev: RawJsonStreamEvent) => {
    try { onEvent(ev); } catch {}
  };
  return {
    push(chunk: string, isFinal = false) {
      emit({ type: 'chunk', data: { chunk } });
      const res = parser.parse(String(chunk ?? ''), isFinal);
      emitParseResult(res, emit);
    },
    finalize() {
      const res = parser.parse('', true);
      emitParseResult(res, emit);
    },
    reset() {
      parser = new RawJsonStreamParser();
    },
  };
}

/**
 * Convenience wrapper to plug SSE text delta events into the raw JSON parser.
 */
export async function wrapSseTextStreamWithParser(
  source: AsyncIterable<{ delta?: string } | string> | Iterable<{ delta?: string } | string>,
  opts: Omit<RawJsonStreamOptions<string | { delta?: string }>, 'source'> = {},
) {
  const coerce = opts.coerce ?? ((c: any) => (typeof c === 'string' ? c : String((c as any)?.delta ?? '')));
  await runRawJsonStream<{ delta?: string } | string>({ ...opts, source, coerce });
}
