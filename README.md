# json-stream-lib

Incremental JSON streaming helpers for SSE responses and raw text streams (preview `0.0.6`).

## What it does
Helps you turn streaming AI responses into usable text and JSON as they arrive instead of waiting for a full payload.
- Merge structured SSE deltas (`response.output_json.delta`, `response.output_text.delta`, `response.content_part.added`, `[DONE]`) into partial + final JSON plus text slices.
- Parse plain text streams into JSON with partial/completed callbacks and auto-closure support for braces/brackets/booleans/nulls.
- Emit tracked field/array events (start/item/end) as raw JSON closes naturally (no forced closure).
- Reuse throttling, retry, watchdog, and DOM debug primitives to plug into browsers or Node.

## Install
Drop it into any Node 18+ or browser project and import the pieces you need.
```bash
npm install @edwardcoventry/json-stream-lib
```
Requires Node 18+ (built-in `fetch`) or a browser environment.

## Quick start
A couple of common paths to get streaming JSON/text working quickly.

### Structured JSON deltas (Responses API)
Use when the upstream already emits structured JSON fragments and you want merged text + JSON slices as the stream flows.
```ts
import {
  runJsonResponsesStream,
  JsonDeltaDebugLogger,
  NetworkPolicy,
  QueryResponse,
} from '@edwardcoventry/json-stream-lib/streaming/json-delta';

const qr = new QueryResponse('ui-session-123', 'result', { listenToDom: false });

await runJsonResponsesStream(
  [{ role: 'user', content: 'Send structured JSON' }],
  'gpt-4.1',
  {
    onDeltaText: (delta, full) => console.log('text/json delta', delta, 'full', full),
    onDone: (final) => console.log('final assistant message', final),
  },
  {
    text: { format: { type: 'json_schema', value: {/* schema */} } },
    clientSessionId: 'ui-session-123',
    qr,
    policy: NetworkPolicy.fromCurrent(),
    dbg: new JsonDeltaDebugLogger('ui-session-123', qr),
  },
);

qr.onEvent((ev) => {
  if (ev.type === 'json-partial') console.log('partial payload', ev.data.value);
  if (ev.type === 'json-completed') console.log('completed JSON object', ev.data.value);
});
```
Lower-level control: `runJsonDeltaPipeline` works directly with a URL/payload pair while routing events via `routeJsonDeltaEvent`. See `docs/structured-json-deltas.md` for a fuller walkthrough.

### Raw text to JSON (manual parsing)
Use when the upstream only emits plain text and you still want incremental JSON snapshots while the stream is open.
```ts
import { runRawJsonStream } from '@edwardcoventry/json-stream-lib/streaming/raw-json';

await runRawJsonStream({
  source: ['{"a":1', ',"b":2', '}'],
  onPartial: (value) => console.log('partial JSON', value),
  onComplete: (value) => console.log('complete JSON', value),
});
```
Need array-item or field events as soon as they close (no auto-close)? Use the path emitter.
```ts
import { createJsonPathStreamEmitter } from '@edwardcoventry/json-stream-lib/streaming/raw-json';

const events: Array<{ type: string; data: any }> = [];
const emitter = createJsonPathStreamEmitter({
  arrays: ['stages', 'ingredients'],
  fields: ['title', 'nutrition.calories'],
  onEvent: (ev) => events.push(ev),
});

for (const chunk of textChunks) emitter.push(chunk);
emitter.finalize();
```
`createJsonPathStreamEmitter` emits:
- `array-start` when a tracked array opens
- `array-item` for each fully closed item
- `array-end` when the tracked array closes
along with `field` events for tracked fields.
For manual control, `RawJsonStreamParser` exposes `parse(chunk, isFinal)` and emits `{status: 'PARTIAL' | 'COMPLETED', data, forcedClosures, event?: 'JSON_STARTED'}`. It auto-completes literal prefixes (`tr` → `true`, `fal` → `false`, `nu` → `null`) when they appear at value boundaries and still emits a change when a forced close is later replaced by a real brace/bracket. More in `docs/raw-text-to-json.md`. Empty container emission is enabled by default; disable via `new RawJsonStreamParser({ emitEmptyContainers: false })` or `runRawJsonStream({ emitEmptyContainers: false, ... })`.

## API entry points
Import paths for the most commonly used helpers.
- `@edwardcoventry/json-stream-lib/streaming/json-delta`: `runJsonResponsesStream`, `runJsonDeltaPipeline`, `JsonDeltaDebugLogger`, `QueryResponse`, `NetworkPolicy`.
- `@edwardcoventry/json-stream-lib/streaming/raw-json`: `RawJsonStreamParser`, `runRawJsonStream`, `createJsonPathStreamEmitter`.
- `@edwardcoventry/json-stream-lib/streaming/core`: `FrameQueue`, `SliceScheduler`, `RetryManager`, `parseSseFrame`, `runWithShadow`, `createWatchdogs`, retry enums, and helpers.
- `@edwardcoventry/json-stream-lib/query`: `QueryResponse` event aggregator (also re-exported via `streaming/json-delta`).

## Docs and examples
Read more or copy working patterns.
- Structured JSON deltas: `docs/structured-json-deltas.md`
- Raw text to JSON: `docs/raw-text-to-json.md`
- Quiz app (JSON deltas): `examples/quiz-app.md`
- Status monitor (raw text stream): `examples/status-monitor.md`

## Debug and utilities
Hooks for logging, retries, and flow control.
- `emitJsonDeltaDebugEvent`, `emitJsonDeltaErrorReport`, and `emitJsonDeltaRetryEvent` expose DOM `CustomEvent`s for logging, metrics, and UI reporting.
- Throttling via `JsonDeltaThrottler`, assembly via `JsonDeltaAssembler`, plus retry/watchdog helpers in `streaming/core`.

## Development
For contributors and maintainers.
- Requires Node 18+.
- For build/test/publish notes, see `DEVELOPMENT.md` (kept out of the npm package; only `dist` ships).
