export interface ToolCallDelta {
  id?: string;
  type?: string;
  index?: number;
  function?: { name?: string; arguments?: string };
}

export class DeltaAssembler {
  finalMessage: any = { role: 'assistant', content: '' };
  private _fullText = '';

  addText(t: string) {
    if (!t) return this._fullText;
    this.finalMessage.content = (this.finalMessage.content || '') + t;
    this._fullText += t;
    return this._fullText;
  }

  addJson(j: string) {
    if (!j) return this._fullText;
    // For structured JSON we do not append to finalMessage.content (kept separate for structured mode), but keep fullText for debug.
    this._fullText += j;
    return this._fullText;
  }

  mergeToolCalls(calls: ToolCallDelta[] | undefined) {
    if (!Array.isArray(calls)) return;
    this.finalMessage.tool_calls = this.finalMessage.tool_calls || [];
    for (const tc of calls) {
      const idx = typeof tc?.index === 'number' ? tc.index : 0;
      this.finalMessage.tool_calls[idx] = this.finalMessage.tool_calls[idx] || { id: '', type: tc?.type || 'function', function: { name: '', arguments: '' } };
      if (tc?.id) this.finalMessage.tool_calls[idx].id = tc.id;
      if (tc?.type) this.finalMessage.tool_calls[idx].type = tc.type;
      if (tc?.function?.name) this.finalMessage.tool_calls[idx].function.name = tc.function.name;
      if (typeof tc?.function?.arguments === 'string') {
        this.finalMessage.tool_calls[idx].function.arguments += tc.function.arguments;
      }
    }
  }

  mergeGeneric(delta: any) {
    if (!delta || typeof delta !== 'object') return;
    if (typeof delta.role === 'string') this.finalMessage.role = delta.role;
    if (typeof delta.content === 'string') this.addText(delta.content);
    this.mergeToolCalls(delta.tool_calls as any);
  }

  fullText(): string { return this._fullText; }
  final() { return this.finalMessage; }
}
