# Example: How a quiz app uses json-stream-lib

This document captures the exact wiring a production quiz app uses to stream **structured JSON deltas** over SSE. The app never parses text; it relies on `response.output_json.delta` plus `QueryResponse` for typed, incremental state.

## Core wiring
- Thin wrapper: `responsesStream` re-exports `runJsonResponsesStream` and injects `getCurrentModelSettings` (see `packages/shared/src/lib/api.ts` in the app).
- State container: the app subclasses `QueryResponse` (`QuestionQueryResponse`, `AnswerQueryResponse`, `ResultQueryResponse`) to tag sessions by logical kind while delegating all behavior to the base class (see `packages/shared/src/lib/query/QueryResponse.ts`).
- Debug bus: `emitJsonDeltaDebugEvent` is re-exported so every stream can log `stream.start`, `json.partial/stream`, and `stream.end` events for dev tooling.
- Model overrides: each call passes `{clientSessionId, qr, text: {format}, overrides}` where `overrides` comes from the app’s model profiles (model name, temperature, etc.).

## Request + handler pattern used everywhere
```ts
import {responsesStream} from '@/lib/api';                    // wraps runJsonResponsesStream
import {QuestionQueryResponse} from '@/lib/query/QueryResponse';
import {emitJsonDeltaDebugEvent} from '@/lib/utils/event-bus';

const qr = new QuestionQueryResponse(sessionId, {listenToDom: false});

const off = qr.onEvent((ev) => {
  if (ev.type === 'json-partial' && ev.data?.value && typeof ev.data.value === 'object') {
    const obj = ev.data.value; // already parsed JSON from response.output_json.delta
    emitJsonDeltaDebugEvent({source: format.name, type: 'json.stream', data: {visual: JSON.stringify(obj, null, 2), sessionId}});
    // Extract the fields you care about (question text, suggestions, pending result, etc.)
  }
});

await responsesStream(
  [{role: 'system', content: sysPrompt}, {role: 'user', content: userPrompt}],
  undefined,                                                 // model defaults to getCurrentModelSettings()
  {onError},                                                 // text deltas are unused in the quiz app
  {text: {format}, clientSessionId: sessionId, overrides, qr, signal}
);

const finalObj = qr.lastJson; // final structured object captured by QueryResponse
off?.();
```

### Common options the app always sets
- `clientSessionId`: UUID per logical operation; reused in telemetry events.
- `text.format`: the JSON schema object returned by each round spec (`format.name` and `format.schema` are reused for metadata).
- `overrides`: `{model, ...buildUpstreamParamsFromProfile(profile)}` chosen per round type.
- `qr`: the `QueryResponse` instance for the stream; required for partials and `lastJson`.
- `signal`: AbortController signal so UI can cancel streams.

## Stage-by-stage usage

### 1) Routing / disambiguation
- **Entry points**: `startRoutingStream`, `determineQuizTypeStream`, and `generateDisambiguationStream`.
- **QueryResponse**: `QuestionQueryResponse`.
- **What streams**: a schema with `route`, `payload.quiz_type`, `payload.disambiguated_topic`, and/or `payload.question_phrasing`.
- **Handling partials**: listeners merge partial question payloads, track `meaning_is_pretty_obvious`, and capture early `quiz_type` / `disambiguated_topic` values before the final object arrives.
- **Finalization**: `qr.lastJson` is inspected first for determine-route outputs; falls back to the last streamed question when routing decides to ask a disambiguation question instead.

### 2) First question round
- **Entry point**: `generateQuestionStream`.
- **QueryResponse**: `QuestionQueryResponse`.
- **Schema expectation**: `first_question_variant`, plus either `quiz_question` or `disambiguation` containing `question_phrasing`, `question_goal`, `suggestions[0..3]`, `page_name`.
- **Handling partials**: `qr.onEvent` feeds a `QuestionStreamAssembler` that emits `onQuestionReady`, `onSuggestionReady(index)`, and `onComplete` in UI order. Every improved partial is sent to the UI and the debug bus.
- **Finalization**: Reads `qr.lastJson`, replays ticks, and throws if there is no question text or no suggestions (guards bad generations).

### 3) Subsequent / final rounds (question + evaluation)
- **Entry points**: `nextRoundStream` and `forceFinalRoundStream`.
- **QueryResponse**: `AnswerQueryResponse`.
- **Schema expectation**: top-level `answer_evaluation.finalisation_percentage/should_continue`, `next_question` (question + suggestions), and optional `finalisation.pending_result` (preview of the outcome).
- **Handling partials**: `qr.onEvent` processes each `json-partial`:
  - Emits evaluation updates immediately.
  - Emits partial next-question objects to the UI as soon as question text or suggestions improve.
  - Emits pending-result previews when present.
- **Finalization**: Uses `qr.lastJson` only, enforces “must have question text + >=1 suggestion”, and merges the last seen evaluation flags.

### 4) Final result (analysis)
- **Entry point**: `finalResultStream`.
- **QueryResponse**: `ResultQueryResponse`.
- **Schema expectation**: `final_result.result`, `final_result.result_name`, `final_result.result_title`, `final_result.explanation`, `final_result.image_emoji`, `final_result.page_name`, plus `answer_evaluation.progress`.
- **Handling partials**: `qr.onEvent` feeds a `ResultStreamAssembler`:
  - Emits `onTitleReady` once a result/title appears (normalizes “You Are A/An …”).
  - Emits `onExplanationStart` then `onExplanationChunk` whenever explanation text grows.
- **Finalization**: `qr.lastJson` must contain `final_result`; the code extracts the display title (result/result_title/result_name), explanation, emoji, page name, and “you are” statement. Missing required fields throw to force a retry.

## Cross-cutting behaviors
- **No text parsing**: `onDeltaText` is unused; everything comes from `json-partial` events emitted by `QueryResponse`.
- **Telemetry**: every stream emits `stream.start`, multiple `json.stream` (pretty-printed snapshots), and `stream.end` via `emitJsonDeltaDebugEvent` for dev overlays/logging.
- **Abort semantics**: if `signal.aborted`, streams short-circuit with `DOMException('AbortError')` and always emit `stream.end` before returning/throwing.
- **Metadata for UI/devtools**: partials and finals attach `__schemaName`, `__schema`, `__roundKey`, `__systemPromptId`, `__rawSystemPrompt`, and `__rawUserPrompt` when available so inspectors can show exactly which prompt/schema produced the data.

## Implementation checklist (repeatable in another repo)
1. Create a thin `responsesStream` wrapper around `runJsonResponsesStream` that injects your app’s `getCurrentModelSettings`.
2. Subclass `QueryResponse` per logical stream type (question, answer, result) so listeners can tag sessions and keep `lastJson`.
3. For every stream:
   - Build `{role: 'system'}` and `{role: 'user'}` messages and a `text.format` JSON schema.
   - Instantiate the right `QueryResponse`, register a `json-partial` listener, and pipe snapshots to your UI + debug bus.
   - Call `responsesStream(..., {text: {format}, clientSessionId, overrides, qr, signal})`.
   - Read `qr.lastJson` for the final object, attach prompt/schema metadata, and enforce required fields before returning.
4. Keep UI logic dumb: it consumes structured objects (questions, pending results, final_result) emitted by the listeners and the final snapshot—never raw text.
