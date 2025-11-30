# json-stream-lib

Helpers for two streaming modes:
- Structured JSON deltas for SSE-based Responses APIs.
- Raw text streams you still want to treat as JSON.

## Install
```bash
npm install @edwardcoventry/json-stream-lib
```
Requires Node 18+ (for the built-in `fetch`) or a browser environment.

## Choosing a path
| Your SSE payloads look like… | Use this namespace |
| --- | --- |
| `response.output_json.delta` / `response.content_part.added` objects | `streaming/json-delta` (runJsonResponsesStream / runJsonDeltaPipeline) |
| Plain text chunks that should resolve to JSON | `streaming/raw-json` (RawJsonStreamParser / runRawJsonStream) |

## Structured JSON deltas (Responses API)
Handles SSE events such as `response.output_json.delta`, `response.output_text.delta`, `response.content_part.added`, `response.output_item.done`, and `[DONE]`. Deltas are merged for you and exposed as both text and structured JSON slices.
```ts
import {
  runJsonResponsesStream,
  JsonDeltaDebugLogger,
  NetworkPolicy,
  QueryResponse,
} from '@edwardcoventry/json-stream-lib/streaming/json-delta';

const qr = new QueryResponse('ui-session-123', 'result', { listenToDom: false });

await runJsonResponsesStream(
  [{ role: 'user', content: 'Hello!' }],
  'gpt-4.1',
  {
    onDeltaText: (delta, full) => console.log('delta', delta, 'full', full),
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
  if (ev.type === 'json-partial') {
    // Merge structured deltas as they arrive (response.output_json.delta payloads)
    console.log('partial JSON', ev.data.value);
  }
  if (ev.type === 'json-completed') {
    console.log('completed JSON object', ev.data.value);
  }
});
```
Need lower-level control? `runJsonDeltaPipeline` streams directly against a URL/payload pair while still routing `response.output_json.delta` via `routeJsonDeltaEvent`, throttling with `JsonDeltaThrottler`, and assembling text/tool calls with `JsonDeltaAssembler`.
See `docs/structured-json-deltas.md` for a fuller walkthrough.

## Raw text to JSON (manual parsing)
Use when the upstream only emits text (e.g., `response.output_text.delta`) and you still want incremental JSON.
```ts
import { runRawJsonStream } from '@edwardcoventry/json-stream-lib/streaming/raw-json';

await runRawJsonStream({
  source: ['{"a":1', ',"b":2', '}'],
  onPartial: (value) => console.log('partial JSON', value),
  onComplete: (value) => console.log('complete JSON', value),
});
```
For manual control, `RawJsonStreamParser` exposes `parse(chunk, isFinal)` and emits `{status: 'PARTIAL' | 'COMPLETED', data, forcedClosures, event?: 'JSON_STARTED'}`. It auto-completes literal prefixes (`tr` → `true`, `fal` → `false`, `nu` → `null`) when they appear at value boundaries and still emits a change when a forced close is later replaced by a real brace/bracket. More in `docs/raw-text-to-json.md`.

## Core primitives
Reusable building blocks live under `streaming/core`: `NetworkPolicy`, `FrameQueue`, `SliceScheduler`, `RetryManager`, `createWatchdogs`, `parseSseFrame`, `runWithShadow`, `WatchdogManager`, retry enums, and related types.

## Events and debug helpers
`emitJsonDeltaDebugEvent`, `emitJsonDeltaErrorReport`, and `emitJsonDeltaRetryEvent` expose observable hooks (DOM CustomEvents) for logging, metrics, and UI reporting.

## Examples and docs
- Structured JSON deltas: `docs/structured-json-deltas.md`
- Raw text to JSON: `docs/raw-text-to-json.md`
- Quiz app (JSON deltas): `examples/quiz-app.md`
- Status monitor (raw text stream): `examples/status-monitor.md`

## Build and test
```bash
npm run build
npm test
```

## Publish checklist
- `npm test` (runs a fresh build and test suite)
- `npm publish --access public`
- Tag the release in git if you want changelog continuity
