import {test} from 'node:test';
import {strict as assert} from 'node:assert';

import {parseSseFrame} from '../streaming/parse/SseParser.js';
import {routeJsonDeltaEvent} from '../streaming/parse/JsonEventRouter.js';

test('parseSseFrame parses multiple events, notes, and data lines', () => {
  const raw = [
    ':heartbeat',
    'event: response.output_text.delta',
    'data: {"delta":"he"}',
    '',
    'event: response.output_text.delta',
    'data: {"delta":"llo"}',
    '',
    'data: [DONE]',
    '',
  ].join('\n');

  const events = parseSseFrame(raw);
  assert.equal(events.length, 3);

  const [ev1, ev2, ev3] = events;
  // First event is just the note bucket
  assert.equal(ev1.eventType, '');
  assert.deepEqual(ev1.notes, ['heartbeat']);

  assert.equal(ev2.eventType, 'response.output_text.delta');
  assert.deepEqual(ev2.data, ['{"delta":"he"}']);

  assert.equal(ev3.eventType, 'response.output_text.delta');
  assert.deepEqual(ev3.data, ['{"delta":"llo"}', '[DONE]']);
});

test('routeJsonDeltaEvent falls back to mergeDelta for unknown event types', () => {
  const seen = {text: [] as string[], json: [] as string[], merged: [] as any[]};
  const handlers = {
    handleTextDelta: (d: string) => seen.text.push(d),
    handleJsonDelta: (d: string) => seen.json.push(d),
    mergeDelta: (d: any) => seen.merged.push(d),
    markCompleted: () => {},
  };

  const payload = {choices: [{delta: {content: 'hi-there'}}]};
  routeJsonDeltaEvent('chat.completion.chunk', JSON.stringify(payload), false, handlers);

  assert.deepEqual(seen.text, []);
  assert.equal(seen.json.length, 0);
  assert.equal(seen.merged.length, 1);
  assert.equal(seen.merged[0].content, 'hi-there');
});
