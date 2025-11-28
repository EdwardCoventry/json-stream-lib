export function pickString(v: any): string {
  if (!v) return '';
  if (typeof v === 'string') return v;
  if (typeof v?.text === 'string') return v.text;
  if (v?.text && typeof v.text === 'object' && typeof v.text.value === 'string') return v.text.value;
  if (typeof v?.delta === 'string') return v.delta;
  return '';
}

export function routeContentObject(obj: any, isJsonStructured: boolean, handlers: {handleTextDelta:(s:string)=>void; handleJsonDelta:(s:string)=>void}) {
  try {
    if (Object.prototype.hasOwnProperty.call(obj || {}, 'output_json')) {
      const out = (obj as any).output_json;
      const jsonStr = typeof out === 'string' ? out : JSON.stringify(out);
      if (jsonStr) return handlers.handleJsonDelta(jsonStr);
    }
    const simple = pickString(obj);
    if (simple) return isJsonStructured ? handlers.handleJsonDelta(simple) : handlers.handleTextDelta(simple);
    const item = (obj as any)?.item;
    if (item && Array.isArray(item.content)) {
      for (const el of item.content) {
        if (!el) continue;
        if (el.type === 'output_json') {
          const j = typeof el.json === 'string' ? el.json : (el.json ? JSON.stringify(el.json) : '');
          if (j) handlers.handleJsonDelta(j);
          continue;
        }
        const s = pickString(el);
        if (s) isJsonStructured ? handlers.handleJsonDelta(s) : handlers.handleTextDelta(s);
      }
      return;
    }
    const content = (obj as any)?.content;
    if (Array.isArray(content)) {
      for (const el of content) {
        if (!el) continue;
        if (el.type === 'output_json') {
          const j = typeof el.json === 'string' ? el.json : (el.json ? JSON.stringify(el.json) : '');
          if (j) handlers.handleJsonDelta(j);
          continue;
        }
        const s = pickString(el);
        if (s) isJsonStructured ? handlers.handleJsonDelta(s) : handlers.handleTextDelta(s);
      }
      return;
    }
  } catch {}
}
