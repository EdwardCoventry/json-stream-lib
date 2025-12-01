import {routeContentObject} from './ContentRouter.js';

export type DeltaHandlers = {
  handleTextDelta: (d: string) => void;
  handleJsonDelta: (d: string) => void;
  mergeDelta: (delta: any) => void;
  markCompleted?: () => void;
};

const TEXT_DELTA_EVENTS = new Set(['response.output_text.delta', 'response.message.delta', 'response.delta', 'response.output_text.chunk']);
const JSON_DELTA_EVENTS = new Set(['response.output_json.delta', 'response.json.delta', 'response.output_json.chunk', 'response.output_json.done']);
const CONTENT_EVENTS = new Set(['response.content_part.added', 'response.output_item.added', 'response.output_item.done']);
const COMPLETION_EVENTS = new Set(['response.output_text.done', 'response.output_json.done', 'response.completed']);

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
    const deltaObj = (obj as any)?.delta && typeof (obj as any).delta === 'object' ? (obj as any).delta : null;
    let handled = false;
    const deliverText = (d: string) => {
      if (!d) return;
      handled = true;
      isJsonStructured ? h.handleJsonDelta(d) : h.handleTextDelta(d);
    };
    const deliverJson = (d: any) => {
      if (typeof d === 'undefined' || d === null) return;
      const jsonStr = typeof d === 'string' ? d : JSON.stringify(d);
      if (!jsonStr) return;
      handled = true;
      h.handleJsonDelta(jsonStr);
    };
    const deliverContent = () => {
      const delivered = routeContentObject(obj, isJsonStructured, {handleTextDelta:deliverText, handleJsonDelta:deliverJson});
      if (delivered) handled = true;
    };
    const deliverDeltaContent = () => {
      if (!deltaObj) return;
      const delivered = routeContentObject(deltaObj, isJsonStructured, {handleTextDelta:deliverText, handleJsonDelta:deliverJson});
      if (delivered) handled = true;
    };

    if (TEXT_DELTA_EVENTS.has(eventType)) {
      if (deltaText) deliverText(deltaText);
      deliverDeltaContent();
      if (!handled) deliverContent();
      return;
    }
    if (JSON_DELTA_EVENTS.has(eventType)) {
      if (deltaText) deliverJson(deltaText);
      else if (deltaObj) deliverDeltaContent();
      else if (Object.prototype.hasOwnProperty.call(obj || {}, 'output_json')) deliverJson((obj as any).output_json);
      else if (Object.prototype.hasOwnProperty.call(obj || {}, 'output_parsed')) deliverJson((obj as any).output_parsed);
      if (!handled) deliverContent();
      if (eventType === 'response.output_json.done') h.markCompleted?.();
      return;
    }
    if (CONTENT_EVENTS.has(eventType)) {
      deliverContent();
      if (!handled) deliverDeltaContent();
      if (eventType === 'response.output_item.done') h.markCompleted?.();
      return;
    }
    if (COMPLETION_EVENTS.has(eventType)) {
      deliverContent();
      if (!handled) deliverDeltaContent();
      h.markCompleted?.();
      return;
    }

    deliverContent();
    if (!handled) deliverDeltaContent();

    if (!handled) {
      const delta = (obj as any)?.choices?.[0]?.delta ?? (obj as any)?.choices?.[0]?.message ?? (obj as any)?.delta ?? obj;
      h.mergeDelta(delta);
    }
  } catch {
    // swallow parse errors; caller increments counter
  }
}
