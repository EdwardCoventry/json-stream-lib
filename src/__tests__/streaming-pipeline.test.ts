import {test} from 'node:test';
import {strict as assert} from 'node:assert';

import {
  runJsonResponsesStream,
  NetworkPolicy,
} from '../streaming/json-delta/index.js';

test('runJsonResponsesStream streams SSE text deltas end-to-end', async () => {
  const originalFetch = globalThis.fetch;
  const encoder = new TextEncoder();

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(
        'event: response.output_text.delta\n' +
        'data: {"delta":"he"}\n\n'
      ));
      controller.enqueue(encoder.encode(
        'event: response.output_text.delta\n' +
        'data: {"delta":"llo"}\n\n'
      ));
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });

  const responseHeaders = new Headers({
    'Content-Type': 'text/event-stream',
    'x-request-id': 'test-req',
    'x-model-used': 'test-model',
  });
  const fakeResponse = new Response(body, {status: 200, headers: responseHeaders});

  (globalThis as any).fetch = async () => fakeResponse;

  const deltas: string[] = [];
  try {
    const final = await runJsonResponsesStream(
      [{role: 'user', content: 'hi'}],
      'gpt-4o-mini',
      {
        onDeltaText: (_delta, full) => {
          deltas.push(full);
        },
        onDone: () => {},
      },
      {
        apiBase: '',
        shadowMode: false,
        policy: new NetworkPolicy({
          maxAttempts: 1,
          ttfbTimeoutMs: 5000,
          midStreamStallMs: 0,
          backoffProfile: 'balanced',
          retryOnServerErrors: false,
          retryOnlyBeforeBytes: true,
        }),
      },
    );

    assert.ok(deltas.includes('hello')); // assembled from he + llo
    if (final.message) {
      assert.equal(final.message.content, 'hello');
    }
  } finally {
    (globalThis as any).fetch = originalFetch;
  }
});

test('runJsonResponsesStream fails gracefully on non-OK response', async () => {
  const originalFetch = globalThis.fetch;

  const errorResp = new Response('boom', {status: 502});
  (globalThis as any).fetch = async () => errorResp;

  let caught: any = null;
  try {
    await runJsonResponsesStream(
      [{role: 'user', content: 'hi'}],
      'gpt-4o-mini',
      {},
      {
        apiBase: '',
        shadowMode: false,
        policy: new NetworkPolicy({
          maxAttempts: 1,
          ttfbTimeoutMs: 5000,
          midStreamStallMs: 0,
          backoffProfile: 'balanced',
          retryOnServerErrors: false,
          retryOnlyBeforeBytes: true,
        }),
      },
    );
  } catch (e) {
    caught = e;
  } finally {
    (globalThis as any).fetch = originalFetch;
  }

  assert.ok(caught, 'expected error to be thrown');
  assert.equal(caught.status, 502);
  assert.equal(caught.code, 'HTTP_502');
});
