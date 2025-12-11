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
  assert.equal(firstForced, 0);
  assert.equal(firstChange, false);

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

test('RawJsonStreamParser does not emit while inside an unfinished key or string', () => {
  const parser = new RawJsonStreamParser({emitEmptyContainers: false});
  const seen: Array<{status: string; data: any}> = [];
  const chunks = ['{"it', 'ems":1}'];
  for (let i = 0; i < chunks.length; i += 1) {
    const res = parser.parse(chunks[i], i === chunks.length - 1);
    if (res) seen.push({status: res.status, data: res.data});
  }

  assert.equal(seen.length, 2);
  assert.equal(seen[0].status, 'PARTIAL');
  assert.equal(seen[0].data, null); // start event only
  assert.equal(seen[1].status, 'COMPLETED');
  assert.deepEqual(seen[1].data, {items: 1});

  const stringParser = new RawJsonStreamParser({emitEmptyContainers: false});
  const stringSeen: Array<{status: string; data: any}> = [];
  const stringChunks = ['["he', 'llo"]'];
  for (let i = 0; i < stringChunks.length; i += 1) {
    const res = stringParser.parse(stringChunks[i], i === stringChunks.length - 1);
    if (res) stringSeen.push({status: res.status, data: res.data});
  }

  assert.equal(stringSeen.length, 2);
  assert.equal(stringSeen[0].data, null);
  assert.equal(stringSeen[0].status, 'PARTIAL');
  assert.equal(stringSeen[1].status, 'COMPLETED');
  assert.deepEqual(stringSeen[1].data, ['hello']);
});

test('RawJsonStreamParser does not emit mid-number and emits nested empty containers early', () => {
  const numParser = new RawJsonStreamParser();
  const numSeen: Array<{status: string; data: any}> = [];
  const numChunks = ['{"n": 12', '3', '}'];
  for (let i = 0; i < numChunks.length; i += 1) {
    const res = numParser.parse(numChunks[i], i === numChunks.length - 1);
    if (res) numSeen.push({status: res.status, data: res.data});
  }

  assert.equal(numSeen.length, 2);
  assert.equal(numSeen[0].status, 'PARTIAL');
  assert.equal(numSeen[0].data, null); // start event
  assert.ok(numSeen[1].status === 'PARTIAL' || numSeen[1].status === 'COMPLETED');
  assert.deepEqual(numSeen[1].data, {n: 123});

  const nestedParser = new RawJsonStreamParser({emitEmptyContainers: true});
  const nestedSeen: Array<{status: string; data: any; forcedClosures: number}> = [];
  const nestedChunks = ['{"items":[{"child":[', ']}}'];
  for (let i = 0; i < nestedChunks.length; i += 1) {
    const res = nestedParser.parse(nestedChunks[i], i === nestedChunks.length - 1);
    if (res) nestedSeen.push({status: res.status, data: res.data, forcedClosures: res.forcedClosures});
  }

  assert.ok(nestedSeen.length >= 1);
  assert.equal(nestedSeen[0].status, 'PARTIAL');
  assert.deepEqual(nestedSeen[0].data, {items: [{child: []}]});
  assert.ok((nestedSeen[0].forcedClosures ?? 0) >= 1);
  const last = nestedSeen[nestedSeen.length - 1];
  assert.deepEqual(last.data, {items: [{child: []}]});
});
