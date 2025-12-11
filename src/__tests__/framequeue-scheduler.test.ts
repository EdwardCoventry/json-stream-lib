import {test} from 'node:test';
import {strict as assert} from 'node:assert';

import {FrameQueue} from '../streaming/frames/FrameQueue.js';
import {SliceScheduler} from '../streaming/frames/SliceScheduler.js';

test('FrameQueue enforces maxFrames and maxBytes by dropping oldest frames', () => {
  const fq = new FrameQueue(3, 10);

  fq.push('1234');
  fq.push('56');
  fq.push('7890');
  fq.push('zz');

  assert.ok(fq.length() <= 3, 'queue length should not exceed maxFrames');
  const internalBytes = (fq as any).totalBytes;
  assert.ok(internalBytes <= 10, 'totalBytes should not exceed maxBytes');

  const first = fq.shift();
  assert.notEqual(first, '1234', 'oldest frame should have been dropped');
});

test('FrameQueue drain resolves only after reader finished and queue empty', async () => {
  const fq = new FrameQueue(10, 100);
  fq.push('frame-1');
  fq.push('frame-2');

  const drained: {resolved: boolean} = {resolved: false};
  fq.drain().then(() => { drained.resolved = true; });

  fq.markReaderFinished();
  await new Promise((res) => setTimeout(res, 10));
  assert.equal(drained.resolved, false);

  while (fq.length() > 0) {
    fq.shift();
    fq.notifyFrameConsumed();
  }

  await new Promise((res) => setTimeout(res, 10));
  assert.equal(drained.resolved, true);
});

test('FrameQueue abort clears queue and resolves drain', async () => {
  const fq = new FrameQueue(10, 100);
  fq.push('frame-1');
  fq.push('frame-2');

  const drained: {resolved: boolean} = {resolved: false};
  fq.drain().then(() => { drained.resolved = true; });

  fq.abort();
  await new Promise((res) => setTimeout(res, 10));
  assert.equal(drained.resolved, true);
  assert.equal(fq.length(), 0);
});

test('SliceScheduler drains frames and honours maxFramesPerSlice/maxSliceMs', async () => {
  const abortCtl = new AbortController();
  const fq = new FrameQueue(100, 10_000);
  const processed: string[] = [];
  const perfSlices: Array<{frames: number; ms: number; depth: number}> = [];

  const scheduler = new SliceScheduler(fq, {
    maxFramesPerSlice: 5,
    maxSliceMs: 50,
    processFrame: (frame) => processed.push(frame),
    onPerfSlice: (frames, ms, depth) => perfSlices.push({frames, ms, depth}),
    abortSignal: abortCtl.signal,
  });

  for (let i = 0; i < 12; i += 1) {
    fq.push(`frame-${i}`);
  }

  scheduler.ensureScheduled();
  await new Promise((res) => setTimeout(res, 50));
  await new Promise((res) => setTimeout(res, 50));

  assert.equal(processed.length, 12);
  assert.ok(perfSlices.length >= 1);
});

test('SliceScheduler stops on abort and clears remaining frames', async () => {
  const abortCtl = new AbortController();
  const fq = new FrameQueue(100, 10_000);
  const processed: string[] = [];
  let abortedCalled = false;

  const scheduler = new SliceScheduler(fq, {
    maxFramesPerSlice: 100,
    maxSliceMs: 1000,
    processFrame: (frame) => processed.push(frame),
    onPerfSlice: () => {},
    abortSignal: abortCtl.signal,
    onAbort: () => { abortedCalled = true; },
  });

  for (let i = 0; i < 5; i += 1) {
    fq.push(`f-${i}`);
  }
  scheduler.ensureScheduled();

  abortCtl.abort();
  await new Promise((res) => setTimeout(res, 20));

  assert.ok(abortedCalled);
  assert.equal(fq.length(), 0);
});
