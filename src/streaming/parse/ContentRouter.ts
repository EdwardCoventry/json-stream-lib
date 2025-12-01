export function pickString(v: any): string {
  if (!v) return '';
  if (typeof v === 'string') return v;
  if (typeof v?.text === 'string') return v.text;
  if (v?.text && typeof v.text === 'object' && typeof v.text.value === 'string') return v.text.value;
  if (typeof v?.delta === 'string') return v.delta;
  return '';
}

export function routeContentObject(
  obj: any,
  isJsonStructured: boolean,
  handlers: {handleTextDelta:(s:string)=>void; handleJsonDelta:(s:string)=>void},
): boolean {
  let delivered = false;
  const pushText = (s: string) => {
    if (!s) return;
    delivered = true;
    isJsonStructured ? handlers.handleJsonDelta(s) : handlers.handleTextDelta(s);
  };
  const pushJson = (val: any) => {
    if (typeof val === 'undefined' || val === null) return;
    const jsonStr = typeof val === 'string' ? val : JSON.stringify(val);
    if (!jsonStr) return;
    delivered = true;
    handlers.handleJsonDelta(jsonStr);
  };
  const maybeOutputJson = (val: any): boolean => {
    if (typeof val === 'undefined' || val === null) return false;
    pushJson(val);
    return true;
  };
  const maybeOutputText = (val: any): boolean => {
    if (!val) return false;
    let used = false;
    if (typeof val === 'string') {
      pushText(val);
      return true;
    }
    const simple = pickString(val);
    if (simple) {
      pushText(simple);
      used = true;
    }
    const parts = Array.isArray(val) ? val : (Array.isArray((val as any).content) ? (val as any).content : []);
    for (const part of parts) {
      if (!part) continue;
      if (part.type === 'output_json') {
        pushJson((part as any).json);
        used = true;
        continue;
      }
      const s = pickString(part);
      if (s) {
        pushText(s);
        used = true;
      }
      const nested = Array.isArray((part as any).content) ? (part as any).content : [];
      for (const inner of nested) {
        if (!inner) continue;
        if (inner.type === 'output_json') {
          pushJson((inner as any).json);
          used = true;
          continue;
        }
        const si = pickString(inner);
        if (si) {
          pushText(si);
          used = true;
        }
      }
    }
    return used;
  };

  try {
    if (maybeOutputJson((obj as any)?.output_parsed)) return true;
    if (maybeOutputJson((obj as any)?.output_json)) return true;
    if (maybeOutputText((obj as any)?.output_text)) return delivered;

    const simple = pickString(obj);
    if (simple) {
      pushText(simple);
      return delivered;
    }
    const item = (obj as any)?.item;
    if (item && Array.isArray(item.content)) {
      for (const el of item.content) {
        if (!el) continue;
        if (el.type === 'output_json') {
          pushJson((el as any).json);
          continue;
        }
        const s = pickString(el);
        if (s) pushText(s);
      }
      return delivered;
    }
    const content = (obj as any)?.content;
    if (Array.isArray(content)) {
      for (const el of content) {
        if (!el) continue;
        if (el.type === 'output_json') {
          pushJson((el as any).json);
          continue;
        }
        const s = pickString(el);
        if (s) pushText(s);
      }
      return delivered;
    }
  } catch {}
  return delivered;
}
