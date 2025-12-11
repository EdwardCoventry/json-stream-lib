// A TypeScript port of the Python JSON stream builder.
// It accumulates arbitrarily chunked text and yields partial JSON states as soon as they become parseable.

export type RawJsonStatus = 'COMPLETED' | 'PARTIAL' | 'FAILED';

const UNPARSABLE = Symbol('UNPARSABLE');

class DoNotCloseJson extends Error {}

type StackEntry = { char: '{' | '[' | '"'; pos: number };

type ParsedState = {
  hasChanged: boolean;
  parsed: any | typeof UNPARSABLE;
  stack: StackEntry[];
  forcedClosures: number;
};

type ParseTuple = [hasChanged: boolean, parsed: any | typeof UNPARSABLE, stack: StackEntry[], forcedClosures: number];

/**
 * Maintains an incremental snapshot of a JSON payload as arbitrary chunks arrive.
 * The class keeps track of string/brace balance so callers can ask for the
 * closest valid JSON slice at any moment.
 */
export class RawJsonCloser {
  private buffer = '';
  private stack: StackEntry[] = [];
  private prevSerialized: string | null = null;
  private lastClosure: 'object' | 'array' | null = null;
  private forcedClosures = 0;
  private readonly numericPattern = /-?\d+(\.\d*)?([eE][-+]?\d+)?$/;

  constructor(private readonly emitEmptyContainers = true) {}

  // JSON start detection
  private hasStarted = false;
  private startEventPending = false;

  /** Returns true exactly once, when the first JSON starter was seen. */
  consumeStartEvent(): boolean {
    if (!this.startEventPending) return false;
    this.startEventPending = false;
    return true;
  }

  append(chunk: string): void {
    if (!chunk) return;
    for (let i = 0; i < chunk.length; i += 1) {
      const char = chunk[i] as '{' | '}' | '[' | ']' | '"' | string;
      this.appendChar(char);
    }
  }

  private appendChar(char: '{' | '}' | '[' | ']' | '"' | string) {
    this.markStartIfNeeded(char);

    this.buffer += char;
    const inString = this.stack[this.stack.length - 1]?.char === '"';

    if (char === '"') {
      this.handleQuote(inString);
      return;
    }

    if (inString) return;
    this.handleStructuralToken(char);
  }

  private markStartIfNeeded(char: string) {
    if (this.hasStarted || !/\S/.test(char)) return;
    if (this.isStartChar(char)) {
      this.hasStarted = true;
      this.startEventPending = true;
    }
  }

  private isEscapedQuote(buf: string, idx: number): boolean {
    // idx is position of '"' we just appended (buf.length-1)
    let backslashes = 0;
    for (let i = idx - 1; i >= 0 && buf[i] === '\\'; i -= 1) backslashes += 1;
    return (backslashes % 2) === 1;
  }

  private handleQuote(alreadyInString: boolean) {
    if (alreadyInString) {
      if (!this.isEscapedQuote(this.buffer, this.buffer.length - 1)) {
        this.stack.pop();
      }
      return;
    }
    this.stack.push({ char: '"', pos: this.buffer.length - 1 });
  }

  private handleStructuralToken(char: '{' | '}' | '[' | ']' | string) {
    const top = this.stack[this.stack.length - 1];
    if (char === '{') {
      this.stack.push({ char, pos: this.buffer.length - 1 });
      this.lastClosure = null;
      return;
    }
    if (char === '}') {
      if (top && top.char === '{') this.stack.pop();
      this.lastClosure = 'object';
      return;
    }
    if (char === '[') {
      this.stack.push({ char, pos: this.buffer.length - 1 });
      this.lastClosure = null;
      return;
    }
    if (char === ']') {
      if (top && top.char === '[') this.stack.pop();
      this.lastClosure = 'array';
    }
  }

  parse(isFinal: boolean): ParseTuple {
    try {
      this.forcedClosures = 0;
      const parsedState = this.parseBuffer(isFinal);
      return this.toTuple(parsedState);
    } catch (e) {
      // If we intentionally deferred closure (e.g., inside an open string or numeric literal),
      // signal UNPARSABLE without changing state.
      if (e instanceof DoNotCloseJson) {
        return this.toTuple(this.unparsableState());
      }
      return this.toTuple(this.unparsableState());
    }
  }

