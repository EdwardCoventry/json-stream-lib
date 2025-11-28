// A TypeScript port of the Python JSON stream builder.
// It accumulates arbitrarily chunked text and yields partial JSON states as soon as they become parseable.

export type Status = 'COMPLETED' | 'PARTIAL' | 'FAILED';

const UNPASSABLE = Symbol('UNPASSABLE');

class DoNotCloseJson extends Error {
}

type StackEntry = { char: '{' | '[' | '"'; pos: number };

export class JsonCloser {
    private buffer = '';
    private stack: StackEntry[] = [];
    private prevSize = 0;
    private closedObject = false;
    private closedArray = false;
    private forcedClosures = 0;
    private numericPattern = /-?\d+(\.\d*)?([eE][-+]?\d+)?$/;

    // JSON start detection
    private hasStarted = false;
    private startEventPending = false;

    /** Returns true exactly once, when the first JSON starter was seen. */
    consumeStartEvent(): boolean {
        if (this.startEventPending) {
            this.startEventPending = false;
            return true;
        }
        return false;
    }

    append(chunk: string): void {
        const isEscapedQuote = (buf: string, idx: number) => {
            // idx is position of '"' we just appended (buf.length-1)
            let bs = 0;
            for (let i = idx - 1; i >= 0 && buf[i] === '\\'; i--) bs++;
            return (bs % 2) === 1;
        };

        for (let i = 0; i < chunk.length; i++) {
            const char = chunk[i] as '{' | '}' | '[' | ']' | '"' | string;

            // JSON start detection on first significant non-whitespace character
            if (!this.hasStarted) {
                const sig = /\S/.test(char);
                if (sig && this.isStartChar(char)) {
                    this.hasStarted = true;
                    this.startEventPending = true;
                }
            }

            this.buffer += char;
            const top = this.stack[this.stack.length - 1];
            const inString = top?.char === '"';

            // Quote handling (respect escapes)
            if (char === '"') {
                if (inString) {
                    if (!isEscapedQuote(this.buffer, this.buffer.length - 1)) {
                        this.stack.pop();
                    }
                } else {
                    this.stack.push({char: '"', pos: this.buffer.length - 1});
                }
                continue;
            }

            // Ignore structural tokens while inside a string
            if (inString) continue;

            if (char === '{') {
                this.stack.push({char, pos: this.buffer.length - 1});
                this.closedObject = false;
            } else if (char === '}') {
                if (top && top.char === '{') this.stack.pop();
                this.closedObject = true;
            } else if (char === '[') {
                this.stack.push({char, pos: this.buffer.length - 1});
                this.closedArray = false;
            } else if (char === ']') {
                if (top && top.char === '[') this.stack.pop();
                this.closedArray = true;
            }
        }
    }

    parse(isFinal: boolean): [hasChanged: boolean, parsed: any | typeof UNPASSABLE, stack: StackEntry[], forcedClosures: number] {
        try {
            const closed = this.closeForParse(isFinal);

            // Guard: nothing to parse
            if (!closed || closed.trim().length === 0) {
                return [false, UNPASSABLE, this.stack.slice(), this.forcedClosures];
            }

            const parsed = JSON.parse(closed);
            const size = JSON.stringify(parsed).length;

            let hasChanged = false;
            if (size > this.prevSize) {
                hasChanged = true;
                this.prevSize = size;
            } else {
                // XOR: if one of object/array just closed, treat as change when object closed
                if (this.closedObject !== this.closedArray) {
                    hasChanged = this.closedObject;
                    this.closedObject = false;
                }
            }

            return [hasChanged, parsed, this.stack.slice(), this.forcedClosures];
        } catch (e) {
            // If we intentionally deferred closure (e.g., inside an open string or numeric literal),
            // signal UNPASSABLE without changing state.
            if (e instanceof DoNotCloseJson) {
                return [false, UNPASSABLE, this.stack.slice(), this.forcedClosures];
            }
            return [false, UNPASSABLE, this.stack.slice(), this.forcedClosures];
        }
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
            ch === 'n'    // null
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
        const word = m[0];                 // e.g., 't', 'tr', 'fal', 'nu', 'nul'
        if (!/^[tfn]$|^(tru?)$|^(f(al?s?)?)$|^(nu?l?)$/.test(word)) return buf;

        const target = word[0] === 't' ? 'true' : word[0] === 'f' ? 'false' : 'null';
        if (!target.startsWith(word)) return buf;

        // value boundary check: prev significant char must be start/':'/','/'['
        let j = m.index - 1;
        while (j >= 0 && /\s/.test(trimmed[j])) j--;
        const prev = j >= 0 ? trimmed[j] : null;
        const boundaryOK = prev === null || prev === ':' || prev === ',' || prev === '[';
        if (!boundaryOK) return buf;

        return buf + target.slice(word.length);
    }

