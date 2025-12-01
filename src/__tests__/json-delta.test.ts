import {test} from 'node:test';
import {strict as assert} from 'node:assert';

import {
  JsonDeltaAssembler,
  JsonDeltaThrottler,
  routeJsonDeltaEvent,
} from '../streaming/json-delta/index.js';

test('JsonDeltaAssembler merges text, JSON, and tool calls', () => {
  const assembler = new JsonDeltaAssembler();

  assembler.addText('Hello ');
  assembler.addJson('{"foo":');
  assembler.addJson('"bar"}');
  assembler.mergeToolCalls([{index: 0, id: 'tc-0', function: {name: 'calc', arguments: '{"x":1}'}}]);
  assembler.mergeGeneric({
    role: 'assistant',
    content: 'world',
    tool_calls: [{index: 1, id: 'tc-1', function: {name: 'next', arguments: '{"y":2}'}}],
  });

  const final = assembler.final();
  assert.equal(final.role, 'assistant');
  assert.equal(final.content, 'Hello world');
  assert.equal(assembler.fullText(), 'Hello {"foo":"bar"}world');
  assert.equal(final.tool_calls?.[0]?.id, 'tc-0');
  assert.equal(final.tool_calls?.[0]?.function?.name, 'calc');
  assert.equal(final.tool_calls?.[1]?.id, 'tc-1');
});

test('JsonDeltaThrottler coalesces fragments before flushing', async () => {
  const flushed: string[] = [];
  const throttler = new JsonDeltaThrottler((chunk) => flushed.push(chunk));

  throttler.enqueue('a');
  throttler.enqueue('b');
  await new Promise((res) => setTimeout(res, 0));
  assert.deepEqual(flushed, ['ab']);

  throttler.enqueue('c');
  await new Promise((res) => setTimeout(res, 0));
  assert.deepEqual(flushed, ['ab', 'c']);
});

test('routeJsonDeltaEvent routes text, JSON, content, and completion events', () => {
  const seen = {text: [] as string[], json: [] as string[], merged: [] as any[], completed: 0};

  const handlers = {
    handleTextDelta: (d: string) => seen.text.push(d),
    handleJsonDelta: (d: string) => seen.json.push(d),
    mergeDelta: (d: any) => seen.merged.push(d),
    markCompleted: () => { seen.completed += 1; },
  };

  routeJsonDeltaEvent('response.output_text.delta', JSON.stringify({delta: 'txt-1'}), false, handlers);
  routeJsonDeltaEvent('response.output_json.delta', JSON.stringify({delta: '{"a":1}'}), true, handlers);
  routeJsonDeltaEvent('response.content_part.added', JSON.stringify({output_json: {score: 9}}), true, handlers);
  routeJsonDeltaEvent('response.output_item.done', JSON.stringify({item: {content: [{type: 'output_json', json: {done: true}}]}}), true, handlers);
  routeJsonDeltaEvent('chat.completion.chunk', JSON.stringify({choices: [{delta: {content: 'choice-delta'}}]}), false, handlers);
  routeJsonDeltaEvent('response.completed', JSON.stringify({content: [{text: 'fin'}]}), false, handlers);

  assert.deepEqual(seen.text, ['txt-1', 'fin']);
  assert.deepEqual(seen.json, ['{"a":1}', '{"score":9}', '{"done":true}']);
  assert.equal(seen.completed, 2); // output_item.done + response.completed
  assert.ok(seen.merged[0]?.content === 'choice-delta');
});

test('routeJsonDeltaEvent extracts output_json/output_text payloads and completion events', () => {
  const seen = {json: [] as string[], completed: 0};
  const handlers = {
    handleTextDelta: (d: string) => seen.json.push(d),
    handleJsonDelta: (d: string) => seen.json.push(d),
    mergeDelta: () => {},
    markCompleted: () => { seen.completed += 1; },
  };

  routeJsonDeltaEvent('response.output_json.delta', JSON.stringify({output_json: {score: 7}}), true, handlers);
  routeJsonDeltaEvent('response.output_text.delta', JSON.stringify({output_text: [{content: [{type: 'output_text', text: 'hi'}]}]}), true, handlers);
  routeJsonDeltaEvent('response.output_json.done', JSON.stringify({output_parsed: {final: true}}), true, handlers);

  assert.deepEqual(seen.json, ['{"score":7}', 'hi', '{"final":true}']);
  assert.equal(seen.completed, 1);
});
