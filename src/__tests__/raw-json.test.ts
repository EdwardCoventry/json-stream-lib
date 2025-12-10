import {test} from 'node:test';
import {strict as assert} from 'node:assert';

import {RawJsonCloser, RawJsonStreamParser, runRawJsonStream, type RawJsonStreamEvent} from '../streaming/raw-json/index.js';

test('RawJsonStreamParser yields start, partial, and completed snapshots', () => {
  const parser = new RawJsonStreamParser();

  const start = parser.parse('{"a":', false);
  assert.ok(start);
  assert.equal(start?.event, 'JSON_STARTED');
  assert.equal(start?.status, 'PARTIAL');
  assert.equal(start?.data, null);

  const final = parser.parse('"b"}', true);
  assert.ok(final);
  assert.equal(final?.status, 'COMPLETED');
  assert.deepEqual(final?.data, {a: 'b'});
  assert.equal(final?.forcedClosures, 0);
});

test('runRawJsonStream emits events for async iterables of text', async () => {
  const events: RawJsonStreamEvent[] = [];

  async function* chunks() {
    yield '{"x":1';
    yield ',"y":2';
    yield '}';
  }

  await runRawJsonStream({
    source: chunks(),
    onEvent: (ev) => events.push(ev),
  });

  const jsonStart = events.find((e) => e.type === 'json-start');
  const complete = events.find((e): e is Extract<RawJsonStreamEvent, {type: 'complete'}> => e.type === 'complete');

  assert.ok(jsonStart, 'expected a json-start event');
  if (!complete) throw new Error('expected a complete event');
  assert.deepEqual(complete.data.value, {x: 1, y: 2});
  assert.equal(complete.data.forcedClosures, 0);
});

test('RawJsonCloser marks change when a real close follows a forced close', () => {
  const closer = new RawJsonCloser();
  closer.append('{"x":1 ');

  const [firstChange, firstParsed, , firstForced] = closer.parse(false);
  assert.equal(firstForced, 1);
  assert.equal(firstChange, true);
  assert.deepEqual(firstParsed, {x: 1});

  closer.append('}');
  const [finalChange, finalParsed, , finalForced] = closer.parse(true);
  assert.equal(finalForced, 0);
  assert.equal(finalChange, true);
  assert.deepEqual(finalParsed, {x: 1});
});

test('RawJsonCloser completes literal prefixes at value boundaries', () => {
  const closer = new RawJsonCloser();
  closer.append('{"ok": tr');
  const [, parsed] = closer.parse(false);
  assert.deepEqual(parsed, {ok: true});
});

test('RawJsonStreamParser emits empty containers when enabled', () => {
  const parser = new RawJsonStreamParser({emitEmptyContainers: true});

  const emptyArray = parser.parse('{"items": [', false);
  assert.ok(emptyArray);
  assert.equal(emptyArray?.status, 'PARTIAL');
  assert.deepEqual(emptyArray?.data, {items: []});
  assert.ok((emptyArray?.forcedClosures ?? 0) >= 1);

  const objParser = new RawJsonStreamParser({emitEmptyContainers: true});
  const emptyObject = objParser.parse('{"obj": {', false);
  assert.ok(emptyObject);
  assert.equal(emptyObject?.status, 'PARTIAL');
  assert.deepEqual(emptyObject?.data, {obj: {}});
  assert.ok((emptyObject?.forcedClosures ?? 0) >= 1);
});

test('RawJsonStreamParser discards dangling tokens but still emits empty containers', () => {
  const parser = new RawJsonStreamParser({emitEmptyContainers: true});

  const partialStringValue = parser.parse('{"items": ["te', false);
  assert.ok(partialStringValue);
  assert.equal(partialStringValue?.status, 'PARTIAL');
  assert.deepEqual(partialStringValue?.data, {items: []});

  const nestedParser = new RawJsonStreamParser({emitEmptyContainers: true});
  const partialNestedObject = nestedParser.parse('{"items": [{"th', false);
  assert.ok(partialNestedObject);
  assert.equal(partialNestedObject?.status, 'PARTIAL');
  assert.deepEqual(partialNestedObject?.data, {items: [{}]});
});
