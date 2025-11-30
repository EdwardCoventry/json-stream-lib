# Example: Raw text stream for a status monitor

This example shows how to consume a text-only SSE/WebSocket feed that eventually forms JSON. It uses the **raw JSON stream** helpers to incrementally parse the text and emit domain events.

## Scenario
- The server emits plain text deltas (e.g., `{ "service": "db", "status": "ok" }` in pieces) plus a `[DONE]` sentinel.
- The client wants to surface partial status snapshots while the object is still being streamed.
- No `QueryResponse` or structured `response.output_json.delta` events are available.

## Wiring an async iterable with `runRawJsonStream`
```ts
import { runRawJsonStream } from '@edwardcoventry/json-stream-lib/streaming/raw-json';

// Imagine this comes from an SSE or WebSocket text feed.
async function* statusChunks() {
  yield '{"service":"db",';
  yield '"status":"ok",';
  yield '"uptime":12345';
  yield '}';
}

await runRawJsonStream({
  source: statusChunks(),
  onPartial: (value, meta) => {
    console.log('partial status', value, meta);
  },
  onComplete: (value) => {
    console.log('final status', value);
  },
  onEvent: (ev) => {
    if (ev.type === 'json-start') console.log('saw JSON starter');
  },
});
```

## Push-based variant
If you receive deltas via callbacks, use `createRawJsonEmitter`:
```ts
import { createRawJsonEmitter } from '@edwardcoventry/json-stream-lib/streaming/raw-json';

const emitter = createRawJsonEmitter((ev) => {
  if (ev.type === 'partial') console.log('partial', ev.data.value);
  if (ev.type === 'complete') console.log('complete', ev.data.value);
});

function onIncomingDelta(delta) {
  emitter.push(delta, false);
}

function onStreamEnd() {
  emitter.finalize();
}
```

## Notes
- The parser auto-completes `true`/`false`/`null` prefixes and temporarily closes braces/brackets to emit best-effort snapshots; `forcedClosures` tells you how many closures were auto-inserted.
- Use this path only when the upstream cannot emit structured JSON deltas; prefer the JSON-delta pipeline (`runJsonResponsesStream`) when you control the server.
