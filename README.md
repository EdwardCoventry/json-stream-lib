json-stream-lib
Lightweight helpers for working with streamed AI responses:
- StreamParser accumulates arbitrarily chunked text and emits parseable JSON snapshots as soon as they are valid.
- Streaming utilities (SSE frame queue, delta assembler, retry/backoff, watchdogs) for wiring up text/JSON deltas from an AI backend. Used in the `what-kind-of-are-you` app to consume structured SSE responses.

Install
- `npm install @edwardcoventry/json-stream-lib` (or use the local workspace alias `@json-stream-lib` as in the app)
- `npm run build` to emit CJS/ESM/d.ts into `dist/`

Incremental JSON parsing (StreamParser)
The parser is resilient to any chunking; call `parse(chunk, isFinal)` for each string chunk. It yields `StreamParseResult` when something changed or when the stream completes.
```ts
import { StreamParser } from '@edwardcoventry/json-stream-lib';

const parser = new StreamParser();
const chunks = ['{"a":1', ',"b":', '2}'];

for (const [i, chunk] of chunks.entries()) {
  const res = parser.parse(chunk, i === chunks.length - 1);
  if (!res) continue;

  if (res.event === 'JSON_STARTED') console.log('started');
  if (res.status === 'PARTIAL') console.log('partial', res.data);
  if (res.status === 'COMPLETED') console.log('final', res.data); // -> {a:1, b:2}
  console.log('forced closures used:', res.forced_closures);
}
```

Streaming pipeline (SSE helpers)
`runStreamingPipeline` posts a payload to an SSE endpoint, retries on transient failures, and stitches together text/JSON deltas. It expects event types such as `response.output_text.delta`, `response.output_json.delta`, `response.content_part.added`, and the `[DONE]` sentinel.
```ts
import { runStreamingPipeline, NetworkPolicy, StreamDebug } from '@edwardcoventry/json-stream-lib';

const apiBase = 'https://your-api';
const abort = new AbortController();

await runStreamingPipeline({
  url: `${apiBase}/api/responses`,
  payload: { model: 'gpt-4', messages },
  uiSid: 'ui-session-123',                 // for logging
  isJsonStructured: true,                  // treat deltas as JSON strings instead of raw text
  policy: NetworkPolicy.fromCurrent(),     // retry/backoff/timeouts
  dbg: new StreamDebug('ui-session-123', console),
  maxFrames: 256,
  maxBytes: 2_000_000,
  abortSignal: abort.signal,
  onDeltaText: (delta, fullText) => console.log('delta', delta, 'full', fullText),
  onDone: (final) => console.log('final assembled payload', final),
});
```
You can pass a `qr` object shaped like `QueryResponse` from the app to receive lifecycle callbacks (`markHeaders`, `pushTextDelta`, `pushJsonDelta`, etc.).

Exports
- Top-level: `StreamParser`, `JsonCloser`, `Status`, `StreamParseResult`
- Streaming: `runStreamingPipeline`, `NetworkPolicy`, `StreamDebug`, `DeltaAssembler`, `DeltaThrottler`, `FrameQueue`, `SliceScheduler`, `createWatchdogs`, `parseSseFrame`, `routeParsedEvent`, retry types, and related helpers under `streaming/`.

