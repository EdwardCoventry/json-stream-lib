# Raw text to JSON (manual parsing)

Use this path when you only receive text chunks (e.g., `response.output_text.delta`) but still want incremental JSON objects as soon as they become parseable.

## Direct parser: RawJsonStreamParser
`RawJsonStreamParser` accepts arbitrary text fragments and emits partial/complete JSON snapshots. It tolerates open strings/braces and reports how many closures were auto-inserted.
- Literal prefixes such as `tr`, `fal`, or `nu` are completed to `true`/`false`/`null` when they appear at value boundaries.
- If an object/array was only parseable via a temporary auto-close, the parser will still emit a change once the real closing token arrives.
```ts
import { RawJsonStreamParser } from '@edwardcoventry/json-stream-lib/streaming/raw-json';

const parser = new RawJsonStreamParser();
const chunks = ['{"a":1', ',"b":', '2}'];

for (const [i, chunk] of chunks.entries()) {
  const res = parser.parse(chunk, i === chunks.length - 1);
  if (!res) continue;

  if (res.event === 'JSON_STARTED') console.log('started reading JSON');
  if (res.status === 'PARTIAL' && res.data) console.log('partial', res.data);
  if (res.status === 'COMPLETED') console.log('complete', res.data);
  console.log('forced closures', res.forcedClosures);
}
```

## Helper: runRawJsonStream
Wrap an async iterable of text deltas (from SSE or websockets) and receive domain-friendly events.
```ts
import { runRawJsonStream } from '@edwardcoventry/json-stream-lib/streaming/raw-json';

await runRawJsonStream({
  source: textChunksAsyncIterable,
  onPartial: (value, meta) => console.log('partial JSON', value, meta),
  onComplete: (value) => console.log('completed JSON', value),
  onEvent: (ev) => console.log('stream event', ev.type),
});
```
Events:
- `start` → stream wiring began.
- `chunk` → raw text chunk received.
- `json-start` → first valid JSON starter seen.
- `partial` → parseable snapshot (with `forcedClosures` when braces/brackets were auto-inserted).
- `ready` / `complete` → full JSON entity parsed.
- `error` → exceptions surfaced from your `source` or callbacks.

## Other helpers
- `createRawJsonEmitter` gives you a push-based wrapper if you don’t have an async iterator.
- `createRawTextAccumulator` lets you coalesce deltas into a full string and emit it as it changes.
