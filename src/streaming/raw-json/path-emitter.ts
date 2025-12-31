type Logger = {
  error?: (...args: any[]) => void;
};

type ObjectContext = {
  type: "object";
  path: string[];
  expecting: "key" | "colon" | "value" | "comma_or_end";
  pendingKey: string | null;
  hasEntries: boolean;
  startIndex: number;
};

type ArrayContext = {
  type: "array";
  path: string[];
  expecting: "value" | "comma_or_end";
  index: number;
  startIndex: number;
};

type Context = ObjectContext | ArrayContext;

export type JsonPathStreamEvent =
  | {
      type: "field";
      data: {
        path: string;
        value: any;
        raw: string;
        entityIndex: number;
      };
    }
  | {
      type: "array-start";
      data: {
        path: string;
        entityIndex: number;
      };
    }
  | {
      type: "array-item";
      data: {
        path: string;
        index: number;
        value: any;
        raw: string;
        entityIndex: number;
      };
    }
  | {
      type: "array-end";
      data: {
        path: string;
        length: number;
        raw: string;
        entityIndex: number;
      };
    };

export type JsonPathStreamEmitterOptions = {
  fields?: string[];
  arrays?: string[];
  onEvent: (ev: JsonPathStreamEvent) => void;
  logger?: Logger;
};

export type JsonPathStreamEmitter = {
  push: (chunk: string) => void;
  finalize: () => void;
  reset: () => void;
};

const isWhitespace = (ch: string) => /\s/.test(ch);

const isLiteralStart = (ch: string) =>
  ch === "-" ||
  (ch >= "0" && ch <= "9") ||
  ch === "t" ||
  ch === "f" ||
  ch === "n";

const isLiteralTerminator = (ch: string) =>
  isWhitespace(ch) || ch === "," || ch === "]" || ch === "}";

const joinPath = (path: string[]) => path.join(".");

const parseJsonToken = (
  raw: string,
  logger?: Logger,
  context?: Record<string, unknown>,
) => {
  try {
    return JSON.parse(raw);
  } catch (err: any) {
    logger?.error?.("[json-path-emitter] failed to parse token", {
      error: err?.message || String(err),
      raw,
      ...(context || {}),
    });
    throw err;
  }
};

const buildChildPath = (
  parent: Context | null,
  key: string | null,
): string[] => {
  if (!parent) return key ? [key] : [];
  if (parent.type === "object") {
    if (!key) return parent.path.slice();
    return [...parent.path, key];
  }
  return parent.path.slice();
};

