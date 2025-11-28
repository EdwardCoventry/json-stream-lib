import {routeContentObject} from './ContentRouter';
export type DeltaHandlers = {
  handleTextDelta: (d: string) => void;
  handleJsonDelta: (d: string) => void;
  mergeDelta: (delta: any) => void;
  markCompleted?: () => void;
};

export function routeParsedEvent(evType: string, dataLine: string, isJsonStructured: boolean, h: DeltaHandlers) {
  if (!dataLine) return;
  if (dataLine === '[DONE]') return; // handled at caller
  try {
    const obj = JSON.parse(dataLine);
    const apply = () => {
      if (evType === 'response.output_text.delta' || evType === 'response.message.delta') {
        const d = typeof (obj as any)?.delta === 'string' ? (obj as any).delta : '';
        isJsonStructured ? h.handleJsonDelta(d) : h.handleTextDelta(d);
        return;
      }
      if (evType === 'response.output_json.delta' || evType === 'response.json.delta') {
        const jd = typeof (obj as any)?.delta === 'string' ? (obj as any).delta : '';
        h.handleJsonDelta(jd); return;
      }
      if (evType === 'response.content_part.added' || evType === 'response.output_item.added' || evType === 'response.output_item.done') {
        routeContentObject(obj, isJsonStructured, {handleTextDelta:h.handleTextDelta, handleJsonDelta:h.handleJsonDelta});
        if (evType === 'response.output_item.done') h.markCompleted?.(); return;
      }
      if (evType === 'response.output_text.done' || evType === 'response.completed') {
        routeContentObject(obj, isJsonStructured, {handleTextDelta:h.handleTextDelta, handleJsonDelta:h.handleJsonDelta});
        h.markCompleted?.(); return;
      }
      const typ = typeof (obj as any)?.type === 'string' ? (obj as any).type : '';
      if (typ) {
        if (typ === 'response.output_text.delta' || typ === 'response.delta' || typ === 'response.message.delta') {
          const d2 = typeof (obj as any)?.delta === 'string' ? (obj as any).delta : '';
          isJsonStructured ? h.handleJsonDelta(d2) : h.handleTextDelta(d2); return;
        }
        if (typ === 'response.output_json.delta' || typ === 'response.json.delta') { h.handleJsonDelta(typeof (obj as any)?.delta === 'string' ? (obj as any).delta : ''); return; }
        if (typ === 'response.content_part.added' || typ === 'response.output_item.added' || typ === 'response.output_item.done') { routeContentObject(obj, isJsonStructured, {handleTextDelta:h.handleTextDelta, handleJsonDelta:h.handleJsonDelta}); if (typ === 'response.output_item.done') h.markCompleted?.(); return; }
        if (typ === 'response.output_text.done' || typ === 'response.completed') { routeContentObject(obj, isJsonStructured, {handleTextDelta:h.handleTextDelta, handleJsonDelta:h.handleJsonDelta}); h.markCompleted?.(); return; }
      }
      const delta = (obj as any)?.choices?.[0]?.delta ?? (obj as any)?.choices?.[0]?.message ?? (obj as any)?.delta ?? obj;
      h.mergeDelta(delta);
    };
    apply();
  } catch {
    // swallow parse errors; caller increments counter
  }
}