  private pruneDanglingStringForEmptyEmit(buffer: string, stack: StackEntry[]): {buffer: string; stack: StackEntry[]} | null {
    if (!this.emitEmptyContainers) return null;
    const topIdx = stack.length - 1;
    if (topIdx < 0) return null;
    const top = stack[topIdx];
    if (!top || top.char !== '"') return null;

    // Find the nearest open container beneath the dangling string
    let containerIdx = -1;
    for (let i = topIdx - 1; i >= 0; i -= 1) {
      if (stack[i].char === '{' || stack[i].char === '[') {
        containerIdx = i;
        break;
      }
    }
    if (containerIdx === -1) return null;

    const containerPos = stack[containerIdx].pos;
    // Drop everything inside the container (including the dangling string)
    let prunedBuffer = buffer.slice(0, containerPos + 1);
    prunedBuffer = prunedBuffer.replace(/\s+$/g, '').replace(/,\s*$/g, '');
    const prunedStack = stack.slice(0, containerIdx + 1);
    return {buffer: prunedBuffer, stack: prunedStack};
  }

  private isStartChar(ch: string): boolean {
    // Valid first non-whitespace chars for a JSON text: { [ " - 0..9 t f n
    return (
      ch === '{' ||
      ch === '[' ||
      ch === '"' ||
      ch === '-' ||
      (ch >= '0' && ch <= '9') ||
      ch === 't' || // true
      ch === 'f' || // false
      ch === 'n' // null
    );
  }

  private maybeCompleteLiteral(buf: string): string {
    // do not complete inside a string
    const inString = this.stack[this.stack.length - 1]?.char === '"';
    if (inString) return buf;

    const trimmed = buf.replace(/\s+$/g, '');
    if (!trimmed) return buf;

    // already complete -> no-op
    if (/(true|false|null)$/.test(trimmed)) return buf;

    // grab trailing letters
    const m = /[a-z]+$/.exec(trimmed);
    if (!m) return buf;
    const word = m[0]; // e.g., 't', 'tr', 'fal', 'nu', 'nul'
    if (!/^[tfn]$|^(tru?)$|^(f(al?s?)?)$|^(nu?l?)$/.test(word)) return buf;

    const target = word[0] === 't' ? 'true' : word[0] === 'f' ? 'false' : 'null';
    if (!target.startsWith(word)) return buf;

    // value boundary check: prev significant char must be start/':'/','/'['
    let j = m.index - 1;
    while (j >= 0 && /\s/.test(trimmed[j])) j -= 1;
    const prev = j >= 0 ? trimmed[j] : null;
    const boundaryOK = prev === null || prev === ':' || prev === ',' || prev === '[';
    if (!boundaryOK) return buf;

    return buf + target.slice(word.length);
  }

  private parseBuffer(isFinal: boolean): ParsedState {
    const closed = this.closeForParse(isFinal);

    // Guard: nothing to parse
    if (!closed || closed.trim().length === 0) {
      return this.unparsableState();
    }

    const parsed = JSON.parse(closed);
    const serialized = JSON.stringify(parsed);
    const hasChanged = this.computeChange(serialized);

    return {
      hasChanged,
      parsed,
      stack: this.stack.slice(),
      forcedClosures: this.forcedClosures,
    };
  }

  private toTuple(state: ParsedState): ParseTuple {
    return [state.hasChanged, state.parsed, state.stack, state.forcedClosures];
  }

  private unparsableState(): ParsedState {
    return {hasChanged: false, parsed: UNPARSABLE, stack: this.stack.slice(), forcedClosures: this.forcedClosures};
  }

  private computeChange(serialized: string): boolean {
    if (this.prevSerialized === null) {
      this.prevSerialized = serialized;
      this.lastClosure = null;
      return true;
    }
    if (serialized !== this.prevSerialized) {
      this.prevSerialized = serialized;
      this.lastClosure = null;
      return true;
    }
    const closureChange = this.lastClosure === 'object';
    this.lastClosure = null;
    return closureChange;
  }

  private hasPendingNumber(buf: string): boolean {
    const trimmed = buf.replace(/\s+$/g, '');
    const m = /(-?(?:0|[1-9]\d*)(?:\.\d*)?(?:[eE][-+]?\d*)?)$/.exec(trimmed);
    if (!m) return false;
    const num = m[1];
    const after = trimmed.slice(m.index + num.length);
    if (after.length !== 0) return false;

    // Incomplete exponent or trailing dot
    if (/[eE][-+]?$/.test(num)) return true;
    if (/\.$/.test(num)) return true;

    // If we're mid-stream and the last token is a number without a closing delimiter,
    // treat it as pending to allow more digits in the next chunk.
    return true;
  }