export function createJsonPathStreamEmitter(
  options: JsonPathStreamEmitterOptions,
): JsonPathStreamEmitter {
  const fields = new Set(options.fields ?? []);
  const arrays = new Set(options.arrays ?? []);
  const onEvent = options.onEvent;
  const logger = options.logger;

  let buffer = "";
  let cursor = 0;
  let entityIndex = 0;

  let inString = false;
  let escapeNext = false;
  let stringStart = 0;
  let readingLiteral = false;
  let literalStart = 0;

  const contexts: Context[] = [];

  const currentContext = () =>
    contexts.length ? contexts[contexts.length - 1] : null;

  const emitField = (
    path: string[],
    value: any,
    raw: string,
    currentEntityIndex: number,
  ) => {
    const joined = joinPath(path);
    if (!fields.has(joined)) return;
    onEvent({
      type: "field",
      data: { path: joined, value, raw, entityIndex: currentEntityIndex },
    });
  };

  const emitArrayItem = (
    path: string[],
    index: number,
    value: any,
    raw: string,
    currentEntityIndex: number,
  ) => {
    const joined = joinPath(path);
    if (!arrays.has(joined)) return;
    onEvent({
      type: "array-item",
      data: { path: joined, index, value, raw, entityIndex: currentEntityIndex },
    });
  };

  const emitArrayStart = (path: string[], currentEntityIndex: number) => {
    const joined = joinPath(path);
    if (!arrays.has(joined)) return;
    onEvent({
      type: "array-start",
      data: { path: joined, entityIndex: currentEntityIndex },
    });
  };

  const emitArrayEnd = (
    path: string[],
    length: number,
    raw: string,
    currentEntityIndex: number,
  ) => {
    const joined = joinPath(path);
    if (!arrays.has(joined)) return;
    onEvent({
      type: "array-end",
      data: { path: joined, length, raw, entityIndex: currentEntityIndex },
    });
  };

  const completeValue = (
    value: any,
    raw: string,
    currentEntityIndex: number,
  ) => {
    const parent = currentContext();
    if (!parent) {
      entityIndex += 1;
      return;
    }
    if (parent.type === "object") {
      if (parent.expecting !== "value") {
        const err = new Error(
          "[json-path-emitter] object value completed in invalid state",
        );
        logger?.error?.(err.message, {
          state: parent.expecting,
          path: parent.path,
        });
        throw err;
      }
      const key = parent.pendingKey;
      if (!key) {
        const err = new Error(
          "[json-path-emitter] missing key for object value",
        );
        logger?.error?.(err.message, { path: parent.path });
        throw err;
      }
      emitField([...parent.path, key], value, raw, currentEntityIndex);
      parent.pendingKey = null;
      parent.expecting = "comma_or_end";
      parent.hasEntries = true;
      return;
    }

    if (parent.expecting !== "value") {
      const err = new Error(
        "[json-path-emitter] array value completed in invalid state",
      );
      logger?.error?.(err.message, {
        state: parent.expecting,
        path: parent.path,
      });
      throw err;
    }
    emitArrayItem(parent.path, parent.index, value, raw, currentEntityIndex);
    parent.index += 1;
    parent.expecting = "comma_or_end";
  };

  const startContainer = (type: "object" | "array", pos: number) => {
    const parent = currentContext();
    const key = parent?.type === "object" ? parent.pendingKey : null;
    if (parent && parent.type === "object") {
      if (parent.expecting !== "value") {
        const err = new Error(
          "[json-path-emitter] object value started in invalid state",
        );
        logger?.error?.(err.message, {
          state: parent.expecting,
          path: parent.path,
        });
        throw err;
      }
      if (!parent.pendingKey) {
        const err = new Error(
          "[json-path-emitter] missing key for object container value",
        );
        logger?.error?.(err.message, { path: parent.path });
        throw err;
      }
    }
    if (parent && parent.type === "array" && parent.expecting !== "value") {
      const err = new Error(
        "[json-path-emitter] array value started in invalid state",
      );
      logger?.error?.(err.message, {
        state: parent.expecting,
        path: parent.path,
      });
      throw err;
    }

    const path = buildChildPath(parent, key);
    const context: Context =
      type === "object"
        ? {
            type: "object",
            path,
            expecting: "key",
            pendingKey: null,
            hasEntries: false,
            startIndex: pos,
          }
        : {
            type: "array",
            path,
            expecting: "value",
            index: 0,
            startIndex: pos,
          };

    contexts.push(context);
    if (type === "array") {
      emitArrayStart(path, entityIndex);
    }
  };

  const closeContainer = (expected: "object" | "array", pos: number) => {
    const context = currentContext();
    if (!context || context.type !== expected) {
      const err = new Error("[json-path-emitter] mismatched closing token");
      logger?.error?.(err.message, {
        expected,
        found: context?.type ?? null,
      });
      throw err;
    }

    if (context.type === "object") {
      if (context.expecting === "colon" || context.expecting === "value") {
        const err = new Error(
          "[json-path-emitter] object closed while awaiting value",
        );
        logger?.error?.(err.message, { path: context.path });
        throw err;
      }
      if (context.expecting === "key" && context.hasEntries) {
        const err = new Error(
          "[json-path-emitter] object closed after trailing comma",
        );
        logger?.error?.(err.message, { path: context.path });
        throw err;
      }
    }

    if (context.type === "array") {
      if (context.expecting === "value" && context.index > 0) {
        const err = new Error(
          "[json-path-emitter] array closed after trailing comma",
        );
        logger?.error?.(err.message, { path: context.path });
        throw err;
      }
    }

    const raw = buffer.slice(context.startIndex, pos + 1);
    const parsed = parseJsonToken(raw, logger, {
      type: context.type,
      path: joinPath(context.path),
    });

    if (context.type === "array") {
      emitArrayEnd(context.path, context.index, raw, entityIndex);
    }

    contexts.pop();
    completeValue(parsed, raw, entityIndex);
  };

  const handleStringToken = (raw: string, value: string) => {
    const parent = currentContext();
    if (!parent) {
      completeValue(value, raw, entityIndex);
      return;
    }
    if (parent.type === "object") {
      if (parent.expecting === "key") {
        parent.pendingKey = value;
        parent.expecting = "colon";
        return;
      }
      if (parent.expecting === "value") {
        completeValue(value, raw, entityIndex);
        return;
      }
      const err = new Error("[json-path-emitter] string in invalid state");
      logger?.error?.(err.message, {
        state: parent.expecting,
        path: parent.path,
      });
      throw err;
    }

    if (parent.expecting === "value") {
      completeValue(value, raw, entityIndex);
      return;
    }

    const err = new Error("[json-path-emitter] string in invalid array state");
    logger?.error?.(err.message, {
      state: parent.expecting,
      path: parent.path,
    });
    throw err;
  };

  const handleLiteralToken = (raw: string) => {
    const value = parseJsonToken(raw, logger);
    completeValue(value, raw, entityIndex);
  };

  const process = (isFinal: boolean) => {
    for (let i = cursor; i < buffer.length; i += 1) {
      const ch = buffer[i];

      if (inString) {
        if (escapeNext) {
          escapeNext = false;
          continue;
        }
        if (ch === "\\") {
          escapeNext = true;
          continue;
        }
        if (ch === '"') {
          inString = false;
          const raw = buffer.slice(stringStart, i + 1);
          const value = parseJsonToken(raw, logger, { type: "string" });
          handleStringToken(raw, value);
        }
        continue;
      }

      if (readingLiteral) {
        if (isLiteralTerminator(ch)) {
          const raw = buffer.slice(literalStart, i);
          readingLiteral = false;
          handleLiteralToken(raw);
          i -= 1;
          continue;
        }
        continue;
      }

      if (isWhitespace(ch)) continue;

      if (ch === '"') {
        inString = true;
        stringStart = i;
        continue;
      }

      if (ch === "{") {
        startContainer("object", i);
        continue;
      }

      if (ch === "[") {
        startContainer("array", i);
        continue;
      }

      if (ch === "}") {
        closeContainer("object", i);
        continue;
      }

      if (ch === "]") {
        closeContainer("array", i);
        continue;
      }

      if (ch === ":") {
        const parent = currentContext();
        if (!parent || parent.type !== "object" || parent.expecting !== "colon") {
          const err = new Error("[json-path-emitter] unexpected ':' token");
          logger?.error?.(err.message, { path: parent?.path ?? null });
          throw err;
        }
        parent.expecting = "value";
        continue;
      }

      if (ch === ",") {
        const parent = currentContext();
        if (!parent) {
          const err = new Error("[json-path-emitter] unexpected ',' token");
          logger?.error?.(err.message);
          throw err;
        }
        if (parent.type === "object") {
          if (parent.expecting !== "comma_or_end") {
            const err = new Error("[json-path-emitter] unexpected ',' in object");
            logger?.error?.(err.message, {
              state: parent.expecting,
              path: parent.path,
            });
            throw err;
          }
          parent.expecting = "key";
          continue;
        }

        if (parent.expecting !== "comma_or_end") {
          const err = new Error("[json-path-emitter] unexpected ',' in array");
          logger?.error?.(err.message, {
            state: parent.expecting,
            path: parent.path,
          });
          throw err;
        }
        parent.expecting = "value";
        continue;
      }

      if (isLiteralStart(ch)) {
        const parent = currentContext();
        if (parent) {
          if (
            (parent.type === "object" && parent.expecting !== "value") ||
            (parent.type === "array" && parent.expecting !== "value")
          ) {
            const err = new Error(
              "[json-path-emitter] literal started in invalid state",
            );
            logger?.error?.(err.message, {
              state: parent.expecting,
              path: parent.path,
            });
            throw err;
          }
        }
        readingLiteral = true;
        literalStart = i;
        continue;
      }

      const err = new Error(`[json-path-emitter] unexpected token "${ch}"`);
      logger?.error?.(err.message, { offset: i });
      throw err;
    }

    cursor = buffer.length;

    if (!isFinal) return;

    if (inString) {
      const err = new Error("[json-path-emitter] unfinished string at end");
      logger?.error?.(err.message);
      throw err;
    }

    if (readingLiteral) {
      const raw = buffer.slice(literalStart);
      readingLiteral = false;
      handleLiteralToken(raw);
    }

    if (contexts.length) {
      const err = new Error("[json-path-emitter] unterminated JSON payload");
      logger?.error?.(err.message, {
        depth: contexts.length,
        open: contexts.map((ctx) => ctx.type),
      });
      throw err;
    }
  };

  const push = (chunk: string) => {
    buffer += String(chunk ?? "");
    process(false);
  };

  const finalize = () => {
    process(true);
  };

  const reset = () => {
    buffer = "";
    cursor = 0;
    entityIndex = 0;
    inString = false;
    escapeNext = false;
    stringStart = 0;
    readingLiteral = false;
    literalStart = 0;
    contexts.length = 0;
  };

  return { push, finalize, reset };
}
