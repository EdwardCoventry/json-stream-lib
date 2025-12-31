import {RawJsonCloser, RawJsonStreamParser, type RawJsonStatus, type RawJsonParseResult} from '../../jsonStream.js';
import {runRawJsonStream, createRawJsonEmitter, wrapSseTextStreamWithParser, type RawJsonStreamOptions, type RawJsonStreamEvent} from './runRawJsonStream.js';
import {
  createJsonPathStreamEmitter,
  type JsonPathStreamEmitter,
  type JsonPathStreamEmitterOptions,
  type JsonPathStreamEvent,
} from './path-emitter.js';

export type {RawJsonStatus, RawJsonParseResult} from '../../jsonStream.js';
export {RawJsonCloser, RawJsonStreamParser};
export {runRawJsonStream, createRawJsonEmitter, wrapSseTextStreamWithParser};
export type {RawJsonStreamOptions, RawJsonStreamEvent};
export {createJsonPathStreamEmitter};
export type {JsonPathStreamEmitter, JsonPathStreamEmitterOptions, JsonPathStreamEvent};

/**
 * Minimal helper to accumulate text deltas and notify a listener with the full string.
 */
export function createRawTextAccumulator(onUpdate: (fullText: string) => void) {
  let acc = '';
  return {
    push(delta: string) {
      acc += String(delta ?? '');
      onUpdate(acc);
    },
    reset() {
      acc = '';
      onUpdate(acc);
    },
    value() { return acc; },
  };
}