  private closeForParse(isFinal: boolean): string {
    // If we're inside a string, optionally discard the dangling token so we can close containers
    let closeBuf = this.buffer;
    let parseStack = this.stack;
    if (parseStack.length && parseStack[parseStack.length - 1].char === '"') {
      const pruned = this.pruneDanglingStringForEmptyEmit(closeBuf, parseStack);
      if (pruned) {
        closeBuf = pruned.buffer;
        parseStack = pruned.stack;
      }
      if (parseStack.length && parseStack[parseStack.length - 1].char === '"') {
        throw new DoNotCloseJson();
      }
    }

    if (!isFinal && this.hasPendingNumber(closeBuf)) {
      throw new DoNotCloseJson();
    }

    closeBuf = closeBuf.replace(/\s+$/g, '');
    // NEW: complete true/false/null prefixes at value boundaries
    closeBuf = this.maybeCompleteLiteral(closeBuf);

    let forced = 0;
    // Iterate open containers from inner to outer
    for (let i = parseStack.length - 1; i >= 0; i -= 1) {
      const { char, pos } = parseStack[i];
      let inner = closeBuf.slice(pos + 1).trim();
      if (inner.endsWith(',')) inner = inner.slice(0, -1).trim();
      const shouldClose = inner || this.emitEmptyContainers;
      if (shouldClose) {
        closeBuf = closeBuf.replace(/,\s*$/g, '');
        if (char === '{') {
          closeBuf += '}';
          forced += 1;
        } else if (char === '[') {
          closeBuf += ']';
          forced += 1;
        }
      }
      // else leave empty containers open until more input arrives
    }
    this.forcedClosures = forced;
    return closeBuf;
  }
}

export interface RawJsonParseResult {
  index: number;
  status: RawJsonStatus;
  data: any; // parsed JSON or null for start event
  forcedClosures: number;
  event?: 'JSON_STARTED'; // optional one-time event
}

/**
 * Consumes text chunks and emits incremental JSON parse results whenever the
 * payload becomes valid JSON (or when the stream is finalized).
 */
export class RawJsonStreamParser {
  private jsonCloser: RawJsonCloser;
  private entityIndex = 0;
  private lastDepth = 0;

  constructor(private readonly opts: { emitEmptyContainers?: boolean } = {}) {
    this.jsonCloser = new RawJsonCloser(this.opts.emitEmptyContainers !== false);
  }

  private makeResult(index: number, status: RawJsonStatus, data: any, forcedClosures: number, startedNow: boolean): RawJsonParseResult {
    const result: RawJsonParseResult = {index, status, data, forcedClosures};
    if (startedNow) result.event = 'JSON_STARTED';
    return result;
  }

  private resetCloser() {
    this.entityIndex += 1;
    this.lastDepth = 0;
    this.jsonCloser = new RawJsonCloser(this.opts.emitEmptyContainers !== false);
  }

  parse(chunk: string, isFinal: boolean): RawJsonParseResult | null {
    const index = this.entityIndex;

    // If we got an empty chunk and this isn't the final flush, do nothing
    if (!isFinal && chunk.length === 0) {
      return null;
    }

    this.jsonCloser.append(chunk);

    // Emit a one-time JSON_STARTED event as soon as the first valid starter arrives
    const startedNow = this.jsonCloser.consumeStartEvent();

    const [hasChanged, parsedJson, parseStack, forcedClosures] = this.jsonCloser.parse(isFinal);
    const currentDepth = parseStack.length;

    const completed = parsedJson !== UNPARSABLE && (currentDepth === 0 || isFinal);
    this.lastDepth = currentDepth;

    if (completed) {
      const result = this.makeResult(index, 'COMPLETED', parsedJson, forcedClosures, startedNow);
      this.resetCloser();
      return result;
    }

    // If nothing parseable yet, but we just detected start, emit the start event
    if (parsedJson === UNPARSABLE) {
      if (startedNow) {
        return this.makeResult(index, 'PARTIAL', null, 0, true);
      }
      return null;
    }

    // Normal emission; include the start event tag if it coincides with first parseable state
    if (isFinal || hasChanged) {
      return this.makeResult(index, 'PARTIAL', parsedJson, forcedClosures, startedNow);
    }
    return null;
  }
}
