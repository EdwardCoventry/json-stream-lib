import {routeContentObject} from './ContentRouter.js';

export type DeltaHandlers = {
  handleTextDelta: (d: string) => void;
  handleJsonDelta: (d: string) => void;
  mergeDelta: (delta: any) => void;
  markCompleted?: () => void;
};

const TEXT_DELTA_EVENTS = new Set(['response.output_text.delta', 'response.message.delta', 'response.delta']);
const JSON_DELTA_EVENTS = new Set(['response.output_json.delta', 'response.json.delta']);
const CONTENT_EVENTS = new Set(['response.content_part.added', 'response.output_item.added', 'response.output_item.done']);
const COMPLETION_EVENTS = new Set(['response.output_text.done', 'response.completed']);

/**
 * Normalizes streaming event payloads from SSE into text/JSON delta handlers.
 */
export function routeJsonDeltaEvent(evType: string, dataLine: string, isJsonStructured: boolean, h: DeltaHandlers) {
  if (!dataLine || dataLine === '[DONE]') return; // handled at caller
  try {
    const obj = JSON.parse(dataLine);
    const declaredType = typeof (obj as any)?.type === 'string' ? (obj as any).type : '';
    const eventType = evType || declaredType;
    const deltaText = typeof (obj as any)?.delta === 'string' ? (obj as any).delta : '';
    const deliverContent = () => routeContentObject(obj, isJsonStructured, {handleTextDelta:h.handleTextDelta, handleJsonDelta:h.handleJsonDelta});
    const deliverText = (d: string) => { isJsonStructured ? h.handleJsonDelta(d) : h.handleTextDelta(d); };

    if (TEXT_DELTA_EVENTS.has(eventType)) {
      deliverText(deltaText);
      return;
    }
    if (JSON_DELTA_EVENTS.has(eventType)) {
      h.handleJsonDelta(deltaText);
      return;
    }
    if (CONTENT_EVENTS.has(eventType)) {
      deliverContent();
      if (eventType === 'response.output_item.done') h.markCompleted?.();
      return;
    }
    if (COMPLETION_EVENTS.has(eventType)) {
      deliverContent();
      h.markCompleted?.();
      return;
    }

    const delta = (obj as any)?.choices?.[0]?.delta ?? (obj as any)?.choices?.[0]?.message ?? (obj as any)?.delta ?? obj;
    h.mergeDelta(delta);
  } catch {
    // swallow parse errors; caller increments counter
  }
}
