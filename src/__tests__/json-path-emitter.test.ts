import { test } from "node:test";
import { strict as assert } from "node:assert";

import {
  createJsonPathStreamEmitter,
  type JsonPathStreamEvent,
} from "../streaming/raw-json/index.js";
import { fullPayload } from "./fixtures/full-payload.js";

test("emits tracked array items as they close", () => {
  const events: JsonPathStreamEvent[] = [];
  const emitter = createJsonPathStreamEmitter({
    arrays: ["stages"],
    onEvent: (ev) => events.push(ev),
  });

  emitter.push('{"stages":[{"title":"Stage 1"}');
  assert.equal(events.length, 1);
  const first = events[0];
  assert.equal(first.type, "array-item");
  if (first.type !== "array-item") throw new Error("expected array-item");
  assert.equal(first.data.path, "stages");
  assert.equal(first.data.index, 0);
  assert.deepEqual(first.data.value, { title: "Stage 1" });

  emitter.push(',{"title":"Stage 2"}');
  assert.equal(events.length, 2);
  const second = events[1];
  assert.equal(second.type, "array-item");
  if (second.type !== "array-item") throw new Error("expected array-item");
  assert.equal(second.data.index, 1);
  assert.deepEqual(second.data.value, { title: "Stage 2" });

  emitter.push("]}");
  emitter.finalize();
});

test("emits tracked array items for primitive values", () => {
  const events: JsonPathStreamEvent[] = [];
  const emitter = createJsonPathStreamEmitter({
    arrays: ["tags"],
    onEvent: (ev) => events.push(ev),
  });

  emitter.push('{"tags":["a","b","c"]}');
  emitter.finalize();

  const values = events.map((ev) => ev.data.value);
  assert.deepEqual(values, ["a", "b", "c"]);
});

test("emits tracked field values by path", () => {
  const events: JsonPathStreamEvent[] = [];
  const emitter = createJsonPathStreamEmitter({
    fields: ["title", "meta.inner"],
    onEvent: (ev) => events.push(ev),
  });

  emitter.push('{"meta":{"inner":42},"title":"Hello"}');
  emitter.finalize();

  const paths = events.map((ev) => ev.data.path).sort();
  assert.deepEqual(paths, ["meta.inner", "title"]);
  const byPath = Object.fromEntries(events.map((ev) => [ev.data.path, ev.data.value]));
  assert.deepEqual(byPath["meta.inner"], 42);
  assert.deepEqual(byPath["title"], "Hello");
});

test("emits tracked fields and array items from the full payload", () => {
  const events: JsonPathStreamEvent[] = [];
  const emitter = createJsonPathStreamEmitter({
    fields: [
      "title",
      "rgb.red",
      "bw.white",
      "deeper_object.level_1.level_2.level_3.key",
      "meaning",
    ],
    arrays: ["non_empty_array", "empty_array"],
    onEvent: (ev) => events.push(ev),
  });

  const json = JSON.stringify(fullPayload);
  emitter.push(json);
  emitter.finalize();

  const arrayEvents = events.filter(
    (ev): ev is Extract<JsonPathStreamEvent, { type: "array-item" }> =>
      ev.type === "array-item"
  );
  const fieldEvents = events.filter(
    (ev): ev is Extract<JsonPathStreamEvent, { type: "field" }> =>
      ev.type === "field"
  );

  assert.ok(
    arrayEvents.every((ev) => ev.data.path === "non_empty_array"),
    "expected only non_empty_array items"
  );
  assert.equal(arrayEvents.length, fullPayload.non_empty_array.length);
  arrayEvents.forEach((ev, idx) => {
    assert.equal(ev.data.index, idx);
    assert.deepEqual(ev.data.value, fullPayload.non_empty_array[idx]);
    assert.deepEqual(JSON.parse(ev.data.raw), fullPayload.non_empty_array[idx]);
    assert.equal(ev.data.entityIndex, 0);
  });

  const fieldByPath = Object.fromEntries(
    fieldEvents.map((ev) => [ev.data.path, ev.data.value])
  );
  assert.deepEqual(fieldByPath["title"], fullPayload.title);
  assert.deepEqual(fieldByPath["rgb.red"], fullPayload.rgb.red);
  assert.deepEqual(fieldByPath["bw.white"], fullPayload.bw.white);
  assert.deepEqual(
    fieldByPath["deeper_object.level_1.level_2.level_3.key"],
    fullPayload.deeper_object.level_1.level_2.level_3.key
  );
  assert.deepEqual(fieldByPath["meaning"], fullPayload.meaning);
  fieldEvents.forEach((ev) => {
    assert.deepEqual(JSON.parse(ev.data.raw), ev.data.value);
    assert.equal(ev.data.entityIndex, 0);
  });
});

test("throws when JSON is incomplete at finalize", () => {
  const emitter = createJsonPathStreamEmitter({
    arrays: ["stages"],
    onEvent: () => {},
  });

  emitter.push('{"stages":[{"title":"Stage 1"}');
  assert.throws(() => emitter.finalize(), /unterminated JSON payload/);
});