    private closeForParse(isFinal: boolean): string {
        // If we're inside a string, do not attempt any closure yet
        if (this.stack.length && this.stack[this.stack.length - 1].char === '"') {
            throw new DoNotCloseJson();
        }

        if (!isFinal) {
            if (this.numericPattern.test(this.buffer)) {
                throw new DoNotCloseJson();
            }
        }

        let closeBuf = this.buffer.replace(/\s+$/g, '');
        // NEW: complete true/false/null prefixes at value boundaries
        closeBuf = this.maybeCompleteLiteral(closeBuf);

        let forced = 0;
        // Iterate open containers from inner to outer
        for (let i = this.stack.length - 1; i >= 0; i--) {
            const {char, pos} = this.stack[i];
            let inner = closeBuf.slice(pos + 1).trim();
            if (inner.endsWith(',')) inner = inner.slice(0, -1).trim();
            if (inner) {
                if (char === '{') {
                    closeBuf = closeBuf.replace(/,\s*$/g, '');
                    closeBuf += '}';
                    forced += 1;
                } else if (char === '[') {
                    closeBuf = closeBuf.replace(/,\s*$/g, '');
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

export interface StreamParseResult {
    index: number;
    status: Status;
    data: any;                 // parsed JSON or null for start event
    forced_closures: number;
    event?: 'JSON_STARTED';    // optional one-time event
}

export class StreamParser {
    private jsonCloser = new JsonCloser();
    private entityIndex = 0;
    private lastDepth = 0;

    parse(chunk: string, isFinal: boolean): StreamParseResult | null {
        const index = this.entityIndex;

        // Coerce non-string chunks defensively; some transports may deliver undefined/null
        const chunkStr = chunk; // parameter is typed as string; keep simple

        // If we got an empty chunk and this isn't the final flush, do nothing
        if (!isFinal && chunkStr.length === 0) {
            return null;
        }

        this.jsonCloser.append(chunkStr);

        // Emit a one-time JSON_STARTED event as soon as the first valid starter arrives
        const startedNow = this.jsonCloser.consumeStartEvent();

        const [hasChanged, resJson, stack, forced] = this.jsonCloser.parse(isFinal);

        // Completed when we transition from open stack to empty stack with a parseable JSON value
        const completed = this.lastDepth > 0 && stack.length === 0 && resJson !== UNPASSABLE;
        if (completed) {
            const result: StreamParseResult = {
                index,
                status: 'COMPLETED',
                data: resJson,
                forced_closures: forced,
            };
            if (startedNow) result.event = 'JSON_STARTED';
            this.entityIndex += 1;
            this.lastDepth = 0;
            // Reset to avoid trailing non-JSON junk contaminating new parses
            this.jsonCloser = new JsonCloser();
            return result;
        }
        this.lastDepth = stack.length;

        // If nothing parseable yet, but we just detected start, emit the start event
        if (resJson === UNPASSABLE) {
            if (startedNow) {
                return {
                    index,
                    status: 'PARTIAL',
                    data: null,
                    forced_closures: 0,
                    event: 'JSON_STARTED',
                };
            }
            return null;
        }

        // Normal emission; include the start event tag if it coincides with first parseable state
        if (isFinal || hasChanged) {
            const result: StreamParseResult = {
                index,
                status: 'PARTIAL',
                data: resJson,
                forced_closures: forced,
            };
            if (startedNow) result.event = 'JSON_STARTED';
            return result;
        }
        return null;
    }
}

