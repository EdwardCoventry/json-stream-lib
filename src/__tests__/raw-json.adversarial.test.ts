import {test} from 'node:test';
import {strict as assert} from 'node:assert';

import {
  RawJsonCloser,
  RawJsonStreamParser,
  runRawJsonStream,
  type RawJsonStreamEvent,
} from '../streaming/raw-json/index.js';

/**
 * Try to break mid-number handling by inserting whitespace between chunks.
 */
test('RawJsonStreamParser handles number split with whitespace between chunks', () => {
  const parser = new RawJsonStreamParser();
  const chunks = ['{"n": 12', '3}'];
  const seen: Array<{status: string; data: any}> = [];

  for (let i = 0; i < chunks.length; i += 1) {
    const res = parser.parse(chunks[i], i === chunks.length - 1);
    if (res) seen.push({status: res.status, data: res.data});
  }

  const last = seen[seen.length - 1];
  assert.ok(last, 'expected at least one parse result');
  assert.ok(last.status === 'PARTIAL' || last.status === 'COMPLETED');
  assert.deepEqual(last.data, {n: 123});
});

/**
 * Booleans/null as partially streamed literals inside an array and object.
 */
test('RawJsonStreamParser completes true/false/null across chunks in arrays and objects', () => {
  const parser = new RawJsonStreamParser();
  const chunks = [
    '{"vals":[tr',
    'ue, fa',
    'lse, nu',
    'll]}',
  ];
  const seen: any[] = [];
  for (let i = 0; i < chunks.length; i += 1) {
    const res = parser.parse(chunks[i], i === chunks.length - 1);
    if (res) seen.push(res);
  }

  const final = seen[seen.length - 1];
  assert.ok(final, 'expected a final parse result');
  assert.equal(final.status, 'COMPLETED');
  assert.deepEqual(final.data, {vals: [true, false, null]});
});

/**
 * Ensure trailing words are not coerced into literals.
 */
test('RawJsonCloser does not treat non-literal trailing words as booleans/null', () => {
  const closer = new RawJsonCloser();
  closer.append('{"word":"truthy"}');
  const [, parsed] = closer.parse(true);
  assert.deepEqual(parsed, {word: 'truthy'});
});

/**
 * Escaped quotes and backslashes across chunks.
 */
test('RawJsonStreamParser handles escaped quotes and backslashes across chunks', () => {
  const parser = new RawJsonStreamParser({emitEmptyContainers: false});

  const chunks = [
    '{"s":"a\\\\',
    '\\"b\\\\c"',
    '}',
  ];
  const seen: any[] = [];
  for (let i = 0; i < chunks.length; i += 1) {
    const res = parser.parse(chunks[i], i === chunks.length - 1);
    if (res) seen.push(res);
  }

  const final = seen[seen.length - 1];
  assert.ok(final, 'expected a final parse result');
  assert.equal(final.status, 'COMPLETED');
  assert.deepEqual(final.data, {s: 'a\\"b\\c'});
});

/**
 * Emoji / surrogate pairs split across chunks.
 */
test('RawJsonStreamParser handles emoji split across chunks', () => {
  const emoji = '\uD83D\uDE00';
  const s1 = emoji.slice(0, 1);
  const s2 = emoji.slice(1);

  const parser = new RawJsonStreamParser({emitEmptyContainers: false});
  const chunks = [`{"emoji":"${s1}`, `${s2}"}`, ''];
  const seen: any[] = [];

  for (let i = 0; i < chunks.length; i += 1) {
    const res = parser.parse(chunks[i], i === chunks.length - 1);
    if (res) seen.push(res);
  }

  const final = seen[seen.length - 1];
  assert.ok(final, 'expected final parse result');
  assert.equal(final.status, 'COMPLETED');
  assert.deepEqual(final.data, {emoji});
});

/**
 * Multiple top-level entities plus trailing junk should not throw.
 */
test('runRawJsonStream handles multiple entities and trailing junk without throwing', async () => {
  const events: RawJsonStreamEvent[] = [];

  async function* source() {
    yield '{"a":1}   ';
    yield '\n{"b":[2,3]}';
    yield ' not-json-but-should-be-ignored';
  }

  await runRawJsonStream({
    source: source(),
    onEvent: (ev) => events.push(ev),
  });

  const completes = events.filter((e): e is Extract<RawJsonStreamEvent, {type: 'complete'}> => e.type === 'complete');
  assert.ok(completes.length >= 2, 'expected both entities to complete');
  assert.deepEqual(completes[0].data.value, {a: 1});
  assert.deepEqual(completes[1].data.value, {b: [2, 3]});
});

/**
 * Deep nesting stress.
 */
test('RawJsonCloser handles very deep nesting without blowing up', () => {
  const depth = 500;
  const closer = new RawJsonCloser();
  let s = '';
  for (let i = 0; i < depth; i += 1) s += '{"x":';
  s += '0';
  for (let i = 0; i < depth; i += 1) s += '}';
  closer.append(s);
  const [, parsed] = closer.parse(true);
  let obj: any = parsed;
  for (let i = 0; i < depth; i += 1) {
    assert.ok(obj && typeof obj === 'object');
    obj = obj.x;
  }
  assert.equal(obj, 0);
});
