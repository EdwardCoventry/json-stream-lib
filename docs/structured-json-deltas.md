# Structured JSON deltas (Responses API)

Use this path when SSE payloads already carry structured JSON fragments such as `response.output_json.delta`, `response.output_text.delta`, `response.content_part.added`, `response.output_item.added`, and `[DONE]`. The helpers assemble text, JSON strings, and tool calls while applying retries, watchdogs, and optional shadow replay.

## High-level: runJsonResponsesStream
Wires env/model overrides, payload shaping, and the streaming pipeline together.
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
    onDone: (final) => console.log('final assembled assistant message', final),
  },
  {
    text: { format: { type: 'json_schema', value: {/* schema */} } },
    tools: [],
    toolChoice: 'auto',
    clientSessionId: 'ui-session-123',
    qr,
    shadowMode: false,
    policy: NetworkPolicy.fromCurrent(),
    dbg: new JsonDeltaDebugLogger('ui-session-123', qr),
  },
);

qr.onEvent((ev) => {
  if (ev.type === 'json-partial') {
    // response.output_json.delta payloads arrive here as parsed objects
    console.log('partial structured payload', ev.data.value);
  }
  if (ev.type === 'completed') {
    console.log('stream finished');
  }
});
```
- `runJsonResponsesStream` internally calls `runJsonDeltaPipeline`, sets defaults from `getStreamingEnv`, and can replay in shadow mode via `runWithShadow`.
- Attach `QueryResponse` to observe lifecycle (`headers`, `first-byte`, `json-partial`, `json-completed`) and to merge `response.output_json.delta` slices into typed objects as they arrive.

## Lower-level: runJsonDeltaPipeline
Use this when you already have a URL/payload and want to hook into the pipeline directly.
```ts
import {
  runJsonDeltaPipeline,
  JsonDeltaAssembler,
  JsonDeltaThrottler,
  JsonDeltaDebugLogger,
  NetworkPolicy,
  routeJsonDeltaEvent,
} from '@edwardcoventry/json-stream-lib/streaming/json-delta';

const dbg = new JsonDeltaDebugLogger('ui-session-123');

await runJsonDeltaPipeline({
  url: 'https://api.example.com/api/responses',
  payload: { model: 'gpt-4.1', messages, response_mode: 'stream' },
  uiSid: 'ui-session-123',
  isJsonStructured: true,
  policy: NetworkPolicy.fromCurrent(),
  dbg,
  maxFrames: 512,
  maxBytes: 2_000_000,
  onDeltaText: (delta, fullText) => console.log('delta', delta, 'full', fullText),
  onDone: (final) => console.log('final assistant message', final),
});
```
What happens inside:
- `parseSseFrame` extracts SSE frames from the byte stream.
- `routeJsonDeltaEvent` recognizes the Responses API event types and calls your handlers:
  - `handleTextDelta` for `response.output_text.delta` / `response.delta`.
  - `handleJsonDelta` for `response.output_json.delta` and JSON-bearing content parts.
  - `markCompleted` when completion events arrive (`response.output_item.done`, `response.completed`, `[DONE]`).
- `JsonDeltaThrottler` coalesces rapid deltas to reduce UI churn.
- `JsonDeltaAssembler` merges text, JSON strings, and tool calls into the final assistant message while keeping a debug `fullText` view.

## Debug, policy, and core pieces
- `JsonDeltaDebugLogger` emits DOM events for headers, SSE frames, deltas, perf samples, retries, and aborts.
- `NetworkPolicy` configures retries, backoff, and TTFB/stall watchdogs (via `createWatchdogs`).
- Shared primitives are available under `streaming/core` if you need them independently.
