# json-stream-lib

Incremental JSON streaming helpers for SSE responses and raw text streams (preview `0.0.0`).

## Features
- Merge structured SSE deltas (`response.output_json.delta`, `response.content_part.added`, `response.output_text.delta`, `[DONE]`) into partial/final JSON plus text slices.
- Parse plain text streams into JSON with partial + completed callbacks and auto-closure support for braces/brackets/booleans/nulls.
- Reusable primitives for throttling, retries, watchdogs, and DOM debug events to plug into UIs.

## Install
```bash
npm install @edwardcoventry/json-stream-lib
```
Requires Node 18+ (built-in `fetch`) or a browser environment.

## Entry points
- `@edwardcoventry/json-stream-lib/streaming/json-delta`: `runJsonResponsesStream`, `runJsonDeltaPipeline`, `JsonDeltaDebugLogger`, `QueryResponse`, `NetworkPolicy`.
- `@edwardcoventry/json-stream-lib/streaming/raw-json`: `RawJsonStreamParser`, `runRawJsonStream`.
- `@edwardcoventry/json-stream-lib/streaming/core`: `FrameQueue`, `SliceScheduler`, `RetryManager`, `parseSseFrame`, `runWithShadow`, `createWatchdogs`, retry enums, and helpers.
- `@edwardcoventry/json-stream-lib/query`: `QueryResponse` event aggregator (also re-exported via `streaming/json-delta`).

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
Need lower-level control? `runJsonDeltaPipeline` streams directly against a URL/payload pair while routing `response.output_json.delta` via `routeJsonDeltaEvent`, throttling with `JsonDeltaThrottler`, and assembling text/tool calls with `JsonDeltaAssembler`. See `docs/structured-json-deltas.md` for a fuller walkthrough.

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

## Debug and events
- `emitJsonDeltaDebugEvent`, `emitJsonDeltaErrorReport`, and `emitJsonDeltaRetryEvent` expose DOM CustomEvents for logging, metrics, and UI reporting.
- Throttling via `JsonDeltaThrottler`, assembly via `JsonDeltaAssembler`, plus retry/watchdog helpers in `streaming/core`.

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
`npm test` runs a fresh TypeScript build and executes the Node test suite from `dist/__tests__`.

## Publish (maintainers)
Automated (recommended):
1. Create an npm automation token with publish rights and add it as repo secret `NPM_TOKEN`.
2. Bump + tag: `npm version patch|minor|major` (or `npm version 0.0.0 --allow-same-version` for the first publish) to update versions and create `vX.Y.Z`.
3. Push the tag: `git push origin --tags` (or `git push origin vX.Y.Z`). The `Release` workflow builds, tests, and runs `npm publish --access public` using `NPM_TOKEN`.

Manual fallback:
1. Make sure you're authenticated locally: `npm whoami` / `npm login`.
2. `npm version patch|minor|major` (or keep `0.0.0` and tag manually with `git tag v0.0.0`).
3. `npm test`.
4. Optional sanity check: `npm pack --dry-run` (only `dist` ships).
5. `npm publish --access public`.
6. `git push && git push --tags` if you want tags aligned.
