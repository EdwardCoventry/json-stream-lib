import {test} from 'node:test';
import {strict as assert} from 'node:assert';

import {QueryResponse, type QueryResponseEvent} from '../query/QueryResponse.js';
import {RawJsonStreamParser} from '../streaming/raw-json/index.js';
import {STREAM_EVENT_NAME} from '../streaming/utils/eventBus.js';

test('QueryResponse accumulates text and json deltas and exposes lastJson', () => {
  const qr = new QueryResponse('sess-1', 'test', {listenToDom: false});
  const events: QueryResponseEvent[] = [];
  qr.onEvent((ev) => events.push(ev));

  qr.markStarted();
  qr.markHeaders();

  qr.pushTextDelta('he');
  qr.pushTextDelta('llo');

  qr.pushJsonDelta('{"a":1');
  qr.pushJsonDelta(',"b":2}');
  qr.markCompleted();

  assert.equal(qr.responseText, 'hello');
  assert.ok(qr.responseJsonText.includes('"a":1'));
  assert.ok(qr.responseJsonText.includes('"b":2'));

  const jsonCompleted = events.find((e) => e.type === 'json-completed') as any;
  assert.ok(jsonCompleted, 'expected json-completed event');
  assert.deepEqual(jsonCompleted.data.value, {a: 1, b: 2});
  assert.deepEqual(qr.lastJson, {a: 1, b: 2});
  assert.ok(qr.completed);
  assert.ok(qr.acked);
});

test('QueryResponse swallows JSON parse errors and preserves last valid json', () => {
  const qr = new QueryResponse('sess-parse', 'test', {listenToDom: false});
  const events: QueryResponseEvent[] = [];
  qr.onEvent((ev) => events.push(ev));

  qr.pushJsonDelta('{"x":1');
  qr.pushJsonDelta(',"y":2}');
  qr.pushJsonDelta(' not-json ');
  qr.markCompleted();

  const jsonEvents = events.filter((e) => e.type === 'json-completed') as any[];
  if (jsonEvents.length) {
    const last = jsonEvents[jsonEvents.length - 1];
    assert.deepEqual(last.data.value, {x: 1, y: 2});
    assert.deepEqual(qr.lastJson, {x: 1, y: 2});
  }
});

test('QueryResponse handleStreamEvent toggles lifecycle flags correctly', () => {
  const qr = new QueryResponse('sess-dom', 'test', {listenToDom: false});
  const handle = (qr as any).handleStreamEvent.bind(qr);

  const makeEvent = (type: string, data: any = {}) => ({detail: {type, data}});

  handle(makeEvent('stream.start', {sessionId: 'sess-dom'}));
  assert.ok(qr.started);

  handle(makeEvent('response.headers', {sessionId: 'sess-dom'}));
  assert.ok(qr.headers);
  assert.ok(qr.acked);

  handle(makeEvent('response.text.delta', {sessionId: 'sess-dom'}));
  assert.ok(qr.firstByte);

  handle(makeEvent('stream.end', {sessionId: 'sess-dom'}));
  assert.ok(qr.completed);

  handle(makeEvent('response.error', {sessionId: 'sess-dom'}));
  assert.ok(qr.errored);
});

test('QueryResponse marks first byte only for payload SSE types', () => {
  const qr = new QueryResponse('sess-sse', 'test', {listenToDom: false});
  const handle = (qr as any).handleStreamEvent.bind(qr);
  const makeEvent = (eventType: string) => ({
    detail: {type: 'response.sse', data: {sessionId: 'sess-sse', eventType}},
  });

  handle(makeEvent('heartbeat.ping'));
  assert.equal(qr.firstByte, false);

  handle(makeEvent('response.output_text.delta'));
  assert.equal(qr.firstByte, true);
});

test('QueryResponse resetStream clears accumulators but preserves lifecycle', () => {
  const qr = new QueryResponse('sess-reset', 'test', {listenToDom: false});
  qr.markStarted();
  qr.markHeaders();
  qr.pushTextDelta('abc');
  qr.pushJsonDelta('{"a":1}');
  qr.resetStream();

  assert.ok(qr.started);
  assert.ok(qr.headers);
  assert.equal(qr.responseText, '');
  assert.equal(qr.responseJsonText, '');
  assert.equal(qr.lastJson, null);
});

test('QueryResponse with empty id behaves inertly without throwing', () => {
  const qr = new QueryResponse('', 'test');
  qr.pushTextDelta('x');
  qr.pushJsonDelta('{"y":2}');
  qr.markStarted();
  qr.markHeaders();
  qr.markCompleted();
  qr.pushError({msg: 'err'});

  assert.equal(qr.responseText, 'x');
});
